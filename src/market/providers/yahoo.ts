import type { CandleRequest } from "../../adapter/types.ts";
import type { Candle, Symbol } from "../../services/schemas.ts";
import {
  barsWanted,
  cleanCandles,
  fromYahooTicker,
  makeSymbol,
  normalizeCategory,
  parseId,
  timeframeSeconds,
  toYahooTicker,
  windowCandles,
} from "../symbols.ts";
import {
  type LiveTick,
  type MarketProvider,
  ProviderError,
  type QuoteStats,
  type SymbolSearchResult,
} from "../types.ts";
import { bridgeGet } from "./http.ts";

/**
 * Yahoo Finance, through the market bridge (Yahoo blocks browser CORS and
 * needs a cookie + crumb). Covers stocks, ETFs, indices, forex, futures and
 * crypto. Unofficial: some exchanges are delayed, and Yahoo rate-limits per IP
 * — when it does, the composite falls through to the next provider.
 *
 * Live prices are polled: there is no public streaming endpoint.
 */

const POLL_MS = 5_000;
const POLL_BACKOFF_MS = 30_000;
/** Symbols refreshed per poll; a longer watchlist is cycled through. */
const POLL_BATCH = 12;

/** Native timeframe → Yahoo interval, and how far back Yahoo serves it. */
const INTERVALS: Record<string, { interval: string; maxDays: number; perCallDays: number }> = {
  "1m": { interval: "1m", maxDays: 29, perCallDays: 7 },
  "2m": { interval: "2m", maxDays: 59, perCallDays: 59 },
  "5m": { interval: "5m", maxDays: 59, perCallDays: 59 },
  "15m": { interval: "15m", maxDays: 59, perCallDays: 59 },
  "30m": { interval: "30m", maxDays: 59, perCallDays: 59 },
  "1h": { interval: "60m", maxDays: 729, perCallDays: 729 },
  "1d": { interval: "1d", maxDays: 365 * 60, perCallDays: 365 * 60 },
  "1w": { interval: "1wk", maxDays: 365 * 60, perCallDays: 365 * 60 },
  "1M": { interval: "1mo", maxDays: 365 * 60, perCallDays: 365 * 60 },
  "3M": { interval: "3mo", maxDays: 365 * 60, perCallDays: 365 * 60 },
};

