import { useEffect, useRef, useState } from "react";
import {
  countdownText,
  daySegments,
  marketStatusAt,
  nextSessionEdge,
  timezoneLabel,
  type MarketStatus,
  type SymbolSessions,
} from "../../market/index.ts";
import { cn } from "../../lib/utils.ts";

/**
 * TradingView's market status pill in the legend (statuses-pill) and the
 * card it opens: the status of the symbol's market now — open, pre-market,
 * post-market, overnight, closed or holiday — in TradingView's colours, its
 * description, the countdown to the next session edge, and the exchange
 * day's sessions. Recomputed every minute (and on the edge itself).
 */

const TITLE: Record<MarketStatus, string> = {
  open: "Market open",
  pre: "Pre-market",
  post: "Post-market",
  overnight: "Overnight via BOATS",
  close: "Market closed",
  holiday: "Holiday",
};

const DESCRIPTION: Record<MarketStatus, string> = {
  open: "All's well — market is open.",
  pre: "Morning. Market is open for pre-market trading.",
  post: "Evening. Market is open for post-market trading.",
  overnight:
    "Hey there, night owl. Market is currently open for overnight trading. The data during this session is provided by the BOATS exchange.",
  close: "Time for a walk — this market is closed.",
  holiday: "Market is currently on holiday. Lucky them.",
};

// classNameMap / titleColorMap: the content colour, and the pill's overlay
// (light / normal on hover / bold when pressed), for light and dark themes.
const TONE: Record<MarketStatus, string> = {
  open: "text-[#056656] dark:text-[#42bda8] [--pill:#08998126] [--pill-hover:#0899814d] [--pill-active:#08998166] dark:[--pill:#22ab9433] dark:[--pill-hover:#22ab944d] dark:[--pill-active:#22ab9466]",
  pre: "text-[#ef6c00] dark:text-[#ff9100] [--pill:#ff980026] [--pill-hover:#ff98004d] [--pill-active:#ff980066] dark:[--pill:#ff980033]",
  post: "text-[#143eb2] dark:text-[#82b1ff] [--pill:#2962ff26] [--pill-hover:#2962ff4d] [--pill-active:#2962ff66] dark:[--pill:#448aff33] dark:[--pill-hover:#448aff4d] dark:[--pill-active:#448aff66]",
  overnight: "text-[#8e24aa] dark:text-[#ba68c8] [--pill:#9c27b026] [--pill-hover:#9c27b04d] [--pill-active:#9c27b066] dark:[--pill:#ea80fc33] dark:[--pill-hover:#ea80fc4d] dark:[--pill-active:#ea80fc66]",
  close: "text-[#464646] dark:text-[#b8b8b8] [--pill:#63636326] [--pill-hover:#6363634d] [--pill-active:#63636366] dark:[--pill:#b8b8b833] dark:[--pill-hover:#b8b8b84d] dark:[--pill-active:#b8b8b866]",
  holiday: "text-[#464646] dark:text-[#b8b8b8] [--pill:#63636326] [--pill-hover:#6363634d] [--pill-active:#63636366] dark:[--pill:#b8b8b833] dark:[--pill-hover:#b8b8b84d] dark:[--pill-active:#b8b8b866]",
};

/** The day bar's colour for each kind of session. */
const SEGMENT: Record<"open" | "pre" | "post" | "overnight", string> = {
  open: "bg-[#056656] dark:bg-[#42bda8]",
  pre: "bg-[#ef6c00] dark:bg-[#ff9100]",
  post: "bg-[#143eb2] dark:bg-[#82b1ff]",
  overnight: "bg-[#8e24aa] dark:bg-[#ba68c8]",
};

