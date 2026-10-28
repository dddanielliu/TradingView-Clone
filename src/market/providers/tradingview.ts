import type { CandleRequest } from "../../adapter/types.ts";
import type { Candle, Symbol } from "../../services/schemas.ts";
import { barsWanted, cleanCandles, makeSymbol, parseId, tickFromPricescale, timeframeSeconds, windowCandles } from "../symbols.ts";
import {
  type LiveTick,
  type MarketProvider,
  ProviderError,
  type QuoteStats,
  type SymbolSearchResult,
} from "../types.ts";
import { STANDARD_TIMEFRAMES } from "../timeframes.ts";

const TV_TIMEFRAMES = STANDARD_TIMEFRAMES.filter((tf) => tf !== "2m" && tf !== "10m");
import { bridgeGet, bridgeUrl } from "./http.ts";

/**
 * TradingView's own feed via the unofficial Mathieu2301/TradingView-API
 * library, run by the market bridge (it needs a websocket `Origin` header a
 * browser can't set). Handles any `EXCHANGE:TICKER` id.
 *
 * Opt-in and at your own risk: it is not an official API, it can break when
 * TradingView changes its protocol, and using it may conflict with
 * TradingView's terms. Anonymous access gets limited intraday history.
 */

interface TvSearchResult {
  id: string;
  exchange: string;
  symbol: string;
  description: string;
  type: string;
  currency?: string;
  country?: string;
}

interface TvSymbolInfo {
  pro_name?: string;
  full_name?: string;
  description?: string;
  type?: string;
  pricescale?: number;
  minmov?: number;
}

interface TvQuote {
  lp?: number;
  ch?: number;
  chp?: number;
  bid?: number;
  ask?: number;
  volume?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  prev_close_price?: number;
}

/** Live quotes arrive as SSE; reopen the stream at most this often when interest changes. */
const RESUBSCRIBE_DEBOUNCE_MS = 250;

export interface TradingViewOptions {
  fetchImpl?: typeof fetch;
  eventSourceImpl?: typeof EventSource;
}

export function createTradingViewProvider(options: TradingViewOptions = {}): MarketProvider {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const SourceImpl = options.eventSourceImpl ?? globalThis.EventSource;

  let source: EventSource | null = null;
  let streaming = "";
  let pending: ReturnType<typeof setTimeout> | null = null;
  let emitTick: ((tick: LiveTick) => void) | null = null;

  const reopen = (ids: string[]) => {
    const key = [...ids].sort().join(",");
    if (key === streaming && source) return;
    source?.close();
    source = null;
    streaming = key;
    if (!key || !SourceImpl) return;
    const es = new SourceImpl(`${bridgeUrl("tv/stream")}?symbols=${encodeURIComponent(key)}`);
    source = es;
    es.onmessage = (event: MessageEvent) => {
      try {
        const q = JSON.parse(String(event.data)) as TvQuote & { symbol?: string };
        if (!q.symbol) return;
        const lp = q.lp;
        // Outside trading hours TradingView sends bid / ask as 0 (not absent);
        // the last price stands in for them then.
        const quoted = (v: number | undefined) => (v != null && Number.isFinite(v) && v !== 0 ? v : undefined);
        const bid = quoted(q.bid) ?? lp;
        const ask = quoted(q.ask) ?? lp;
        if (bid == null || ask == null || !Number.isFinite(bid) || !Number.isFinite(ask)) return;
        emitTick?.({ symbol: q.symbol, bid, ask, timestamp: Date.now() });
      } catch {
        // Ignore a malformed event; the next one replaces it.
      }
    };
    // EventSource reconnects by itself after an error.
  };

  return {
    id: "tradingview",
    // The resolutions an anonymous session serves: our standard list less 2m
    // and 10m, which (like "7m") it answers with `custom_resolution`, so
    // those are built from 1m / 5m bars.
    timeframes: TV_TIMEFRAMES,

    canHandle: (id) => {
      const { exchange, ticker } = parseId(id);
      return !!exchange && !!ticker && exchange !== "YAHOO";
    },

    async search(query, type, signal) {
      const q = query.trim();
      if (!q) return [];
      const rows = await bridgeGet<TvSearchResult[]>("tradingview", "tv/search", { q, type }, doFetch, signal);
      return rows.map(
        (r): SymbolSearchResult => ({
          id: r.id || `${r.exchange}:${r.symbol}`,
          symbol: r.symbol,
          exchange: r.exchange,
          description: r.description,
          type: r.type,
          currency: r.currency,
          country: r.country,
          provider: "tradingview",
        }),
      );
    },

    async resolve(id): Promise<Symbol | null> {
      const info = await bridgeGet<TvSymbolInfo>("tradingview", "tv/symbol", { symbol: id }, doFetch);
      return makeSymbol({
        // Keep the id the user asked for so routing and URLs stay stable.
        id,
        description: info.description,
        type: info.type,
        tickSize: tickFromPricescale(info.pricescale, info.minmov),
      });
    },

    async getCandles(req: CandleRequest): Promise<Candle[]> {
      if (!timeframeSeconds(req.timeframe)) return [];
      const params: Record<string, string | number | undefined> = {
        symbol: req.symbol,
        timeframe: req.timeframe,
      };
      if (req.fromMs != null) params.from = Math.floor(req.fromMs / 1000);
      else params.count = Math.min(barsWanted(req), 20_000);
      // `to` is the newest bar time the server returns (inclusive); toMs is exclusive.
      if (req.toMs != null) params.to = Math.floor(req.toMs / 1000) - 1;
      let rows: Candle[];
      try {
        rows = await bridgeGet<Candle[]>("tradingview", "tv/candles", params, doFetch);
      } catch (err) {
        // No bars in a scroll-back window is an empty answer, not a failure.
        if (err instanceof ProviderError && err.status === 404 && req.toMs != null) return [];
        throw err;
      }
      return windowCandles(cleanCandles(rows), req);
    },

    async getStats(id): Promise<QuoteStats | null> {
      const quotes = await bridgeGet<Record<string, TvQuote>>("tradingview", "tv/quotes", { symbols: id }, doFetch);
      const q = quotes[id] ?? Object.values(quotes)[0];
      if (!q || q.lp == null || !Number.isFinite(q.lp)) return null;
      return {
        symbol: id,
        last: q.lp,
        change: q.ch ?? 0,
        changePct: q.chp ?? 0,
        open: q.open_price,
        high: q.high_price,
        low: q.low_price,
        prevClose: q.prev_close_price,
        volume: q.volume,
        provider: "tradingview",
      };
    },

    setInterest(ids, emit) {
      emitTick = emit;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        reopen(ids);
      }, RESUBSCRIBE_DEBOUNCE_MS);
    },

    dispose() {
      if (pending) clearTimeout(pending);
      pending = null;
      source?.close();
      source = null;
      streaming = "";
    },
  };
}