interface ChartResult {
  meta: {
    symbol: string;
    currency?: string;
    exchangeName?: string;
    instrumentType?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
    regularMarketTime?: number;
    longName?: string;
    shortName?: string;
    priceHint?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface ChartResponse {
  chart?: { result?: ChartResult[] | null; error?: { description?: string } | null };
}

interface SearchQuote {
  symbol?: string;
  exchange?: string;
  exchDisp?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  typeDisp?: string;
}

export function chartToCandles(result: ChartResult): Candle[] {
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  if (!q) return [];
  const rows: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    // Yahoo pads gaps with nulls.
    if (open == null || high == null || low == null || close == null) continue;
    rows.push({ time: ts[i]!, open, high, low, close, volume: q.volume?.[i] ?? 0 });
  }
  return rows;
}

export interface YahooOptions {
  fetchImpl?: typeof fetch;
}

export function createYahooProvider(options: YahooOptions = {}): MarketProvider {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const chart = async (ticker: string, params: Record<string, string | number | undefined>) => {
    const body = await bridgeGet<ChartResponse>("yahoo", "yahoo/chart", { symbol: ticker, ...params }, doFetch);
    const result = body.chart?.result?.[0];
    if (!result) {
      throw new ProviderError("yahoo", body.chart?.error?.description ?? `no data for ${ticker}`, 404);
    }
    return result;
  };

  const requireTicker = (id: string) => {
    const ticker = toYahooTicker(id);
    if (!ticker) throw new ProviderError("yahoo", `cannot map ${id} to a Yahoo ticker`, 404);
    return ticker;
  };

  const statsFrom = (id: string, meta: ChartResult["meta"]): QuoteStats | null => {
    const last = meta.regularMarketPrice;
    if (last == null || !Number.isFinite(last)) return null;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    const change = prev ? last - prev : 0;
    return {
      symbol: id,
      last,
      change,
      changePct: prev ? (change / prev) * 100 : 0,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      prevClose: prev,
      volume: meta.regularMarketVolume,
      provider: "yahoo",
    };
  };

  // ── polling ─────────────────────────────────────────────
  let interest: string[] = [];
  let emitTick: ((tick: LiveTick) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cursor = 0;
  const lastPrice = new Map<string, number>();

  const poll = async () => {
    timer = null;
    if (interest.length === 0) return;
    const batch = interest.length <= POLL_BATCH ? interest : [];
    if (batch.length === 0) {
      for (let i = 0; i < POLL_BATCH; i++) batch.push(interest[(cursor + i) % interest.length]!);
      cursor = (cursor + POLL_BATCH) % interest.length;
    }
    let delay = POLL_MS;
    await Promise.all(
      batch.map(async (id) => {
        try {
          const result = await chart(requireTicker(id), { interval: "1d", range: "1d" });
          const price = result.meta.regularMarketPrice;
          if (price == null || !Number.isFinite(price) || lastPrice.get(id) === price) return;
          lastPrice.set(id, price);
          emitTick?.({ symbol: id, bid: price, ask: price, timestamp: Date.now() });
        } catch (err) {
          if (err instanceof ProviderError && err.status === 429) delay = POLL_BACKOFF_MS;
        }
      }),
    );
    if (interest.length > 0 && !timer) timer = setTimeout(() => void poll(), delay);
  };

  return {
    id: "yahoo",
    timeframes: Object.keys(INTERVALS),

    canHandle: (id) => toYahooTicker(id) !== null,

    async search(query, type, signal) {
      const q = query.trim();
      if (!q) return [];
      const body = await bridgeGet<{ quotes?: SearchQuote[] }>("yahoo", "yahoo/search", { q }, doFetch, signal);
      const wanted = type ? normalizeCategory(type) : null;
      const out: SymbolSearchResult[] = [];
      for (const r of body.quotes ?? []) {
        if (!r.symbol || !r.quoteType) continue;
        const category = normalizeCategory(r.quoteType);
        if (wanted && category !== wanted) continue;
        const id = fromYahooTicker(r.symbol, r.exchange);
        const { exchange, ticker } = parseId(id);
        out.push({
          id,
          symbol: ticker,
          exchange: exchange === "YAHOO" ? (r.exchDisp ?? "YAHOO") : exchange,
          description: r.longname ?? r.shortname ?? r.symbol,
          type: category.toLowerCase(),
          provider: "yahoo",
        });
      }
      return out;
    },

    async resolve(id): Promise<Symbol | null> {
      const result = await chart(requireTicker(id), { interval: "1d", range: "1d" });
      const m = result.meta;
      return makeSymbol({
        id,
        description: m.longName ?? m.shortName ?? m.symbol,
        type: m.instrumentType,
        tickSize: m.priceHint != null ? 10 ** -m.priceHint : null,
        price: m.regularMarketPrice,
      });
    },

    async getCandles(req: CandleRequest) {
      const spec = INTERVALS[req.timeframe];
      const sec = timeframeSeconds(req.timeframe);
      if (!spec || !sec) return [];
      const ticker = requireTicker(req.symbol);
      const nowSec = Math.floor(Date.now() / 1000);
      const oldestAllowed = nowSec - spec.maxDays * 86_400;
      const period2 = req.toMs != null ? Math.ceil(req.toMs / 1000) : nowSec;
      let period1: number;
      if (req.fromMs != null) {
        period1 = Math.floor(req.fromMs / 1000);
      } else {
        // Markets are shut much of the time: ask for ~3x the bars' span
        // intraday (nights, weekends), ~1.6x on daily bars (weekends).
        const factor = sec < 86_400 ? 3 : 1.6;
        period1 = period2 - Math.ceil(barsWanted(req) * sec * factor);
      }
      period1 = Math.max(period1, oldestAllowed, period2 - spec.perCallDays * 86_400);
      if (period1 >= period2) return [];
      const result = await chart(ticker, { interval: spec.interval, period1, period2, includePrePost: "false" });
      const rows = cleanCandles(chartToCandles(result));
      return windowCandles(rows, req);
    },

    async getStats(id) {
      const result = await chart(requireTicker(id), { interval: "1d", range: "1d" });
      return statsFrom(id, result.meta);
    },

    setInterest(ids, emit) {
      emitTick = emit;
      interest = ids.filter((id) => toYahooTicker(id) !== null);
      if (interest.length === 0) {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (!timer) timer = setTimeout(() => void poll(), 0);
    },

    dispose() {
      interest = [];
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
