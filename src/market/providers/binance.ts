import type { CandleRequest } from "../../adapter/types.ts";
import type { Candle, Symbol } from "../../services/schemas.ts";
import { barsWanted, cleanCandles, makeSymbol, parseId, timeframeSeconds, windowCandles } from "../symbols.ts";
import {
  type LiveTick,
  type MarketProvider,
  ProviderError,
  type QuoteStats,
  type SymbolSearchResult,
} from "../types.ts";

/**
 * Binance spot, straight from the browser (its public REST and websocket
 * endpoints allow CORS). Ids are `BINANCE:<PAIR>`, e.g. `BINANCE:BTCUSDT`.
 * Live ticks are best bid/ask from `@bookTicker`.
 */

const REST = "https://api.binance.com/api/v3";
const WS = "wss://stream.binance.com:9443/ws";
/** Binance serves at most this many klines per call. */
const PAGE = 1000;
/** Deep requests are capped so one chart load can't fire dozens of calls. */
const MAX_PAGES = 5;
/** bookTicker fires many times a second; one tick per symbol per interval is plenty. */
const TICK_THROTTLE_MS = 150;

interface ExchangeSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: Array<{ filterType: string; tickSize?: string }>;
}

type Kline = [number, string, string, string, string, string, ...unknown[]];

export function toBinancePair(id: string): string | null {
  const { exchange, ticker } = parseId(id);
  return exchange === "BINANCE" && /^[A-Z0-9]+$/.test(ticker) ? ticker : null;
}

