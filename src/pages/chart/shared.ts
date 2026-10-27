import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { safeStorage } from "../../lib/safe-storage.ts";
import { DEFAULT_WATCHLIST, type WatchlistSection } from "../../market/index.ts";
import { isTimeframe, parseTimeframe } from "../../market/timeframes.ts";
import type { Timeframe } from "../trading/constants.ts";

/** Hooks and constants shared by the chart page's components. */

export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the open popup only; it must not also reach the chart
      // (which would deselect the drawing), as on TradingView.
      e.stopPropagation();
      close.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return ref;
}

/** How TradingView labels an interval on its toolbar button: 45m, 2h, D, W, M, 3M. */
export function intervalShort(tf: Timeframe): string {
  const p = parseTimeframe(tf);
  if (!p) return tf;
  if (p.unit === "m" || p.unit === "h") return tf;
  const letter = p.unit.toUpperCase();
  return p.n === 1 ? letter : `${p.n}${letter}`;
}

/** TradingView's spelled-out interval: "1 minute", "45 minutes", "12 months". */
export function intervalLong(tf: Timeframe): string {
  const p = parseTimeframe(tf);
  if (!p) return tf;
  const word = { m: "minute", h: "hour", d: "day", w: "week", M: "month" }[p.unit];
  return `${p.n} ${word}${p.n === 1 ? "" : "s"}`;
}

/**
 * TradingView's date ranges and the interval each one switches to (measured on
 * tradingview.com: 1D→1m, 5D→5m, 1M→30m, 3M→1h, 6M→2h, YTD/1Y→D, 5Y→W,
 * All→M).
 */
export const DATE_RANGES: { label: string; title: string; timeframe: Timeframe; seconds: number | "ytd" | "all" }[] = [
  { label: "1D", title: "1 day in 1 minute intervals", timeframe: "1m", seconds: 86_400 },
  { label: "5D", title: "5 days in 5 minutes intervals", timeframe: "5m", seconds: 5 * 86_400 },
  { label: "1M", title: "1 month in 30 minutes intervals", timeframe: "30m", seconds: 30 * 86_400 },
  { label: "3M", title: "3 months in 1 hour intervals", timeframe: "1h", seconds: 91 * 86_400 },
  { label: "6M", title: "6 months in 2 hours intervals", timeframe: "2h", seconds: 182 * 86_400 },
  { label: "YTD", title: "Year to day in 1 day intervals", timeframe: "1d", seconds: "ytd" },
  { label: "1Y", title: "1 year in 1 day intervals", timeframe: "1d", seconds: 365 * 86_400 },
  { label: "5Y", title: "5 years in 1 week intervals", timeframe: "1w", seconds: 5 * 365 * 86_400 },
  { label: "All", title: "All data in 1 month intervals", timeframe: "1M", seconds: "all" },
];

export type DateRange = (typeof DATE_RANGES)[number];

const WATCHLIST_KEY = "tv_watchlist_v1";

function readWatchlist(): WatchlistSection[] {
  try {
    const raw = safeStorage.getItem(WATCHLIST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.every((s) => typeof s?.section === "string" && Array.isArray(s.symbols))) {
      return parsed as WatchlistSection[];
    }
  } catch {
    // Fall back to the default list.
  }
  return DEFAULT_WATCHLIST.map((s) => ({ ...s, symbols: [...s.symbols] }));
}

/** The user's watchlist, kept in this browser. */
export function useWatchlist() {
  const [sections, setSections] = useState<WatchlistSection[]>(readWatchlist);
  const save = (next: WatchlistSection[]) => {
    setSections(next);
    safeStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  };
  const symbols = useMemo(() => sections.flatMap((s) => s.symbols), [sections]);
  return {
    sections,
    symbols,
    add: (symbol: string) => {
      if (symbols.includes(symbol)) return;
      const next = sections.map((s) => ({ ...s, symbols: [...s.symbols] }));
      if (next.length === 0) next.push({ section: "SYMBOLS", symbols: [] });
      next[next.length - 1]!.symbols.push(symbol);
      save(next);
    },
    remove: (symbol: string) =>
      save(sections.map((s) => ({ ...s, symbols: s.symbols.filter((x) => x !== symbol) })).filter((s) => s.symbols.length > 0)),
  };
}

/** Decimals that suit a price, when the instrument's tick size is unknown. */
export function priceDigits(v: number, tickDigits?: number): number {
  if (tickDigits != null) return tickDigits;
  const a = Math.abs(v);
  if (a >= 1000) return 2;
  if (a >= 10) return 2;
  if (a >= 1) return 3;
  if (a >= 0.01) return 4;
  return 6;
}

const CUSTOM_INTERVALS_KEY = "tv_custom_intervals";

function readCustomIntervals(): Timeframe[] {
  try {
    const parsed: unknown = JSON.parse(safeStorage.getItem(CUSTOM_INTERVALS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isTimeframe) : [];
  } catch {
    return [];
  }
}

/** Intervals added with "Add custom interval…", kept across sessions. */
export function useCustomIntervals(): [Timeframe[], (next: Timeframe[]) => void] {
  const [list, setList] = useState(readCustomIntervals);
  const update = (next: Timeframe[]) => {
    setList(next);
    safeStorage.setItem(CUSTOM_INTERVALS_KEY, JSON.stringify(next));
  };
  return [list, update];
}
