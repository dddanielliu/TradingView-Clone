import { isTimeframe, parseTimeframe } from "./market/timeframes.ts";
import type { Timeframe } from "./pages/trading/constants.ts";

/**
 * TradingView's chart URL: `/chart/?symbol=NASDAQ:AAPL&interval=15`.
 *
 * The app lives under `<base>chart/`; any other path is moved there (keeping
 * the query) on load. As on TradingView, `symbol` and `interval` are read once
 * at startup and the URL is only normalised (`NASDAQ:AAPL` → `NASDAQ%3AAAPL`);
 * changing the symbol or interval afterwards leaves the address bar alone and
 * updates the document title instead. A bare `/chart/` opens the last symbol.
 */

/**
 * Our timeframes ↔ TradingView's `interval` parameter: minutes as a bare
 * count (`45`, `120` for 2h), then `D` / `W` / `M` with an optional count
 * (`D`, `2D`, `3M`). `S` seconds and `T` ticks are not served.
 */
export function intervalToTimeframe(interval: string | null | undefined): Timeframe | null {
  if (!interval) return null;
  const v = interval.trim();
  if (/^\d+$/.test(v)) {
    const min = Number(v);
    if (min <= 0) return null;
    return min % 60 === 0 ? `${min / 60}h` : `${min}m`;
  }
  const m = /^(\d*)([DWM])$/i.exec(v);
  if (m) {
    const n = m[1] ? Number(m[1]) : 1;
    if (n <= 0) return null;
    const unit = m[2]!.toUpperCase() === "D" ? "d" : m[2]!.toUpperCase() === "W" ? "w" : "M";
    return `${n}${unit}`;
  }
  // Our own spelling ("15m", "4h", "1d") is accepted too.
  const h = /^(\d+)H$/.exec(v);
  if (h) return isTimeframe(`${h[1]}h`) ? (`${h[1]}h` as Timeframe) : null;
  return isTimeframe(v) ? v : null;
}

export function timeframeToInterval(tf: Timeframe): string {
  const p = parseTimeframe(tf);
  if (!p) return tf;
  if (p.unit === "m") return String(p.n);
  if (p.unit === "h") return String(p.n * 60);
  const letter = p.unit.toUpperCase();
  return p.n === 1 ? letter : `${p.n}${letter}`;
}

function basePath(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

export function chartPath(): string {
  return `${basePath()}chart/`;
}

export interface ChartUrlState {
  symbol: string | null;
  timeframe: Timeframe | null;
}

/** The symbol and interval in the current URL, decoded. */
export function readChartUrl(search = typeof window === "undefined" ? "" : window.location.search): ChartUrlState {
  const params = new URLSearchParams(search);
  const symbol = params.get("symbol")?.trim().toUpperCase() || null;
  return { symbol, timeframe: intervalToTimeframe(params.get("interval")) };
}

/** Build `/chart/?symbol=…&interval=…`, keeping any other parameters. */
export function buildChartUrl(symbol: string, tf: Timeframe, search = ""): string {
  const params = new URLSearchParams(search);
  params.set("symbol", symbol);
  params.set("interval", timeframeToInterval(tf));
  return `${chartPath()}?${params.toString()}`;
}

/**
 * Move a page opened anywhere else (e.g. `/`) onto `/chart/`, keeping the
 * query, and normalise the query's encoding the way TradingView does.
 */
export function ensureChartPath(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  const query = params.toString();
  const next = `${chartPath()}${query ? `?${query}` : ""}${hash}`;
  if (`${pathname}${search}${hash}` !== next) window.history.replaceState(null, "", next);
}

/** TradingView's tab title: `AAPL 342.15 ▼ −1.60%`. */
export function chartTitle(symbol: string, last?: number, changePct?: number, digits = 2): string {
  const ticker = symbol.includes(":") ? symbol.slice(symbol.indexOf(":") + 1) : symbol;
  if (last == null || !Number.isFinite(last)) return ticker;
  const price = last.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (changePct == null || !Number.isFinite(changePct) || changePct === 0) return `${ticker} ${price} 0%`;
  const arrow = changePct > 0 ? "▲" : "▼";
  const sign = changePct > 0 ? "+" : "−";
  return `${ticker} ${price} ${arrow} ${sign}${Math.abs(changePct).toFixed(2)}%`;
}

const LAST_SYMBOL_KEY = "last_symbol";

/** The symbol a bare `/chart/` opens on. */
export function readLastSymbol(): string | null {
  try {
    return window.localStorage.getItem(LAST_SYMBOL_KEY);
  } catch {
    return null;
  }
}

export function writeLastSymbol(symbol: string): void {
  try {
    window.localStorage.setItem(LAST_SYMBOL_KEY, symbol);
  } catch {
    // Private mode / blocked storage: the default symbol is used next time.
  }
}
