import type { Candle, Symbol } from "../services/schemas.ts";
import { timeframeSeconds } from "./timeframes.ts";

/**
 * Symbol ids, timeframes and bar helpers shared by every provider.
 *
 * Ids are TradingView-style `EXCHANGE:TICKER` (`NASDAQ:AAPL`, `BINANCE:BTCUSDT`,
 * `FX:EURUSD`, `COMEX:GC1!`). Each provider translates them to its own
 * spelling; this module holds the translations so they can be unit-tested
 * without a network.
 */

export { timeframeSeconds, type Timeframe as AppTimeframe } from "./timeframes.ts";

export interface ParsedId {
  exchange: string;
  ticker: string;
}

/** `"NASDAQ:AAPL"` → `{ exchange: "NASDAQ", ticker: "AAPL" }`; a bare ticker has no exchange. */
export function parseId(id: string): ParsedId {
  const trimmed = id.trim();
  const i = trimmed.indexOf(":");
  if (i <= 0) return { exchange: "", ticker: trimmed.toUpperCase() };
  return {
    exchange: trimmed.slice(0, i).toUpperCase(),
    ticker: trimmed.slice(i + 1).toUpperCase(),
  };
}

// ── Yahoo ↔ TradingView ids ─────────────────────────────────

/** Exchanges whose tickers Yahoo spells exactly the same, with no suffix. */
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "ARCA", "NYSEARCA", "BATS", "CBOE", "OTC"]);

/** TradingView exchange → Yahoo ticker suffix. */
const YAHOO_SUFFIX: Record<string, string> = {
  LSE: ".L",
  TSE: ".T",
  XETR: ".DE",
  FWB: ".F",
  HKEX: ".HK",
  TSX: ".TO",
  TSXV: ".V",
  ASX: ".AX",
  EURONEXT: ".PA",
  SIX: ".SW",
  BME: ".MC",
  MIL: ".MI",
  NSE: ".NS",
  BSE: ".BO",
  KRX: ".KS",
  SSE: ".SS",
  SZSE: ".SZ",
  TWSE: ".TW",
  SGX: ".SI",
  OMXSTO: ".ST",
  OSL: ".OL",
  BMFBOVESPA: ".SA",
};

/** Well-known indices and continuous futures, both ways. */
const YAHOO_SPECIAL: Record<string, string> = {
  "SP:SPX": "^GSPC",
  "TVC:SPX": "^GSPC",
  "NASDAQ:NDX": "^NDX",
  "NASDAQ:IXIC": "^IXIC",
  "DJ:DJI": "^DJI",
  "TVC:DJI": "^DJI",
  "TVC:VIX": "^VIX",
  "CBOE:VIX": "^VIX",
  "TVC:DXY": "DX-Y.NYB",
  "TVC:RUT": "^RUT",
  "TVC:UKX": "^FTSE",
  "XETR:DAX": "^GDAXI",
  "TVC:NI225": "^N225",
  "TVC:HSI": "^HSI",
  "COMEX:GC1!": "GC=F",
  "COMEX:SI1!": "SI=F",
  "COMEX:HG1!": "HG=F",
  "NYMEX:CL1!": "CL=F",
  "NYMEX:NG1!": "NG=F",
  "CME_MINI:ES1!": "ES=F",
  "CME_MINI:NQ1!": "NQ=F",
  "CBOT_MINI:YM1!": "YM=F",
  "CME:6E1!": "6E=F",
  "TVC:GOLD": "GC=F",
  "TVC:SILVER": "SI=F",
  "TVC:USOIL": "CL=F",
};

const YAHOO_SPECIAL_REVERSE: Record<string, string> = {};
for (const [tv, y] of Object.entries(YAHOO_SPECIAL)) {
  // First spelling wins, so the reverse map picks the canonical TradingView id.
  YAHOO_SPECIAL_REVERSE[y] ??= tv;
}

