/**
 * Market status from a TradingView symbol's sessions, as TradingView works it
 * out (MarketStatusModel / SessionsSpec): the regular session plus the
 * pre-market, post-market and night sub-sessions, in the exchange's time
 * zone, less the session holidays. Gives the status now, the next session
 * edge for the countdown, and the day's session map for the status card.
 *
 * Session spec: comma-separated "HHMM-HHMM" ranges, then ":days" (1 = Sunday
 * … 7 = Saturday; default Monday–Friday, "23456"); "|" joins alternatives
 * with their own days. A range whose start is not before its end, or whose
 * start carries "F", begins the calendar day before its trading day.
 * "24x7" trades around the clock.
 */

export type MarketStatus = "open" | "pre" | "post" | "overnight" | "close" | "holiday";

export interface SymbolSessions {
  timezone: string;
  session: string;
  preMarket?: string;
  postMarket?: string;
  night?: string;
  /** Comma-separated YYYYMMDD trading days without a session. */
  holidays?: string;
}

interface Range {
  start: number; // minutes from midnight
  end: number;
  prevDay: boolean;
}

interface Part {
  ranges: Range[];
  days: Set<number>; // 0 = Sunday … 6 = Saturday
}

type Spec = { allWeek: true } | { allWeek: false; parts: Part[] };

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));

export function parseSessionSpec(spec: string): Spec {
  const s = spec.trim();
  if (s === "" || s === "24x7") return { allWeek: true };
  const parts: Part[] = [];
  for (const alt of s.split("|")) {
    const [rangesText = "", daysText = "23456"] = alt.split(":");
    const days = new Set([...daysText].map((d) => Number(d) - 1).filter((d) => d >= 0 && d <= 6));
    const ranges: Range[] = [];
    for (const r of rangesText.split(",")) {
      const m = /^(\d{4})(F?)-(\d{4})/.exec(r.trim());
      if (!m) continue;
      const start = minutes(m[1]!);
      const end = minutes(m[3]!);
      ranges.push({ start, end: end === 0 && start > 0 ? 1440 : end, prevDay: m[2] === "F" || start >= end });
    }
    if (ranges.length) parts.push({ ranges, days });
  }
  return { allWeek: false, parts };
}

/** The wall-clock date and minute of an instant in a time zone. */
export function zonedParts(ms: number, timeZone: string): { y: number; m: number; d: number; dow: number; minute: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), dow, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/** The UTC instant of a wall-clock time (day index from epoch, minute) in a time zone. */
function zonedToUtc(dayIndex: number, minute: number, timeZone: string): number {
  const guess = dayIndex * 86_400_000 + minute * 60_000;
  // Two passes settle the offset, also across a DST change.
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const z = zonedParts(t, timeZone);
    const wall = Date.UTC(z.y, z.m - 1, z.d) + z.minute * 60_000;
    t += guess - wall;
  }
  return t;
}

const dayIndexOf = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const ymd = (dayIndex: number) => {
  const dt = new Date(dayIndex * 86_400_000);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
};

interface Interval {
  from: number; // UTC ms
  to: number;
  status: Exclude<MarketStatus, "close" | "holiday">;
}

/** The sessions of the trading days around `ms`, as UTC intervals. */
function intervalsAround(sessions: SymbolSessions, ms: number, daysBack = 2, daysAhead = 8): Interval[] {
  const tz = sessions.timezone;
  const today = zonedParts(ms, tz);
  const base = dayIndexOf(today.y, today.m, today.d);
  const holidays = new Set((sessions.holidays ?? "").split(",").filter(Boolean));
  const out: Interval[] = [];
  const add = (spec: string | undefined, status: Interval["status"]) => {
    if (!spec) return;
    const parsed = parseSessionSpec(spec);
    for (let k = -daysBack; k <= daysAhead; k++) {
      const day = base + k;
      if (parsed.allWeek) {
        out.push({ from: zonedToUtc(day, 0, tz), to: zonedToUtc(day + 1, 0, tz), status });
        continue;
      }
      if (holidays.has(ymd(day))) continue;
      const dow = new Date(day * 86_400_000).getUTCDay();
      for (const part of parsed.parts) {
        if (!part.days.has(dow)) continue;
        for (const r of part.ranges) {
          out.push({ from: zonedToUtc(r.prevDay ? day - 1 : day, r.start, tz), to: zonedToUtc(day, r.end, tz), status });
        }
      }
    }
  };
  add(sessions.session, "open");
  add(sessions.preMarket, "pre");
  add(sessions.postMarket, "post");
  add(sessions.night, "overnight");
  return out.sort((a, b) => a.from - b.from);
}

/** The regular session wins over the sub-sessions, as TradingView's current_session does. */
const PRIORITY: Record<Interval["status"], number> = { open: 0, pre: 1, post: 2, overnight: 3 };

