import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { safeStorage } from "../lib/safe-storage.ts";
import type { Candle } from "../services/schemas.ts";
import { ReplayEngine, type ReplayState } from "./engine.ts";
import {
  type ClosedTrade,
  type EquityPoint,
  type OrderResult,
  type PaperMetrics,
  type PaperPosition,
  positionPnl,
  type ReplayBar,
  type ReplaySide,
} from "./paper.ts";
import { ProfileStore, type ProfileSummary } from "./profiles.ts";

/**
 * Bar replay, TradingView-style, on CheapTrader's model:
 *
 * - `off`: no replay;
 * - `picking`: choosing the bar to start on (the chart shows the live candles
 *   and a click on any bar starts there);
 * - `running`: the replay owns the chart, which shows the bars up to the cursor.
 *
 * Everything runs in the browser: the engine works on a snapshot of the
 * candles the chart had loaded, and the paper account is a profile kept in
 * localStorage, so a replay needs no backend and survives a reload's worth of
 * history (the account does; the cursor does not).
 */

export type ReplayMode = "off" | "picking" | "running";

/** Playback speeds in bar updates per second: TradingView's list. */
export const REPLAY_SPEEDS = [10, 7, 5, 3, 1, 0.5, 0.3, 0.2, 0.1] as const;
const DEFAULT_SPEED = 1;
const SPEED_KEY = "replay_speed";

/** At most this many cursor moves per second; faster speeds move several bars per move. */
const MAX_TICKS_PER_SECOND = 10;
/** Marks change on every bar; they are written to storage at most this often. */
const SAVE_EVERY_MS = 2_000;

export interface ReplayPosition extends PaperPosition {
  pnl: number;
}

export interface ReplaySnapshot {
  state: ReplayState;
  /** The candles the chart shows: everything up to the cursor. */
  candles: Candle[];
  price: number;
  positions: ReplayPosition[];
  /** This profile's history, newest last. */
  trades: ClosedTrade[];
  metrics: PaperMetrics;
  equity: EquityPoint[];
}

interface Options {
  symbol: string;
  timeframe: string;
  /** The chart's candles for `symbol` / `timeframe`, or null while they are not (yet) the right ones. */
  candles: Candle[] | null;
  contractSize: number;
  /** Stops and targets that closed positions while the cursor moved. */
  onClosed?: (trades: ClosedTrade[]) => void;
}

function readSpeed(): number {
  const v = Number(safeStorage.getItem(SPEED_KEY));
  return (REPLAY_SPEEDS as readonly number[]).includes(v) ? v : DEFAULT_SPEED;
}

/** Candle times may arrive in seconds or milliseconds; the replay works in seconds. */
function toBars(candles: Candle[]): ReplayBar[] {
  const out: ReplayBar[] = [];
  let last = -Infinity;
  for (const c of candles) {
    const time = c.time > 1e12 ? Math.floor(c.time / 1000) : c.time;
    if (!(time > last) || !Number.isFinite(c.close)) continue;
    out.push({ time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 });
    last = time;
  }
  return out;
}

