import type { Candle } from "../services/schemas.ts";

/**
 * Bar intervals, TradingView's way: any count of minutes, hours, days, weeks
 * or months (`"45m"`, `"3h"`, `"1d"`, `"1w"`, `"3M"`). A provider serves the
 * ones it has natively; the rest are built here by merging its nearest finer
 * bars, the way TradingView builds custom intervals.
 */

export type TimeframeUnit = "m" | "h" | "d" | "w" | "M";
export type Timeframe = `${number}${TimeframeUnit}`;

/** TradingView's standard intervals, as its interval menu lists them. */
export const STANDARD_TIMEFRAMES = [
  "1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m",
  "1h", "2h", "3h", "4h",
  "1d", "1w", "1M", "3M", "6M", "12M",
] as const satisfies readonly Timeframe[];

const UNIT_SECONDS: Record<TimeframeUnit, number> = {
  m: 60,
  h: 3600,
  d: 86_400,
  w: 604_800,
  // Nominal; month bars are bucketed by calendar month.
  M: 30 * 86_400,
};

export function parseTimeframe(tf: string): { n: number; unit: TimeframeUnit } | null {
  const m = /^(\d+)(m|h|d|w|M)$/.exec(tf);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? { n, unit: m[2] as TimeframeUnit } : null;
}

export function isTimeframe(tf: unknown): tf is Timeframe {
  return typeof tf === "string" && parseTimeframe(tf) !== null;
}

/** Seconds in one bar (months count as 30 days). 0 for anything else. */
export function timeframeSeconds(tf: string): number {
  const p = parseTimeframe(tf);
  return p ? p.n * UNIT_SECONDS[p.unit] : 0;
}

export function isIntraday(tf: string): boolean {
  const s = timeframeSeconds(tf);
  return s > 0 && s < 86_400;
}

/**
 * The native interval to fetch for `tf`: `tf` itself when the provider has
 * it (or takes anything), else the coarsest native interval that divides it.
 * Months build from months, else days; nothing builds below a day from days.
 */
export function baseTimeframe(tf: string, native: readonly string[] | undefined): string | null {
  const p = parseTimeframe(tf);
  if (!p) return null;
  if (!native || native.includes(tf)) return tf;
  const candidates = native
    .map((b) => ({ b, p: parseTimeframe(b) }))
    .filter((c): c is { b: string; p: { n: number; unit: TimeframeUnit } } => c.p !== null)
    .filter(({ p: q }) => {
      if (p.unit === "M") return q.unit === "M" ? p.n % q.n === 0 : q.unit === "d" && q.n === 1;
      if (q.unit === "M") return false;
      const s = timeframeSeconds(tf);
      const qs = q.n * UNIT_SECONDS[q.unit];
      return qs <= s && s % qs === 0;
    })
    .sort((a, b) => timeframeSeconds(b.b) - timeframeSeconds(a.b));
  return candidates[0]?.b ?? null;
}

/**
 * Merge finer bars into `tf` bars. Intraday buckets restart at each day's
 * session open (the usual first bar of the day), as TradingView's do, so a
 * 45-minute NASDAQ chart runs 09:30, 10:15, …; days and weeks count from the
 * epoch (weeks from Monday); months group by calendar month.
 */
export function aggregateTimeframe(rows: Candle[], tf: string): Candle[] {
  const p = parseTimeframe(tf);
  if (!p || rows.length === 0) return rows;
  const bucketOf = bucketer(rows, p);
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of rows) {
    const t = bucketOf(c.time);
    if (!cur || cur.time !== t) {
      if (cur) out.push(cur);
      cur = { time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
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

function bucketer(rows: Candle[], p: { n: number; unit: TimeframeUnit }): (t: number) => number {
  if (p.unit === "M") {
    return (t) => {
      const d = new Date(t * 1000);
      const idx = Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / p.n) * p.n;
      return Date.UTC(Math.floor(idx / 12), idx % 12, 1) / 1000;
    };
  }
  const size = p.n * UNIT_SECONDS[p.unit];
  if (p.unit === "w") {
    const monday = 4 * 86_400; // 1970-01-05 was a Monday
    return (t) => monday + Math.floor((t - monday) / size) * size;
  }
  if (p.unit === "d") return (t) => Math.floor(t / size) * size;
  const open = sessionOpenOffset(rows);
  return (t) => {
    const day = Math.floor((t - open) / 86_400) * 86_400 + open;
    return day + Math.floor((t - day) / size) * size;
  };
}

/** Seconds after UTC midnight the session usually opens: the most common first-bar time of a day. */
export function sessionOpenOffset(rows: readonly { time: number }[]): number {
  const firsts = new Map<number, number>();
  for (const r of rows) {
    const day = Math.floor(r.time / 86_400);
    if (!firsts.has(day)) firsts.set(day, r.time - day * 86_400);
  }
  const counts = new Map<number, number>();
  for (const off of firsts.values()) counts.set(off, (counts.get(off) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [off, n] of counts) if (n > bestCount || (n === bestCount && off < best)) [best, bestCount] = [off, n];
  return best;
}

/**
 * The bar a live tick at `sec` falls in. `openOffset` is the history's
 * sessionOpenOffset, so live buckets line up with the session-anchored ones.
 */
export function liveBucket(sec: number, tf: string, openOffset = 0): number {
  const p = parseTimeframe(tf);
  if (!p) return sec;
  return bucketer([{ time: openOffset, open: 0, high: 0, low: 0, close: 0, volume: 0 }], p)(sec);
}

/**
 * Times of the next `count` bars after `times` (ascending), following the
 * instrument's own calendar: intraday bars repeat the recent days' bar
 * times-of-day on the weekdays that trade; days skip non-trading weekdays;
 * weeks and months step by the calendar. TradingView's time scale runs on
 * into the future this way.
 */
export function futureBarTimes(times: readonly number[], tf: string, count: number): number[] {
  const p = parseTimeframe(tf);
  const last = times[times.length - 1];
  if (!p || last == null || count <= 0) return [];
  const out: number[] = [];
  const recent = times.slice(-5000);
  const weekdays = new Set(recent.map((t) => new Date(t * 1000).getUTCDay()));
  if (weekdays.size === 0) for (let d = 0; d < 7; d++) weekdays.add(d);
  const trades = (dayStart: number) => weekdays.has(new Date(dayStart * 1000).getUTCDay());

  if (p.unit === "M") {
    const d = new Date(last * 1000);
    for (let i = 1; out.length < count; i++) out.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i * p.n, 1) / 1000);
    return out;
  }
  if (p.unit === "w" || p.unit === "d") {
    const step = timeframeSeconds(tf);
    for (let t = last + step; out.length < count; t += step) {
      if (p.unit === "w" || trades(Math.floor(t / 86_400) * 86_400)) out.push(t);
    }
    return out;
  }
  // Intraday: the bar times of the last ten trading days give the session.
  const days = [...new Set(recent.map((t) => Math.floor(t / 86_400)))].slice(-10);
  const lastDays = new Set(days);
  const offsets = [...new Set(recent.filter((t) => lastDays.has(Math.floor(t / 86_400))).map((t) => t % 86_400))].sort(
    (a, b) => a - b,
  );
  if (offsets.length === 0) return out;
  for (let day = Math.floor(last / 86_400); out.length < count; day++) {
    const start = day * 86_400;
    if (!trades(start)) continue;
    for (const off of offsets) {
      const t = start + off;
      if (t > last && out.length < count) out.push(t);
    }
  }
  return out;
}