export function marketStatusAt(sessions: SymbolSessions, ms: number): MarketStatus {
  const hits = intervalsAround(sessions, ms).filter((i) => i.from <= ms && ms < i.to);
  if (hits.length) return hits.sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status])[0]!.status;
  const today = zonedParts(ms, sessions.timezone);
  const holidays = new Set((sessions.holidays ?? "").split(",").filter(Boolean));
  const key = `${today.y}${String(today.m).padStart(2, "0")}${String(today.d).padStart(2, "0")}`;
  return holidays.has(key) ? "holiday" : "close";
}

export interface SessionEdge {
  /** Seconds until the edge. */
  remainingSeconds: number;
  /** Set when the edge starts or ends pre- or post-market (TradingView tags it so). */
  status?: "pre" | "post";
}

/**
 * _getNextSessionEdgeInternal: the nearest start or end of the regular,
 * pre-market or post-market session after now (the night session's edges
 * do not count); post-market wins a tie, then pre-market.
 */
export function nextSessionEdge(sessions: SymbolSessions, ms: number): SessionEdge | null {
  if (parseSessionSpec(sessions.session).allWeek) {
    // Around the clock: TradingView counts to the end of the UTC day's bar.
    const z = zonedParts(ms, sessions.timezone);
    const end = zonedToUtc(dayIndexOf(z.y, z.m, z.d) + 1, 0, sessions.timezone);
    return { remainingSeconds: Math.max(0, (end - ms) / 1000) };
  }
  const list = intervalsAround(sessions, ms).filter((i) => i.status !== "overnight");
  const next = (status: Interval["status"]) => {
    let best = Infinity;
    for (const i of list) {
      if (i.status !== status) continue;
      if (i.from > ms) best = Math.min(best, i.from);
      if (i.to > ms) best = Math.min(best, i.to);
    }
    return best;
  };
  const general = next("open");
  const pre = next("pre");
  const post = next("post");
  const t = Math.min(general, pre, post);
  if (t === Infinity) return null;
  return { remainingSeconds: Math.max(0, (t - ms) / 1000), status: t === post ? "post" : t === pre ? "pre" : undefined };
}

/** pt: "2 days and 3 hours", "4 hours and 25 minutes", "12 minutes", "less than 1 minute". */
export function remainingTimeText(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds - 86400 * days) / 3600);
  const mins = Math.floor((seconds - 86400 * days - 3600 * hours) / 60);
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"}`;
  if (days === 0 && hours === 0 && mins === 0) return "less than 1 minute";
  if (days > 0) return `${n(days, "day")} and ${n(hours, "hour")}`;
  if (hours > 0) return `${n(hours, "hour")} and ${n(mins, "minute")}`;
  return n(mins, "minute");
}

/** countdownFnMap: the card's countdown sentence for a status and its next edge. */
export function countdownText(status: MarketStatus, edge: SessionEdge): string {
  const t = remainingTimeText(edge.remainingSeconds);
  switch (status) {
    case "open":
      return edge.status === "post" ? `It'll go to post-market trading in ${t}.` : `It'll close in ${t}.`;
    case "pre":
      return `It’ll open fully in ${t}.`;
    case "post":
      return `It'll close in ${t}.`;
    case "overnight":
      return `Pre-market will start in ${t}.`;
    case "close":
    case "holiday":
      return edge.status === "pre" ? `It'll open for pre-market trading in ${t}.` : `It'll open in ${t}.`;
  }
}

export interface SessionSegment {
  /** Minutes from the start of the exchange day, 0–1440. */
  from: number;
  to: number;
  status: Interval["status"];
}

/** The exchange day's sessions (for the card's bar), clipped to its 24 hours. */
export function daySegments(sessions: SymbolSessions, ms: number): { weekday: string; segments: SessionSegment[]; nowMinute: number } {
  const tz = sessions.timezone;
  const z = zonedParts(ms, tz);
  const day = dayIndexOf(z.y, z.m, z.d);
  const start = zonedToUtc(day, 0, tz);
  const end = zonedToUtc(day + 1, 0, tz);
  const span = end - start;
  const segments: SessionSegment[] = [];
  for (const i of intervalsAround(sessions, ms, 2, 1)) {
    const from = Math.max(i.from, start);
    const to = Math.min(i.to, end);
    if (to <= from) continue;
    segments.push({ from: Math.round(((from - start) / span) * 1440), to: Math.round(((to - start) / span) * 1440), status: i.status });
  }
  // The regular session hides the sub-sessions it overlaps (e.g. "extended").
  segments.sort((a, b) => a.from - b.from || PRIORITY[a.status] - PRIORITY[b.status]);
  const merged: SessionSegment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && s.from < last.to) {
      if (s.to > last.to) merged.push({ ...s, from: last.to });
      continue;
    }
    merged.push({ ...s });
  }
  return { weekday: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][z.dow]!, segments: merged, nowMinute: z.minute };
}

/** "New York (UTC-4)", "UTC": the time zone's city and its offset now. */
export function timezoneLabel(timeZone: string, ms: number): string {
  if (timeZone === "Etc/UTC" || timeZone === "UTC") return "UTC";
  const city = (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(ms))
    .find((p) => p.type === "timeZoneName")?.value;
  const offset = !name || name === "GMT" ? "UTC" : name.replace("GMT", "UTC");
  return `${city} (${offset})`;
}
