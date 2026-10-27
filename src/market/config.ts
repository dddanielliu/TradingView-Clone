import { DEMO_SYMBOL_NAMES } from "../services/demo/instruments.ts";

/**
 * Which market-data providers are enabled, from `VITE_DATA_PROVIDERS`.
 *
 * A comma-separated list, tried in order for every symbol: the first provider
 * that can serve a symbol is used, and the next one takes over when it fails.
 * `demo` alone runs the bundled offline data instead of any live source.
 */

export const KNOWN_PROVIDERS = ["yahoo", "binance", "tradingview", "demo"] as const;
export type ProviderId = (typeof KNOWN_PROVIDERS)[number];

export const DEFAULT_PROVIDERS: ProviderId[] = ["yahoo", "binance", "tradingview"];

export function parseProviders(raw: string | undefined | null): ProviderId[] {
  if (!raw || !raw.trim()) return [...DEFAULT_PROVIDERS];
  const seen = new Set<ProviderId>();
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if ((KNOWN_PROVIDERS as readonly string[]).includes(id)) seen.add(id as ProviderId);
    else if (id) console.warn(`[market] unknown provider "${id}" in VITE_DATA_PROVIDERS — ignored`);
  }
  return seen.size > 0 ? [...seen] : [...DEFAULT_PROVIDERS];
}

export function getConfiguredProviders(): string[] {
  return parseProviders(import.meta.env.VITE_DATA_PROVIDERS as string | undefined);
}

/** Demo mode: the bundled offline instruments, no live provider. */
export function isDemoMode(providers: readonly string[] = getConfiguredProviders()): boolean {
  return providers.length === 1 && providers[0] === "demo";
}

export function getDefaultSymbol(providers: readonly string[] = getConfiguredProviders()): string {
  if (isDemoMode(providers)) return DEMO_SYMBOL_NAMES[0] ?? "BTCUSD";
  if (providers.includes("yahoo") || providers.includes("tradingview")) return "NASDAQ:AAPL";
  return "BINANCE:BTCUSDT";
}

export interface WatchlistSection {
  section: string;
  symbols: string[];
}

const LIVE_WATCHLIST: WatchlistSection[] = [
  { section: "INDICES", symbols: ["SP:SPX", "NASDAQ:NDX", "DJ:DJI", "TVC:VIX", "TVC:DXY"] },
  { section: "STOCKS", symbols: ["NASDAQ:AAPL", "NASDAQ:TSLA", "NASDAQ:NFLX"] },
  { section: "FUTURES", symbols: ["COMEX:GC1!", "NYMEX:CL1!"] },
  { section: "FOREX", symbols: ["FX:EURUSD", "FX:GBPUSD", "FX:USDJPY"] },
  { section: "CRYPTO", symbols: ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT"] },
];

const BINANCE_ONLY_WATCHLIST: WatchlistSection[] = [
  {
    section: "CRYPTO",
    symbols: ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT", "BINANCE:SOLUSDT", "BINANCE:BNBUSDT", "BINANCE:XRPUSDT"],
  },
];

function watchlistFor(providers: readonly string[]): WatchlistSection[] {
  if (isDemoMode(providers)) return [{ section: "CRYPTO", symbols: [...DEMO_SYMBOL_NAMES] }];
  if (!providers.includes("yahoo") && !providers.includes("tradingview")) return BINANCE_ONLY_WATCHLIST;
  return LIVE_WATCHLIST;
}

/** The watchlist a new user starts with, TradingView-style sections. */
export const DEFAULT_WATCHLIST: WatchlistSection[] = watchlistFor(getConfiguredProviders());