const FX_EXCHANGES = new Set(["FX", "FX_IDC", "OANDA", "FOREXCOM", "FXCM", "SAXO", "PEPPERSTONE"]);
const CRYPTO_EXCHANGES = new Set([
  "COINBASE",
  "BITSTAMP",
  "KRAKEN",
  "CRYPTO",
  "BITFINEX",
  "GEMINI",
  "CRYPTOCAP",
]);
const CRYPTO_QUOTES = ["USDT", "USDC", "USD", "EUR", "GBP", "BTC", "ETH"];

/** A TradingView-style id as a Yahoo ticker, or null when there is no sound mapping. */
export function toYahooTicker(id: string): string | null {
  const special = YAHOO_SPECIAL[id.trim().toUpperCase()];
  if (special) return special;
  const { exchange, ticker } = parseId(id);
  if (!ticker) return null;
  if (exchange === "YAHOO") return id.trim().slice(id.indexOf(":") + 1);
  if (!exchange || US_EXCHANGES.has(exchange)) return ticker.replace(/\./g, "-");
  if (FX_EXCHANGES.has(exchange)) return /^[A-Z]{6}$/.test(ticker) ? `${ticker}=X` : null;
  if (CRYPTO_EXCHANGES.has(exchange)) {
    const quote = CRYPTO_QUOTES.find((q) => ticker.endsWith(q) && ticker.length > q.length);
    if (!quote) return null;
    // Yahoo quotes crypto in fiat; stablecoin pairs read as USD.
    const fiat = quote === "USDT" || quote === "USDC" ? "USD" : quote;
    return `${ticker.slice(0, -quote.length)}-${fiat}`;
  }
  const suffix = YAHOO_SUFFIX[exchange];
  return suffix ? `${ticker}${suffix}` : null;
}

/** Yahoo's exchange codes → TradingView exchange names. */
const YAHOO_EXCHANGE_TO_TV: Record<string, string> = {
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NCM: "NASDAQ",
  NAS: "NASDAQ",
  NYQ: "NYSE",
  NYS: "NYSE",
  ASE: "AMEX",
  PCX: "AMEX",
  BTS: "BATS",
  PNK: "OTC",
  OQB: "OTC",
};

/**
 * A Yahoo ticker (and its search-result exchange code) as a TradingView-style
 * id. Falls back to `YAHOO:<ticker>` so the symbol still routes back to Yahoo.
 */
export function fromYahooTicker(ticker: string, yahooExchange?: string): string {
  const raw = ticker.trim();
  const upper = raw.toUpperCase();
  const special = YAHOO_SPECIAL_REVERSE[upper];
  if (special) return special;
  if (upper.endsWith("=X") && /^[A-Z]{6}=X$/.test(upper)) return `FX:${upper.slice(0, 6)}`;
  const crypto = /^([A-Z0-9]+)-(USD|EUR|GBP|BTC|ETH)$/.exec(upper);
  if (crypto && (yahooExchange === "CCC" || !yahooExchange)) {
    return `COINBASE:${crypto[1]}${crypto[2]}`;
  }
  for (const [exchange, suffix] of Object.entries(YAHOO_SUFFIX)) {
    if (upper.endsWith(suffix.toUpperCase())) return `${exchange}:${upper.slice(0, -suffix.length)}`;
  }
  const tvExchange = yahooExchange ? YAHOO_EXCHANGE_TO_TV[yahooExchange.toUpperCase()] : undefined;
  if (tvExchange && /^[A-Z0-9-]+$/.test(upper)) return `${tvExchange}:${upper.replace(/-/g, ".")}`;
  return `YAHOO:${raw}`;
}

// ── Instrument metadata ─────────────────────────────────────

const CATEGORY_ALIASES: Record<string, string> = {
  EQUITY: "STOCK",
  STOCK: "STOCK",
  DR: "STOCK",
  ETF: "FUND",
  FUND: "FUND",
  MUTUALFUND: "FUND",
  CURRENCY: "FOREX",
  FOREX: "FOREX",
  CRYPTOCURRENCY: "CRYPTO",
  CRYPTO: "CRYPTO",
  SPOT: "CRYPTO",
  INDEX: "INDEX",
  FUTURE: "FUTURES",
  FUTURES: "FUTURES",
  CFD: "CFD",
  BOND: "BOND",
  ECONOMIC: "ECONOMIC",
};