export function klineToCandle(k: Kline): Candle {
  return {
    time: Math.floor(k[0] / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  };
}

export interface BinanceOptions {
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
}

export function createBinanceProvider(options: BinanceOptions = {}): MarketProvider {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const SocketImpl = options.webSocketImpl ?? globalThis.WebSocket;

  async function getJson<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(url);
    } catch (err) {
      throw new ProviderError("binance", `network error (${(err as Error).message})`);
    }
    if (!res.ok) throw new ProviderError("binance", `HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  // exchangeInfo is large; fetch it once per page load.
  let infoPromise: Promise<Map<string, ExchangeSymbol>> | null = null;
  const exchangeInfo = () => {
    infoPromise ??= getJson<{ symbols: ExchangeSymbol[] }>(`${REST}/exchangeInfo?permissions=SPOT`)
      .then((data) => new Map(data.symbols.filter((s) => s.status === "TRADING").map((s) => [s.symbol, s])))
      .catch((err: unknown) => {
        infoPromise = null;
        throw err;
      });
    return infoPromise;
  };

  async function fetchKlines(pair: string, interval: string, limit: number, endTime?: number) {
    const params = new URLSearchParams({ symbol: pair, interval, limit: String(limit) });
    if (endTime != null) params.set("endTime", String(endTime));
    const rows = await getJson<Kline[]>(`${REST}/klines?${params.toString()}`);
    return Array.isArray(rows) ? rows.map(klineToCandle) : [];
  }

  // ── streaming ───────────────────────────────────────────
  let socket: WebSocket | null = null;
  let wanted = new Set<string>();
  let subscribed = new Set<string>();
  let emitTick: ((tick: LiveTick) => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let msgId = 1;
  const lastEmit = new Map<string, number>();

  const send = (method: "SUBSCRIBE" | "UNSUBSCRIBE", pairs: string[]) => {
    if (!socket || socket.readyState !== 1 || pairs.length === 0) return;
    socket.send(JSON.stringify({ method, params: pairs.map((p) => `${p.toLowerCase()}@bookTicker`), id: msgId++ }));
  };

  const sync = () => {
    if (!socket || socket.readyState !== 1) return;
    const add = [...wanted].filter((p) => !subscribed.has(p));
    const drop = [...subscribed].filter((p) => !wanted.has(p));
    send("SUBSCRIBE", add);
    send("UNSUBSCRIBE", drop);
    subscribed = new Set(wanted);
  };

  const open = () => {
    if (socket || wanted.size === 0 || !SocketImpl) return;
    const ws = new SocketImpl(WS);
    socket = ws;
    subscribed = new Set();
    ws.onopen = () => {
      attempt = 0;
      sync();
    };
    ws.onmessage = (message: MessageEvent) => {
      try {
        const d = JSON.parse(String(message.data)) as { s?: string; b?: string; a?: string };
        if (!d.s || d.b == null || d.a == null) return;
        const now = Date.now();
        if (now - (lastEmit.get(d.s) ?? 0) < TICK_THROTTLE_MS) return;
        lastEmit.set(d.s, now);
        emitTick?.({ symbol: `BINANCE:${d.s}`, bid: Number(d.b), ask: Number(d.a), timestamp: now });
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (wanted.size === 0) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
      reconnectTimer = setTimeout(open, delay);
    };
  };

  const close = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const ws = socket;
    socket = null;
    ws?.close();
  };

  return {
    id: "binance",
    // Binance's kline intervals, which use the same spelling as ours.
    timeframes: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"],

    canHandle: (id) => toBinancePair(id) !== null,

    async search(query) {
      const q = query.trim().toUpperCase().replace(/^BINANCE:/, "").replace(/[^A-Z0-9]/g, "");
      if (!q) return [];
      const info = await exchangeInfo();
      const scored: Array<{ s: ExchangeSymbol; score: number }> = [];
      for (const s of info.values()) {
        let score = -1;
        if (s.symbol === q) score = 0;
        else if (s.baseAsset === q) score = 1;
        else if (s.symbol.startsWith(q)) score = 2;
        else if (s.symbol.includes(q)) score = 3;
        if (score >= 0) scored.push({ s, score });
      }
      // Prefer the USDT pair of a base asset, the way most charts are read.
      scored.sort((a, b) => a.score - b.score || Number(b.s.quoteAsset === "USDT") - Number(a.s.quoteAsset === "USDT") || a.s.symbol.length - b.s.symbol.length);
      return scored.slice(0, 30).map(({ s }): SymbolSearchResult => ({
        id: `BINANCE:${s.symbol}`,
        symbol: s.symbol,
        exchange: "BINANCE",
        description: `${s.baseAsset} / ${s.quoteAsset}`,
        type: "crypto",
        currency: s.quoteAsset,
        provider: "binance",
      }));
    },

    async resolve(id): Promise<Symbol | null> {
      const pair = toBinancePair(id);
      if (!pair) return null;
      const s = (await exchangeInfo()).get(pair);
      if (!s) return null;
      const tick = Number(s.filters.find((f) => f.filterType === "PRICE_FILTER")?.tickSize);
      return makeSymbol({
        id: `BINANCE:${pair}`,
        description: `${s.baseAsset} / ${s.quoteAsset}`,
        type: "crypto",
        tickSize: Number.isFinite(tick) && tick > 0 ? tick : null,
      });
    },

    async getCandles(req: CandleRequest) {
      const pair = toBinancePair(req.symbol);
      if (!pair || !timeframeSeconds(req.timeframe)) return [];
      const want = barsWanted(req);
      // `toMs` is exclusive in the contract, Binance's endTime inclusive.
      let endTime = req.toMs != null ? Math.floor(req.toMs) - 1 : undefined;
      const startTime = req.fromMs != null ? Math.floor(req.fromMs) : undefined;
      const pages: Candle[][] = [];
      let got = 0;
      for (let i = 0; i < MAX_PAGES && got < want; i++) {
        const asked = Math.min(PAGE, want - got);
        // Always walk backwards from endTime: with a startTime Binance would
        // answer from the start of the window, not its newest end.
        const batch = await fetchKlines(pair, req.timeframe, asked, endTime);
        if (batch.length === 0) break;
        pages.unshift(batch);
        got += batch.length;
        const oldest = batch[0]!.time * 1000;
        // A short page means the start of the listing (or of the window) was reached.
        if (batch.length < asked) break;
        if (startTime != null && oldest <= startTime) break;
        endTime = oldest - 1;
      }
      return windowCandles(cleanCandles(pages.flat()), req);
    },

    async getStats(id): Promise<QuoteStats | null> {
      const pair = toBinancePair(id);
      if (!pair) return null;
      const d = await getJson<Record<string, string>>(`${REST}/ticker/24hr?symbol=${pair}`);
      const last = Number(d.lastPrice);
      if (!Number.isFinite(last)) return null;
      return {
        symbol: `BINANCE:${pair}`,
        last,
        change: Number(d.priceChange),
        changePct: Number(d.priceChangePercent),
        open: Number(d.openPrice),
        high: Number(d.highPrice),
        low: Number(d.lowPrice),
        prevClose: Number(d.prevClosePrice),
        volume: Number(d.volume),
        provider: "binance",
      };
    },

    setInterest(ids, emit) {
      emitTick = emit;
      wanted = new Set(ids.map(toBinancePair).filter((p): p is string => p !== null));
      if (wanted.size === 0) {
        close();
        return;
      }
      if (!socket) open();
      else sync();
    },

    dispose() {
      wanted = new Set();
      close();
    },
  };
}