/** Our own 18 × 18 glyphs: a dot (open), a sun (pre), a crescent (post / overnight), a ring (closed), a star (holiday). */
export function StatusIcon({ status }: { status: MarketStatus }) {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="currentColor" aria-hidden="true">
      {status === "open" && <circle cx="9" cy="9" r="4" />}
      {status === "pre" && (
        <>
          <circle cx="9" cy="9" r="2.5" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x="8.4" y="3.2" width="1.2" height="2" rx="0.6" transform={`rotate(${a} 9 9)`} />
          ))}
        </>
      )}
      {(status === "post" || status === "overnight") && <path d="M10.6 4.6a4.6 4.6 0 1 0 3.2 7.6 3.9 3.9 0 0 1-3.2-7.6Z" />}
      {status === "close" && <circle cx="9" cy="9" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      {status === "holiday" && <path d="m9 4.2 1.4 2.9 3.2.5-2.3 2.2.5 3.2L9 11.5 6.2 13l.5-3.2-2.3-2.2 3.2-.5Z" />}
    </svg>
  );
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** The exchange day: the weekday, each session as a coloured bar, the "now" mark and the current session's edges. */
function DayBar({ sessions, now }: { sessions: SymbolSessions; now: number }) {
  const { weekday, segments, nowMinute } = daySegments(sessions, now);
  const allDay = sessions.session.trim() === "24x7";
  const current = segments.find((s) => s.from <= nowMinute && nowMinute < s.to);
  const labels: number[] = [];
  if (current) {
    if (current.from > 0 || allDay) labels.push(current.from);
    if (current.to < 1440 || allDay) labels.push(current.to);
  }
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="w-[26px] text-[10px] leading-[14px]">{weekday}</span>
        <div className="relative h-[6px] flex-1">
          {segments.map((s, i) => (
            <span
              key={i}
              className={cn("absolute top-0 h-full rounded-full", SEGMENT[s.status])}
              style={{ left: `calc(${pct(s.from)} + ${s.from > 0 ? 2 : 0}px)`, width: `calc(${pct(s.to - s.from)} - ${s.from > 0 ? 4 : 0}px)` }}
            />
          ))}
          <span className="absolute -top-[4px] h-[14px] w-px bg-foreground" style={{ left: pct(nowMinute) }} />
        </div>
      </div>
      <div className="relative ml-[34px] h-[16px] text-[10px] leading-[16px] text-muted-foreground">
        {labels.map((m) => (
          <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(m) }}>
            {m === 1440 ? "24:00" : hhmm(m)}
          </span>
        ))}
      </div>
      <div className="mt-1 text-center text-[11px] text-muted-foreground">Exchange timezone: {timezoneLabel(sessions.timezone, now)}</div>
    </div>
  );
}

export function MarketStatusPill({ sessions }: { sessions: SymbolSessions }) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const status = marketStatusAt(sessions, now);
  const edge = nextSessionEdge(sessions, now);

  // Tick each minute, and at the next session edge so the status flips on time.
  useEffect(() => {
    const untilEdge = edge ? edge.remainingSeconds * 1000 + 500 : Infinity;
    const untilMinute = 60_000 - (Date.now() % 60_000) + 50;
    const id = window.setTimeout(() => setNow(Date.now()), Math.min(untilEdge, untilMinute));
    return () => window.clearTimeout(id);
  }, [now, edge]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="pointer-events-auto relative flex shrink-0">
      <button
        type="button"
        data-role="statuses-pill"
        title={TITLE[status]}
        aria-label={TITLE[status]}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded-[9px]",
          "bg-[var(--pill)] hover:bg-[var(--pill-hover)] active:bg-[var(--pill-active)]",
          TONE[status],
        )}
      >
        <StatusIcon status={status} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-[26px] z-40 w-[344px] select-text rounded-[8px] bg-popover px-5 py-4 text-[14px] leading-[21px] text-foreground shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <span className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-[9px] bg-[var(--pill)]", TONE[status])}>
              <StatusIcon status={status} />
            </span>
            <span className={cn("text-[16px] font-semibold leading-[24px]", TONE[status])}>{TITLE[status]}</span>
          </div>
          <p className="mt-1 pl-[26px]">
            {DESCRIPTION[status]}
            {edge && <span className="font-semibold"> {countdownText(status, edge)}</span>}
          </p>
          <div className="pl-[26px]">
            <DayBar sessions={sessions} now={now} />
          </div>
        </div>
      )}
    </span>
  );
}