export function normalizeCategory(type: string | undefined | null): string {
  if (!type) return "OTHER";
  const key = type.replace(/[^a-z]/gi, "").toUpperCase();
  return CATEGORY_ALIASES[key] ?? key ?? "OTHER";
}

/** Guess a tick size when a provider gives none: enough decimals for the price. */
export function defaultTickSize(price: number | undefined, category?: string): number {
  if (category === "FOREX") return price != null && price > 20 ? 0.001 : 0.00001;
  if (price == null || !Number.isFinite(price) || price <= 0) return 0.01;
  if (price >= 1000) return 0.01;
  if (price >= 1) return 0.01;
  if (price >= 0.01) return 0.0001;
  return 0.00000001;
}

/** TradingView expresses the tick as minmov / pricescale. */
export function tickFromPricescale(pricescale?: number, minmov?: number): number | null {
  if (!pricescale || pricescale <= 0) return null;
  return (minmov && minmov > 0 ? minmov : 1) / pricescale;
}

export interface SymbolSpecInput {
  id: string;
  description?: string;
  type?: string;
  tickSize?: number | null;
  price?: number;
}

/** A `Symbol` record for any instrument, in the shape the terminal and paper engine use. */
export function makeSymbol({ id, description, type, tickSize, price }: SymbolSpecInput): Symbol {
  const category = normalizeCategory(type);
  const tick = tickSize && tickSize > 0 ? tickSize : defaultTickSize(price, category);
  return {
    id,
    name: id,
    displayName: description || parseId(id).ticker,
    category,
    contractSize: 1,
    tickSize: tick,
    tickValue: tick,
    marginPercent: category === "STOCK" || category === "FUND" ? 20 : 1,
    maxLeverage: category === "STOCK" || category === "FUND" ? 5 : 100,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  };
}

// ── Bars ───────────────────────────────────────────────────

/** Sort oldest first, drop non-finite rows and keep the last bar seen for each time. */
export function cleanCandles(rows: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of rows) {
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) continue;
    byTime.set(c.time, { ...c, volume: Number.isFinite(c.volume) ? c.volume : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Merge bars into buckets of `bucketSec` (e.g. 1h → 4h). Buckets are aligned to
 * the epoch, which matches how the chart buckets live ticks.
 */
export function aggregateCandles(rows: Candle[], bucketSec: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of cleanCandles(rows)) {
    const bucket = Math.floor(c.time / bucketSec) * bucketSec;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Apply the adapter contract's window to bars: `fromMs` inclusive, `toMs`
 * exclusive, then the most recent `limit`.
 */
export function windowCandles(
  rows: Candle[],
  req: { limit?: number; fromMs?: number; toMs?: number },
): Candle[] {
  let out = rows;
  if (req.fromMs != null) out = out.filter((c) => c.time * 1000 >= req.fromMs!);
  if (req.toMs != null) out = out.filter((c) => c.time * 1000 < req.toMs!);
  if (req.limit != null && req.limit > 0 && out.length > req.limit) out = out.slice(-req.limit);
  return out;
}

/**
 * How many bars a request asks for: its `limit`, or enough to cover a
 * `fromMs`…`toMs` window (the chart's scroll-back sends a window, no limit).
 */
export function barsWanted(
  req: { timeframe: string; limit?: number; fromMs?: number; toMs?: number },
  fallback = 500,
): number {
  if (req.limit != null && req.limit > 0) return Math.floor(req.limit);
  const sec = timeframeSeconds(req.timeframe) || 60;
  if (req.fromMs != null) {
    const to = req.toMs ?? Date.now();
    return Math.max(1, Math.ceil((to - req.fromMs) / (sec * 1000)) + 1);
  }
  return fallback;
}
