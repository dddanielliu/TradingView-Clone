import type {
  CandleRequest,
  MarketDataSource,
  MarketEvent,
  Quote,
  SymbolSearchResponse,
  Unsubscribe,
} from "../adapter/types.ts";
import type { Candle, Symbol } from "../services/schemas.ts";
import { windowCandles } from "./symbols.ts";
import { aggregateTimeframe, baseTimeframe, timeframeSeconds } from "./timeframes.ts";
import { type LiveTick, type MarketProvider, ProviderError, type QuoteStats, type SymbolSearchResult } from "./types.ts";

/**
 * Bars at `req.timeframe` from one provider: asked for directly when it has
 * the interval, else built from its nearest finer native interval.
 */
export async function candlesFrom(p: MarketProvider, req: CandleRequest): Promise<Candle[]> {
  const base = baseTimeframe(req.timeframe, p.timeframes);
  if (!base) return [];
  if (base === req.timeframe) return p.getCandles(req);
  const factor = Math.ceil(timeframeSeconds(req.timeframe) / timeframeSeconds(base));
  const rows = await p.getCandles({
    ...req,
    timeframe: base,
    limit: req.limit != null && req.limit > 0 ? (req.limit + 1) * factor : req.limit,
  });
  return windowCandles(aggregateTimeframe(rows, req.timeframe), req);
}

/**
 * Several providers behind one `MarketDataSource`.
 *
 * Every request for a symbol goes to the providers that can handle its id, in
 * the configured order; when one throws (rate limit, unknown symbol, network)
 * or answers empty, the next one is tried. A provider that rate-limited is
 * moved to the back for a minute so every chart load doesn't pay for it.
 * Search asks every provider at once and merges the answers.
 */

const COOLDOWN_MS = 60_000;
const SEARCH_TIMEOUT_MS = 8_000;

export interface LiveMarketData extends MarketDataSource {
  searchSymbols(query: string, type?: string): Promise<SymbolSearchResponse>;
  resolveSymbol(symbol: string): Promise<Symbol | null>;
  getQuoteStats(symbol: string): Promise<QuoteStats | null>;
  getActiveProvider(symbol: string): string | null;
  /** Called with every resolved symbol (the live adapter registers it with the paper engine). */
  onResolved(handler: (symbol: Symbol) => void): Unsubscribe;
}

