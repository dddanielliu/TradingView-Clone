import type { CandleRequest, QuoteStats, SymbolSearchResult } from "../adapter/types.ts";

export type { QuoteStats, SymbolSearchResponse, SymbolSearchResult } from "../adapter/types.ts";
import type { Candle, Symbol } from "../services/schemas.ts";

export interface LiveTick {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
}

/**
 * One market-data source. The composite asks every provider that `canHandle`
 * an id, in the configured order, and moves on when one throws or comes back
 * empty — so a provider should throw rather than return junk.
 */
export interface MarketProvider {
  readonly id: string;
  /** The intervals served natively; others are built from these. Omitted: any. */
  readonly timeframes?: readonly string[];
  canHandle(id: string): boolean;
  search(query: string, type?: string, signal?: AbortSignal): Promise<SymbolSearchResult[]>;
  resolve(id: string): Promise<Symbol | null>;
  getCandles(request: CandleRequest): Promise<Candle[]>;
  getStats(id: string): Promise<QuoteStats | null>;
  /**
   * The ids this provider should stream now (replaces the previous set).
   * Ticks go to `emit`; an empty list stops streaming.
   */
  setInterest(ids: string[], emit: (tick: LiveTick) => void): void;
  dispose?(): void;
}

/** Thrown for a provider-side failure the composite should fall back from. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}
