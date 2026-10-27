import {
  CalendarArrowUp,
  CalendarClock,
  ChevronDown,
  Dices,
  Flag,
  Pause,
  Play,
  StepForward,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { REPLAY_SPEEDS, type ReplayController } from "../../replay/useReplay.ts";
import type { Timeframe } from "../trading/constants.ts";
import { utcOffsetLabel } from "../../lib/chart-time.ts";
import { DATE_RANGES, type DateRange, intervalShort } from "./shared.ts";
import { notAvailable } from "./notAvailable.ts";
import { MenuItem, MenuTitle, Popover } from "./ui.tsx";


/** The chart's clock in the viewer's timezone, as TradingView shows it: "06:32:10 (UTC+8)". */
function useLocalClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":");
  const zone = utcOffsetLabel(now.getTime() / 1000);
  return zone === "UTC" ? `${time} UTC` : `${time} (${zone})`;
}

function speedLabel(s: number): string {
  return s >= 1 ? `${s} upd per 1 sec` : `1 upd per ${Math.round(1 / s)} sec`;
}

export function ChartControlsBar({
  onRange,
  onGoTo,
}: {
  onRange: (r: DateRange) => void;
  onGoTo: (timeSec: number) => void;
}) {
  const clock = useLocalClock();
  const [goToOpen, setGoToOpen] = useState(false);
  const [goTo, setGoTo] = useState("");

  return (
    <div className="relative flex h-[39px] shrink-0 items-center border-t-[1px] border-background bg-card px-2 text-[14px]">
      <div className="flex items-center">
        {DATE_RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            title={r.title}
            onClick={() => onRange(r)}
            className="group flex h-[38px] items-center px-[6px] text-[14px]"
          >
            {/* TradingView: 0 6px padding, 14px text. */}
            <span className="rounded group-hover:bg-secondary">{r.label}</span>
          </button>
        ))}
        {/* TradingView's 9px separator cell. */}
        <span className="flex h-[38px] w-[9px] items-center justify-center">
          <span className="h-[22px] w-px bg-border" />
        </span>
        <Popover
          open={goToOpen}
          onClose={() => setGoToOpen(false)}
          side="top"
          trigger={
            <button
              type="button"
              title="Go to"
              onClick={() => setGoToOpen((v) => !v)}
              className="flex h-[38px] w-[38px] items-center justify-center hover:bg-secondary"
            >
              <CalendarClock className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
          }
        >
          <form
            className="flex items-end gap-2 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              const ms = Date.parse(`${goTo}T00:00:00`);
              if (Number.isFinite(ms)) onGoTo(ms / 1000);
              setGoToOpen(false);
            }}
          >
            <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
              Go to date
              <input type="date" value={goTo} onChange={(e) => setGoTo(e.target.value)} className="h-8 text-[14px]" autoFocus />
            </label>
            <button type="submit" className="h-8 rounded bg-tv-active px-3 text-tv-active-foreground">
              Go to
            </button>
          </form>
        </Popover>
      </div>


      <div className="ml-auto flex items-center pr-1 text-[13px] tabular-nums">
        <span className="px-2" title={`Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}>{clock}</span>
        <button type="button" title="Regular trading hours" onClick={() => notAvailable("Trading session settings")} className="h-[30px] rounded px-2 hover:bg-secondary">
          RTH
        </button>
        <span className="mx-1 h-[22px] w-px bg-border" />
        <button type="button" title="Adjust data for dividends" onClick={() => notAvailable("Dividend adjustment")} className="h-[30px] rounded px-2 hover:bg-secondary">
          ADJ
        </button>
      </div>
    </div>
  );
}

/**
 * The replay controls row TradingView adds between the time axis and the
 * date ranges while Bar replay is on, centred:
 * Select bar ▾ │ ▷ ▷| 1x 15m │ ▷|| (jump to real-time).
 */
export function ReplayToolbarRow(props: Parameters<typeof ReplayToolbar>[0]) {
  return (
    <div className="relative flex h-[48px] shrink-0 items-center justify-center border-t border-background bg-card text-[14px]">
      <ReplayToolbar {...props} />
    </div>
  );
}

function ReplayToolbar({
  replay,
  timeframe,
  onTimeframe,
  onFirst,
  onRandom,
  onDate,
}: {
  replay: ReplayController;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  onFirst: () => void;
  onRandom: () => void;
  onDate: (timeSec: number) => void;
}) {
  const [menu, setMenu] = useState<"timing" | "speed" | "date" | null>(null);
  const [day, setDay] = useState("");
  const picking = replay.mode === "picking";
  const running = replay.mode === "running";
  const atEnd = !!replay.snapshot && replay.snapshot.state.index >= replay.snapshot.state.total - 1;
  const close = () => setMenu(null);

  return (
    <div className="flex h-[38px] items-center" role="toolbar" aria-label="Bar replay">
      <button
        type="button"
        title="Select bar"
        onClick={() => (picking ? undefined : replay.pickAgain())}
        className={cn(
          "flex h-[30px] items-center gap-1.5 rounded px-2",
          picking ? "bg-secondary" : "hover:bg-secondary",
        )}
      >
        <SelectBarIcon />
        <span>Select bar</span>
      </button>
      <Popover
        open={menu === "timing" || menu === "date"}
        onClose={close}
        side="top"
        align="center"
        trigger={
          <button
            type="button"
            title="Replay timing"
            onClick={() => setMenu(menu ? null : "timing")}
            className="flex h-[30px] w-6 items-center justify-center rounded hover:bg-secondary"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        }
      >
        {menu === "date" ? (
          <form
            className="flex items-end gap-2 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              // Midnight in the viewer's timezone, like the chart's labels.
              const ms = Date.parse(`${day}T00:00:00`);
              if (Number.isFinite(ms)) onDate(ms / 1000);
              close();
            }}
          >
            <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
              Start replay from
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-8 text-[14px]" autoFocus />
            </label>
            <button type="submit" className="h-8 rounded bg-tv-active px-3 text-tv-active-foreground">
              Start
            </button>
          </form>
        ) : (
          <>
            <MenuTitle>Replay timing</MenuTitle>
            <MenuItem icon={<SelectBarIcon />} selected={picking} onClick={() => { replay.pickAgain(); close(); }}>
              Select bar
            </MenuItem>
            <MenuItem icon={<CalendarArrowUp className="h-[18px] w-[18px]" strokeWidth={1.5} />} onClick={() => setMenu("date")}>
              Select date…
            </MenuItem>
            <MenuItem icon={<Flag className="h-[18px] w-[18px]" strokeWidth={1.5} />} onClick={() => { onFirst(); close(); }}>
              Select the first available date
            </MenuItem>
            <MenuItem icon={<Dices className="h-[18px] w-[18px]" strokeWidth={1.5} />} onClick={() => { onRandom(); close(); }}>
              Random bar
            </MenuItem>
          </>
        )}
      </Popover>

      <span className="mx-2 h-[22px] w-px bg-border" />

      <button
        type="button"
        title={replay.playing ? "Pause (Shift + ↓)" : "Play (Shift + ↓)"}
        disabled={!running || (atEnd && !replay.playing)}
        onClick={replay.toggle}
        className="flex h-[30px] w-[30px] items-center justify-center rounded hover:bg-secondary disabled:opacity-40"
      >
        {replay.playing ? <Pause className="h-[18px] w-[18px]" strokeWidth={1.5} /> : <Play className="h-[18px] w-[18px]" strokeWidth={1.5} />}
      </button>
      <button
        type="button"
        title="Forward (Shift + →)"
        disabled={!running || atEnd}
        onClick={() => replay.step(1)}
        className="flex h-[30px] w-[30px] items-center justify-center rounded hover:bg-secondary disabled:opacity-40"
      >
        <StepForward className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>

      <Popover
        open={menu === "speed"}
        onClose={close}
        side="top"
        align="center"
        trigger={
          <button
            type="button"
            title="Replay speed"
            onClick={() => setMenu(menu === "speed" ? null : "speed")}
            className={cn("flex h-[30px] items-center rounded px-1.5 tabular-nums", menu === "speed" ? "bg-secondary" : "hover:bg-secondary")}
          >
            {replay.speed}x
          </button>
        }
      >
        <MenuTitle>Replay speed</MenuTitle>
        {REPLAY_SPEEDS.map((s) => (
          <MenuItem key={s} selected={s === replay.speed} hint={speedLabel(s)} onClick={() => { replay.setSpeed(s); close(); }}>
            {s}x
          </MenuItem>
        ))}
      </Popover>

      <IntervalCycler timeframe={timeframe} onTimeframe={onTimeframe} />

      <span className="mx-2 h-[22px] w-px bg-border" />

      <button
        type="button"
        title="Jump to real-time"
        onClick={replay.exit}
        className="flex h-[30px] w-[30px] items-center justify-center rounded hover:bg-secondary"
      >
        <JumpToRealtimeIcon />
      </button>
    </div>
  );
}

const CYCLE: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

/** The interval button inside the replay toolbar: a short menu of intervals. */
function IntervalCycler({ timeframe, onTimeframe }: { timeframe: Timeframe; onTimeframe: (tf: Timeframe) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      side="top"
      align="center"
      trigger={
        <button
          type="button"
          title="Replay update interval"
          onClick={() => setOpen((v) => !v)}
          className={cn("flex h-[30px] min-w-[30px] items-center justify-center rounded px-1.5", open ? "bg-secondary" : "hover:bg-secondary")}
        >
          {intervalShort(timeframe)}
        </button>
      }
    >
      <MenuTitle>Interval</MenuTitle>
      {CYCLE.map((tf) => (
        <MenuItem key={tf} selected={tf === timeframe} onClick={() => { onTimeframe(tf); setOpen(false); }}>
          {intervalShort(tf)}
        </MenuItem>
      ))}
    </Popover>
  );
}

/** A bar with an arrow pointing back at it: "start from this bar". */
function SelectBarIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="3" y="3" width="3" height="14" rx="0.5" />
      <path d="M17 10H9M12 7l-3 3 3 3" />
    </svg>
  );
}

function JumpToRealtimeIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M4 4l7 6-7 6z" />
      <path d="M14 4v12M17 4v12" />
    </svg>
  );
}