export function useReplay({ symbol, timeframe, candles, contractSize, onClosed }: Options) {
  const [mode, setMode] = useState<ReplayMode>("off");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(readSpeed);
  // Bumped on every change to the engine or the account: the engine is
  // mutable, so the snapshot is re-derived whenever `version` moves.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // The engine is held twice: as state for rendering, and in a ref so the
  // callbacks below always act on the current one without being recreated.
  const [engine, setEngineState] = useState<ReplayEngine | null>(null);
  const engineRef = useRef<ReplayEngine | null>(null);
  const setEngine = useCallback((next: ReplayEngine | null) => {
    engineRef.current = next;
    setEngineState(next);
  }, []);
  const [store] = useState(() => new ProfileStore());
  const savedAt = useRef(0);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  const save = useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force && now - savedAt.current < SAVE_EVERY_MS) return;
      savedAt.current = now;
      store.save();
    },
    [store],
  );

  // ── entering and leaving ─────────────────────────────────

  const open = useCallback(() => {
    setMode((m) => (m === "off" ? "picking" : m));
  }, []);

  /** Settle the running session (if any) and forget the engine. */
  const finish = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.end();
      save(true);
    }
    setEngine(null);
    setPlaying(false);
  }, [save, setEngine]);

  const exit = useCallback(() => {
    finish();
    setMode("off");
    bump();
  }, [finish, bump]);

  /** Back to choosing a bar; the profile keeps its balance and history. */
  const pickAgain = useCallback(() => {
    finish();
    setMode("picking");
    bump();
  }, [finish, bump]);

  /** Start the replay on the bar nearest `time` (unix seconds). */
  const startAt = useCallback(
    (time: number): boolean => {
      if (!candles || candles.length < 2) return false;
      const bars = toBars(candles);
      if (bars.length < 2) return false;
      finish();
      const next = new ReplayEngine(symbol, timeframe, bars, store.active(), contractSize);
      next.begin(next.nearestIndex(time));
      setEngine(next);
      save(true);
      setMode("running");
      bump();
      return true;
    },
    [candles, symbol, timeframe, contractSize, finish, store, save, setEngine, bump],
  );

  // ── moving the cursor ────────────────────────────────────

  const move = useCallback(
    (delta: number) => {
      const engine = engineRef.current;
      if (!engine) return null;
      const moved = engine.step(delta);
      const byLevel = moved.closed.filter((t) => t.reason === "sl" || t.reason === "tp");
      if (byLevel.length) onClosedRef.current?.(byLevel);
      save(moved.closed.length > 0);
      bump();
      return moved;
    },
    [save, bump],
  );

  const step = useCallback((n = 1) => void move(n), [move]);

  const jumpToEnd = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setPlaying(false);
    move(engine.total - 1 - engine.index);
  }, [move]);

  const play = useCallback(() => {
    if (engineRef.current && !engineRef.current.atEnd) setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    if (playing) setPlaying(false);
    else play();
  }, [playing, play]);

  const setSpeed = useCallback((value: number) => {
    setSpeedState(value);
    safeStorage.setItem(SPEED_KEY, String(value));
  }, []);

  // The pace: one move per tick, several bars per move at the top speeds.
  useEffect(() => {
    if (!playing || mode !== "running") return;
    const perTick = Math.max(1, Math.ceil(speed / MAX_TICKS_PER_SECOND));
    const gap = (1000 * perTick) / speed;
    const id = window.setInterval(() => {
      const moved = move(perTick);
      if (!moved || moved.state.index >= moved.state.total - 1) setPlaying(false);
    }, gap);
    return () => window.clearInterval(id);
  }, [playing, speed, mode, move]);

  // ── following the chart ──────────────────────────────────

  // Another symbol ends the replay (a position on one instrument has no
  // meaning on another). Another timeframe, or more history arriving, rebases
  // the replay onto the new bars at the same moment, as TradingView does.
  useEffect(() => {
    const current = engineRef.current;
    if (mode === "off") return;
    if (current && current.symbol !== symbol) {
      exit();
      return;
    }
    if (!current || !candles || candles.length === 0) return;
    if (current.timeframe === timeframe && candles.length <= current.total) return;
    setEngine(current.rebase(toBars(candles), timeframe));
    bump();
  }, [mode, symbol, timeframe, candles, exit, setEngine, bump]);

  // ── the paper account ────────────────────────────────────

  const order = useCallback(
    (side: ReplaySide, volume: number, sl?: number | null, tp?: number | null): OrderResult => {
      const engine = engineRef.current;
      if (!engine) return { ok: false, error: "No replay is running" };
      const r = engine.place({ side, volume, sl, tp });
      save(true);
      bump();
      return r;
    },
    [save, bump],
  );

  const closePosition = useCallback(
    (ticket: number): OrderResult => {
      const engine = engineRef.current;
      if (!engine) return { ok: false, error: "No replay is running" };
      const r = engine.close(ticket);
      save(true);
      bump();
      return r;
    },
    [save, bump],
  );

  const closeAll = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const ticket of [...engine.account.positions.keys()]) engine.close(ticket);
    save(true);
    bump();
  }, [save, bump]);

  const modifyPosition = useCallback(
    (ticket: number, sl: number | null | undefined, tp: number | null | undefined): OrderResult => {
      const engine = engineRef.current;
      if (!engine) return { ok: false, error: "No replay is running" };
      const r = engine.account.modify(ticket, sl, tp);
      save(true);
      bump();
      return r;
    },
    [save, bump],
  );

  // ── profiles ─────────────────────────────────────────────

  /** Run a change to the profiles, moving a running replay onto whichever account is active after it. */
  const withProfiles = useCallback(
    (change: (profiles: ProfileStore) => void) => {
      change(store);
      engineRef.current?.useAccount(store.active());
      store.save();
      bump();
    },
    [store, bump],
  );

  const selectProfile = useCallback(
    (id: string) => withProfiles((s) => s.select(id)),
    [withProfiles],
  );
  const createProfile = useCallback(
    (name: string, balance: number) => withProfiles((s) => void s.create(name, balance)),
    [withProfiles],
  );
  const resetProfile = useCallback(
    (id: string, balance?: number) =>
      withProfiles((s) => {
        // Positions belong to the account being reset; settle them first so the
        // engine does not keep marking tickets that no longer exist.
        if (engineRef.current && id === s.activeId) engineRef.current.end();
        s.reset(id, balance);
        if (engineRef.current?.bar && id === s.activeId) {
          s.active().beginSession(engineRef.current.bar, engineRef.current.contractSize);
        }
      }),
    [withProfiles],
  );
  const deleteProfile = useCallback(
    (id: string) => withProfiles((s) => s.remove(id)),
    [withProfiles],
  );

  // ── what the UI reads ────────────────────────────────────

  const snapshot = useMemo<ReplaySnapshot | null>(() => {
    void version; // the engine is mutable; `version` says when it changed
    if (mode !== "running" || !engine) return null;
    const visible = engine.visibleBars();
    const price = engine.bar?.close ?? 0;
    const account = engine.account;
    return {
      state: engine.state(),
      candles: visible.map((b) => ({ ...b })),
      price,
      positions: [...account.positions.values()].map((p) => ({ ...p, pnl: positionPnl(p, price) })),
      trades: [...account.closed],
      metrics: account.metrics(price),
      equity: [...account.equityCurve],
    };
  }, [mode, version, engine]);

  const profileList = useMemo<{ list: ProfileSummary[]; activeId: string; activeName: string }>(() => {
    void version;
    return { list: store.list(), activeId: store.activeId, activeName: store.activeName() };
  }, [version, store]);

  return {
    mode,
    playing,
    speed,
    snapshot,
    profiles: profileList,
    canStart: (candles?.length ?? 0) > 1,
    open,
    exit,
    pickAgain,
    startAt,
    step,
    jumpToEnd,
    play,
    pause,
    toggle,
    setSpeed,
    order,
    closePosition,
    closeAll,
    modifyPosition,
    selectProfile,
    createProfile,
    resetProfile,
    deleteProfile,
  };
}

export type ReplayController = ReturnType<typeof useReplay>;
