/**
 * Live market data: any instrument, from the providers listed in
 * `VITE_DATA_PROVIDERS`. See src/adapter/live.ts for the adapter and
 * server/market-bridge.ts for the server half.
 */
export type { QuoteStats, SymbolSearchResponse, SymbolSearchResult } from "./types.ts";
export {
  DEFAULT_WATCHLIST,
  getConfiguredProviders,
  getDefaultSymbol,
  isDemoMode,
  type WatchlistSection,
} from "./config.ts";
export {
  useActiveProvider,
  useMarketInterest,
  useQuoteStats,
  useResolvedSymbol,
  useSymbolSearch,
  useSymbolSessions,
} from "./hooks.ts";
export {
  countdownText,
  daySegments,
  marketStatusAt,
  nextSessionEdge,
  timezoneLabel,
  type MarketStatus,
  type SymbolSessions,
} from "./session.ts";
export { parseId, toYahooTicker, fromYahooTicker } from "./symbols.ts";
