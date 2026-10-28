import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { getAdapter, hasAdapter } from "../adapter/registry.ts";
import { api } from "../services/api.ts";
import type { Symbol } from "../services/schemas.ts";
import { useTradingStore } from "../services/store.tsx";
import { bridgeGet } from "./providers/http.ts";
import type { SymbolSessions } from "./session.ts";
import type { QuoteStats, SymbolSearchResult } from "./types.ts";

const SEARCH_DEBOUNCE_MS = 250;
const STATS_POLL_MS = 10_000;

/** Debounced symbol search across every enabled provider. */
export function useSymbolSearch(
  query: string,
  type?: string,
): { results: SymbolSearchResult[]; loading: boolean; errors: string[] } {
  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["market", "search", debounced, type ?? ""],
    queryFn: () => api.searchSymbols(debounced, type),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  return {
    results: data?.results ?? [],
    loading: isFetching || debounced !== query.trim(),
    errors: data?.errors ?? [],
  };
}

/**
 * Metadata for one symbol id. Resolving registers it, so it then shows up in
 * `useSymbols()` and the paper engine can trade it.
 */
export function useResolvedSymbol(id: string): {
  symbol: Symbol | undefined;
  loading: boolean;
  error: string | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ["market", "resolve", id],
    queryFn: () => api.resolveSymbol(id),
    enabled: !!id,
    staleTime: Infinity,
    retry: 1,
  });
  return {
    symbol: data ?? undefined,
    loading: isLoading,
    error: error ? (error as Error).message : data === null ? `Unknown symbol ${id}` : null,
  };
}

/**
 * Last price and day change for a list of symbols (watchlist columns, symbol
 * details). Polled every 10s; `last` and the change follow live ticks between
 * polls.
 */
export function useQuoteStats(symbols: string[]): Record<string, QuoteStats> {
  const key = useMemo(() => [...new Set(symbols)].sort(), [symbols]);
  const { data } = useQuery({
    queryKey: ["market", "stats", ...key],
    queryFn: async () => {
      const settled = await Promise.allSettled(key.map((s) => api.getQuoteStats(s)));
      const out: Record<string, QuoteStats> = {};
      settled.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value) out[key[i]!] = r.value;
      });
      return out;
    },
    enabled: key.length > 0,
    refetchInterval: STATS_POLL_MS,
    staleTime: STATS_POLL_MS / 2,
    placeholderData: (prev) => prev,
  });

  const ticks = useTradingStore((s) => s.ticks);
  return useMemo(() => {
    const out: Record<string, QuoteStats> = {};
    for (const s of key) {
      const base = data?.[s];
      const tick = ticks[s];
      if (!base) continue;
      if (!tick || !(tick.bid > 0)) {
        out[s] = base;
        continue;
      }
      const last = (tick.bid + tick.ask) / 2;
      // Re-derive the change from the reference close, so it moves with the price.
      const prev = base.prevClose ?? base.last - base.change;
      const change = last - prev;
      out[s] = {
        ...base,
        last,
        change,
        changePct: prev ? (change / prev) * 100 : base.changePct,
        high: base.high != null ? Math.max(base.high, last) : undefined,
        low: base.low != null ? Math.min(base.low, last) : undefined,
      };
    }
    return out;
  }, [key, data, ticks]);
}

// Interest from every mounted component, unioned, so a watchlist and a chart
// don't overwrite each other's subscriptions.
const interestByOwner = new Map<string, string[]>();
let lastInterest = "";

function pushInterest(): void {
  if (!hasAdapter()) return;
  const union = [...new Set([...interestByOwner.values()].flat())].sort();
  const key = union.join(",");
  if (key === lastInterest) return;
  lastInterest = key;
  getAdapter().marketData.setSymbolInterest?.(union);
}

/** Stream live prices for these symbols while the calling component is mounted. */
export function useMarketInterest(symbols: string[]): void {
  const owner = useId();
  const key = [...new Set(symbols.filter(Boolean))].sort().join(",");
  useEffect(() => {
    interestByOwner.set(owner, key ? key.split(",") : []);
    pushInterest();
    return () => {
      interestByOwner.delete(owner);
      pushInterest();
    };
  }, [owner, key]);
}

/** Which provider is serving `symbol` right now (null until its history loads). */
export function useActiveProvider(symbol: string): string | null {
  const subscribe = useCallback((onChange: () => void) => {
    if (!hasAdapter()) return () => undefined;
    return getAdapter().marketData.onActiveProviderChange?.(onChange) ?? (() => undefined);
  }, []);
  const read = useCallback(() => {
    if (!hasAdapter()) return null;
    const md = getAdapter().marketData;
    return md.getActiveProvider ? md.getActiveProvider(symbol) : (getAdapter().name ?? null);
  }, [symbol]);
  return useSyncExternalStore(subscribe, read, read);
}

interface TvSubsession {
  id: string;
  session: string;
  "session-display"?: string;
}

interface TvSymbolInfo {
  timezone?: string;
  session?: string;
  session_display?: string;
  session_holidays?: string;
  subsessions?: TvSubsession[];
}

/**
 * A symbol's trading sessions from TradingView's symbol info (the regular
 * session, the pre-market / post-market / night sub-sessions, the holidays),
 * for the legend's market status. Null until known, or when TradingView does
 * not know the symbol.
 */
export function useSymbolSessions(symbol: string): SymbolSessions | null {
  const { data } = useQuery({
    queryKey: ["market", "tv-sessions", symbol],
    queryFn: async (): Promise<SymbolSessions | null> => {
      const info = await bridgeGet<TvSymbolInfo>("tradingview", "tv/symbol", { symbol }, fetch);
      if (!info.timezone || !(info.session_display ?? info.session)) return null;
      const sub = (id: string) => {
        const s = info.subsessions?.find((x) => x.id === id);
        return s ? (s["session-display"] ?? s.session) : undefined;
      };
      return {
        timezone: info.timezone,
        session: (info.session_display ?? info.session)!,
        preMarket: sub("premarket"),
        postMarket: sub("postmarket"),
        night: sub("night"),
        holidays: info.session_holidays,
      };
    },
    staleTime: 6 * 60 * 60_000,
    retry: 1,
  });
  return data ?? null;
}