export function createCompositeMarketData(providers: MarketProvider[]): LiveMarketData {
  const handlers = new Set<(event: MarketEvent) => void>();
  const symbolListeners = new Set<() => void>();
  const providerListeners = new Set<() => void>();
  const resolvedListeners = new Set<(symbol: Symbol) => void>();
  const resolved = new Map<string, Symbol>();
  const resolving = new Map<string, Promise<Symbol | null>>();
  /** Which provider last served each symbol. */
  const active = new Map<string, string>();
  const cooling = new Map<string, number>();
  let interest: string[] = [];
  const lastQuote = new Map<string, LiveTick>();

  const notify = (set: Set<() => void>) => {
    for (const fn of [...set]) {
      try {
        fn();
      } catch (err) {
        console.error("[market] listener threw", err);
      }
    }
  };

  const emit = (tick: LiveTick) => {
    lastQuote.set(tick.symbol, tick);
    const event: MarketEvent = { type: "tick", ...tick };
    for (const h of [...handlers]) {
      try {
        h(event);
      } catch (err) {
        console.error("[market] subscriber threw", err);
      }
    }
  };

  /** Providers for an id, preferred order first, cooling-down ones last. */
  const route = (id: string): MarketProvider[] => {
    const now = Date.now();
    const able = providers.filter((p) => p.canHandle(id));
    const preferred = active.get(id);
    return [...able].sort((a, b) => {
      const ca = (cooling.get(a.id) ?? 0) > now ? 1 : 0;
      const cb = (cooling.get(b.id) ?? 0) > now ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return Number(b.id === preferred) - Number(a.id === preferred);
    });
  };

  const setActive = (id: string, provider: string) => {
    if (active.get(id) === provider) return;
    active.set(id, provider);
    notify(providerListeners);
    if (interest.includes(id)) applyInterest();
  };

  const noteFailure = (provider: string, err: unknown) => {
    if (err instanceof ProviderError && err.status === 429) cooling.set(provider, Date.now() + COOLDOWN_MS);
  };

  /** Run `op` on each provider for `id` until one gives a usable answer. */
  async function firstUsable<T>(
    id: string,
    op: (p: MarketProvider) => Promise<T>,
    usable: (value: T) => boolean,
    what: string,
  ): Promise<{ value: T; provider: string } | null> {
    const errors: string[] = [];
    let empty: { value: T; provider: string } | null = null;
    for (const p of route(id)) {
      try {
        const value = await op(p);
        if (usable(value)) return { value, provider: p.id };
        empty ??= { value, provider: p.id };
      } catch (err) {
        noteFailure(p.id, err);
        errors.push((err as Error).message);
      }
    }
    if (empty) return empty;
    if (errors.length > 0) throw new Error(`No provider could load ${what} for ${id}: ${errors.join("; ")}`);
    return null;
  }

  const providerFor = (id: string): MarketProvider | undefined => {
    const name = active.get(id);
    return (name ? providers.find((p) => p.id === name && p.canHandle(id)) : undefined) ?? route(id)[0];
  };

  function applyInterest() {
    const groups = new Map<MarketProvider, string[]>(providers.map((p) => [p, []]));
    for (const id of interest) {
      const p = providerFor(id);
      if (p) groups.get(p)!.push(id);
    }
    for (const [p, ids] of groups) p.setInterest(ids, emit);
  }

  async function resolveSymbol(id: string): Promise<Symbol | null> {
    const known = resolved.get(id);
    if (known) return known;
    let pending = resolving.get(id);
    if (!pending) {
      pending = firstUsable(id, (p) => p.resolve(id), (s) => s != null, "metadata")
        .then((hit) => {
          const symbol = hit?.value ?? null;
          if (symbol) {
            resolved.set(id, symbol);
            for (const fn of [...resolvedListeners]) fn(symbol);
            notify(symbolListeners);
          }
          return symbol;
        })
        .finally(() => resolving.delete(id));
      resolving.set(id, pending);
    }
    return pending;
  }

  return {
    getSymbols: () => Promise.resolve([...resolved.values()]),

    async getCandles(req: CandleRequest): Promise<Candle[]> {
      // Charting a symbol is reason enough to know its metadata.
      void resolveSymbol(req.symbol).catch(() => undefined);
      // A scroll-back window may legitimately be empty (weekend, pre-listing):
      // only the first provider that can serve the symbol answers it.
      const scrollBack = req.toMs != null;
      const hit = await firstUsable(
        req.symbol,
        (p) => candlesFrom(p, req),
        (rows) => rows.length > 0 || scrollBack,
        "history",
      );
      if (!hit) return [];
      if (hit.value.length > 0) setActive(req.symbol, hit.provider);
      return hit.value;
    },

    async getQuote(symbol: string): Promise<Quote | null> {
      void resolveSymbol(symbol).catch(() => undefined);
      const live = lastQuote.get(symbol);
      if (live) return { symbol, bid: live.bid, ask: live.ask, timestamp: live.timestamp };
      const hit = await firstUsable(symbol, (p) => p.getStats(symbol), (s) => s != null, "a quote").catch(() => null);
      const stats = hit?.value;
      if (!stats) return null;
      return { symbol, bid: stats.last, ask: stats.last, timestamp: Date.now() };
    },

    async getQuoteStats(symbol: string): Promise<QuoteStats | null> {
      const hit = await firstUsable(symbol, (p) => p.getStats(symbol), (s) => s != null, "a quote");
      return hit?.value ?? null;
    },

    async searchSymbols(query: string, type?: string): Promise<SymbolSearchResponse> {
      const settled = await Promise.allSettled(
        providers.map((p) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
          return p.search(query, type, controller.signal).finally(() => clearTimeout(timer));
        }),
      );
      const seen = new Set<string>();
      const results: SymbolSearchResult[] = [];
      const errors: string[] = [];
      // TradingView's own search ranks by its relevance (MSFT first for
      // "MSF"); when that provider is on, its order leads, then the others'.
      const order = providers.map((_, i) => i).sort((x, y) => Number(providers[y]!.id === "tradingview") - Number(providers[x]!.id === "tradingview"));
      order.forEach((i) => {
        const s = settled[i]!;
        if (s.status === "rejected") {
          noteFailure(providers[i]!.id, s.reason);
          const message = (s.reason as Error)?.message ?? String(s.reason);
          errors.push(message.startsWith(providers[i]!.id) ? message : `${providers[i]!.id}: ${message}`);
          return;
        }
        for (const r of s.value) {
          const key = r.id.toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          results.push(r);
        }
      });
      return { results, errors };
    },

    resolveSymbol,

    getActiveProvider: (symbol: string) => active.get(symbol) ?? null,

    onActiveProviderChange(handler) {
      providerListeners.add(handler);
      return () => providerListeners.delete(handler);
    },

    onSymbolsChange(handler) {
      symbolListeners.add(handler);
      return () => symbolListeners.delete(handler);
    },

    onResolved(handler) {
      resolvedListeners.add(handler);
      return () => resolvedListeners.delete(handler);
    },

    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    setSymbolInterest(symbols: string[]) {
      const next = [...new Set(symbols.filter(Boolean))];
      if (next.join(",") === interest.join(",")) return;
      interest = next;
      applyInterest();
    },

    connect: () => applyInterest(),

    disconnect() {
      for (const p of providers) p.setInterest([], emit);
    },
  };
}
