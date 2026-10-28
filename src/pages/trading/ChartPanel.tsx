import { useQueryClient } from "@tanstack/react-query";
import {
  type CandlestickData,
  ColorType,
  CrosshairMode,
  createChart,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type AutoscaleInfo,
  type ISeriesApi,
  type ISeriesPrimitive,
  LineStyle,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { Scissors } from "lucide-react";
import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChartPreferences } from "../../hooks/useChartPreferences.ts";
import { BandsIndicator } from "../../lib/chart-plugins/bands-indicator/bands-indicator.ts";
import { DeltaTooltipPrimitive } from "../../lib/chart-plugins/delta-tooltip/delta-tooltip.ts";
import {
  detectCrossings,
  playAlertBeep,
} from "../../lib/chart-plugins/drawing-tools/line-alerts.ts";
import { DrawingToolsManager } from "../../lib/chart-plugins/drawing-tools/manager.ts";
import { CrosshairHighlightPrimitive } from "../../lib/chart-plugins/highlight-bar-crosshair/highlight-bar-crosshair.ts";
import { SessionBreaks } from "../../lib/chart-plugins/session-breaks/session-breaks.ts";
import { SessionHighlighting } from "../../lib/chart-plugins/session-highlighting/session-highlighting.ts";
import { TooltipPrimitive } from "../../lib/chart-plugins/tooltip/tooltip.ts";
import type { IndicatorType } from "../../lib/indicators.ts";
import { cn } from "../../lib/utils.ts";
import { api } from "../../services/api.ts";
import { queryKeys } from "../../services/queries.ts";
import type { Candle, Order, Position, Symbol } from "../../services/schemas.ts";
import { toast } from "../../services/toast.ts";
import {
  CHART_COLORS,
  type CursorMode,
  type DrawingLine,
  type DrawingTool,
  type MagnetMode,
  mergeChartColors,
  timeframeMs,
  type Timeframe,
} from "./constants.ts";
import { ChartContextMenu } from "./ChartContextMenu.tsx";
import { ChartSettingsDialog } from "./ChartSettingsDialog.tsx";
import { DrawingToolbar } from "../chart/DrawingToolbar.tsx";
import { formatAxisTime } from "../../lib/chart-plugins/drawing-tools/drawings-primitive.ts";
import { futureBarTimes, isIntraday, liveBucket, sessionOpenOffset, timeframeSeconds } from "../../market/timeframes.ts";
import { fromChartTime, setChartTimeShift, toChartTime } from "../../lib/chart-time.ts";
import { CountdownLabel, countdownText } from "../../lib/chart-plugins/countdown-label.ts";
import { InlineTextEditor } from "./InlineTextEditor.tsx";
import type { LegendLine } from "../../lib/chart-snapshot.ts";
import { initialImageSize, setOnImageLoaded } from "../../lib/chart-plugins/drawing-tools/annotationtools.ts";
import { BoldPriceTicks } from "../../lib/chart-plugins/bold-price-ticks.ts";

function axisVolume(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return String(Math.round(v));
}

/** How far the time scale runs past the newest bar. */
const FUTURE_BARS = 1000;

const CHART_FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
import { DrawingContextMenu, DrawingSettingsDialog } from "./DrawingToolsOverlay.tsx";
import { DRAWING_STYLES_EVENT, getStyleDefaults } from "./drawingStyles.ts";
import { NewsOverlay } from "./NewsOverlay.tsx";
import { useChallengeLevels } from "./useChallengeLevels.ts";
import { useIndicators } from "./useIndicators.ts";
import { useNewsOverlay } from "./useNewsOverlay.ts";
import { useSlTpDrag } from "./useSlTpDrag.ts";
import {
  getMinMove,
  toUnixMs,
  toUnixSeconds,
} from "./utils.ts";
import { uid } from "../../lib/uid.ts";

// ── Staleness recovery ─────────────────────────────────────────────────────
// Shared by the live-candle and tick-smoothing effects so either path can
// trigger a REST refetch when the chart falls more than 1.5 intervals behind
// wall-clock. Throttled to ≤1 refetch per 3 s across both callers.
function requestGapRefetch(
  refAtRef: { current: number },
  qc: ReturnType<typeof useQueryClient>,
  symbol: string,
  timeframe: string,
): void {
  const now = Date.now();
  if (now - refAtRef.current <= 3_000) return;
  refAtRef.current = now;
  qc.invalidateQueries({ queryKey: queryKeys.market.candles(symbol, timeframe) });
}

// ── Scroll-triggered history loading ─────────────────────────
// When the user scrolls to the left edge of loaded data, fetch the preceding
// window from the candle API and prepend it so the chart extends seamlessly.

const LOAD_MORE_THRESHOLD = 20; // trigger when fewer than N bars remain on the left
const LOAD_MORE_WINDOW = 500; // how many interval-widths to fetch per extension

type LoadMoreState = {
  loading: boolean;
  noMoreData: boolean;
  lastFetchedBeforeMs: number;
  // When > 0, use this as toMs for the next fetch instead of getSeriesOldestMs.
  // Set after an empty-range response so we skip over gaps (e.g. Forex weekends)
  // rather than permanently locking noMoreData on the first empty window.
  fetchFromMs: number;
  /** Consecutive empty windows; bounded so we stop probing past the dataset. */
  emptyWindows: number;
};

// A Forex weekend spans at most ~3 days, so a handful of empty windows in a row
// means the history really has ended rather than a gap. Without this bound the
// loader kept walking backwards one window per scroll forever.
const MAX_EMPTY_WINDOWS = 4;

function getSeriesOldestMs(series: ISeriesApi<"Candlestick">): number {
  const data = series.data();
  return data.length === 0 ? 0 : fromChartTime(data[0]!.time as number) * 1_000;
}

function isLoadMoreEligible(
  state: LoadMoreState,
  series: ISeriesApi<"Candlestick">,
  range: LogicalRange,
): boolean {
  if (state.loading || state.noMoreData) return false;
  const barsInfo = series.barsInLogicalRange(range);
  if ((barsInfo?.barsBefore ?? Number.POSITIVE_INFINITY) > LOAD_MORE_THRESHOLD) return false;
  // A shifted window from a previous empty-range response is always eligible —
  // we need to try the window before the gap (e.g. before a Forex weekend).
  if (state.fetchFromMs > 0) return true;
  const oldestMs = getSeriesOldestMs(series);
  if (oldestMs === 0) return false;
  return state.lastFetchedBeforeMs === 0 || oldestMs < state.lastFetchedBeforeMs;
}

function fetchOlderRange(
  symbol: string,
  timeframe: string,
  toMs: number,
  state: LoadMoreState,
  onLoaded: (bars: Candle[]) => void,
): void {
  const windowMs = LOAD_MORE_WINDOW * (timeframeMs(timeframe as Timeframe) || 60_000);
  api
    .getCandles(symbol, timeframe, undefined, { fromMs: toMs - windowMs, toMs })
    .then((bars) => {
      if (bars.length === 0) {
        // Empty window — could be a gap (e.g. Forex weekend) rather than true
        // end of history. Shift the fetch boundary back one more window so the
        // next scroll event tries the range before this gap instead of stopping,
        // but give up once several windows in a row come back empty.
        state.emptyWindows += 1;
        const nextToMs = toMs - windowMs;
        if (nextToMs > 0 && state.emptyWindows < MAX_EMPTY_WINDOWS) {
          state.fetchFromMs = nextToMs;
        } else {
          state.noMoreData = true;
        }
      } else {
        state.emptyWindows = 0;
        onLoaded(bars as Candle[]);
      }
    })
    .catch(() => {
      // Reset the fetch boundary so the user can retry by scrolling again.
      // Without this, a transient network error permanently blocks history
      // loading for the current view (lastFetchedBeforeMs stays set but no
      // bars were prepended, so the eligibility guard never clears).
      state.lastFetchedBeforeMs = 0;
    })
    .finally(() => {
      state.loading = false;
    });
}

function makeHistoryLoader(
  symbol: string,
  timeframeRef: { current: string },
  seriesRef: { current: ISeriesApi<"Candlestick"> | null },
  stateRef: { current: LoadMoreState },
  onLoaded: (bars: Candle[]) => void,
): (range: LogicalRange | null) => void {
  return (range) => {
    const series = seriesRef.current;
    if (!range || !series) return;
    const state = stateRef.current;
    if (!isLoadMoreEligible(state, series, range)) return;
    // Use the shifted boundary from a prior empty-range response when present,
    // otherwise fall back to the series' current oldest bar.
    const toMs = state.fetchFromMs > 0 ? state.fetchFromMs : getSeriesOldestMs(series);
    if (toMs === 0) return;
    state.loading = true;
    state.lastFetchedBeforeMs = toMs;
    state.fetchFromMs = 0;
    // Read the timeframe from a ref: the chart (and this subscription) persists
    // across TF changes, so the loader must always fetch the *current* TF.
    fetchOlderRange(symbol, timeframeRef.current, toMs, state, onLoaded);
  };
}

// ── Props ────────────────────────────────────────────────────

export interface ChartPanelProps {
  candles: Candle[];
  selectedSymbol: string;
  timeframe: Timeframe;
  isDark: boolean;
  activeIndicators: IndicatorType[];
  drawingTool: DrawingTool;
  /** Cross / Dot / Arrow / Demonstration. */
  cursorMode?: CursorMode;
  drawings: DrawingLine[];
  onAddDrawing: (d: DrawingLine) => void;
  onUpdateDrawing?: (d: DrawingLine) => void;
  onRemoveDrawing?: (id: string) => void;
  /** Called when a drawing completes/cancels so the parent can disarm the tool. */
  onDrawingComplete?: () => void;
  /** Alt+T/H/F/R keyboard shortcut pressed — arm the given tool. */
  onDrawingToolSelect?: (t: DrawingTool) => void;
  onUndoDrawing?: () => void;
  onRedoDrawing?: () => void;
  /** Snap drawing anchors to candle O/H/L/C — off / weak (near) / strong (always). */
  magnetMode?: MagnetMode;
  /** Keep the drawing tool armed after each placement. */
  stayInDrawingMode?: boolean;
  positions: Position[];
  orders: Order[];
  tick?: { bid: number; ask: number; timestamp: number };
  liveCandle?: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
  };
  pipDigits: number;
  symbolInfo?: Symbol;
  onModifyPosition?: (
    positionId: string,
    mods: { takeProfit?: number | null; stopLoss?: number | null },
  ) => void;
  replayTradeEvents?: Array<{
    id: string;
    type: "entry" | "exit" | "violation";
    timestamp: string;
    symbolName: string | null;
    side: string | null;
    price: number | null;
    pnl: number | null;
    ruleCode?: string;
  }>;
  activePlugins?: string[];
  /** Toggle a chart plugin (session breaks etc.) — used by the settings dialog. */
  onTogglePlugin?: (id: string) => void;
  /** Account equity — feeds the position tool's $-risk / size readout. */
  accountEquity?: number;
  /** Active account — enables the challenge-aware level overlay. */
  accountId?: string | null;
  /** Context-menu quick order at the clicked price (opens the confirm dialog). */
  onQuickOrder?: (side: "BUY" | "SELL", type: "LIMIT" | "STOP", price: number) => void;
  /** Context-menu "Remove N drawings". */
  onClearDrawings?: () => void;
  /** Context-menu "Remove N indicators". */
  onClearIndicators?: () => void;
  /**
   * Session replay is active — candles are a historical slice, so the
   * staleness watchdog must not treat the old last-bar as a data gap.
   */
  isReplaying?: boolean;
  /**
   * Bar replay is choosing its start: a blue line follows the cursor and the
   * bars right of it fade; a click hands the bar's time to `onReplayPick`.
   */
  replayPicking?: boolean;
  onReplayPick?: (timeSec: number) => void;
  /** Market order from the legend's SELL / BUY boxes. */
  onMarketOrder?: (side: "BUY" | "SELL") => void;
  /** The chart instance, for the layout's range bar, snapshot and zoom. */
  onChartApi?: (chart: IChartApi | null) => void;
  /** Filled with a function giving the legend's lines, for chart snapshots. */
  snapshotLegendRef?: { current: (() => LegendLine[]) | null };
  /** Bumped by the layout to open the chart settings dialog. */
  settingsRequest?: number;
  /** The bar under the crosshair (the last bar when it leaves), for the Data window. */
  onCrosshairBar?: (bar: CrosshairBar | null) => void;
  /** The chart menu's "Object tree" item: the layout opens its side panel. */
  onOpenObjectTree?: () => void;
  /** A trading account is connected (TradingView fills the legend's SELL / BUY). */
  tradingConnected?: boolean;
}

export interface CrosshairBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Close of the bar before it (TradingView's "Change" is against this). */
  prevClose: number | null;
}

/** Window event (detail: drawing id) that selects a drawing on the chart. */
export const SELECT_DRAWING_EVENT = "tvclone:select-drawing";

function lowerBoundTime(data: CandlestickData<Time>[], t: number): number {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Number(data[mid]!.time) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function barAt(data: CandlestickData<Time>[], volume: HistogramData<Time>[], i: number): CrosshairBar {
  const c = data[i]!;
  return {
    time: Number(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: volume[i]?.value ?? 0,
    prevClose: i > 0 ? data[i - 1]!.close : null,
  };
}

/** Window event that resets the chart view (Alt + R). */
export const RESET_VIEW_EVENT = "tvclone:reset-view";

// ── Chart plugin overlays ─────────────────────────────────────────────────────

function getForexSessionColor(utcHour: number): string {
  if (utcHour >= 22 || utcHour < 8) return "rgba(255,200,50,0.04)";
  if (utcHour >= 8 && utcHour < 16) return "rgba(50,200,255,0.04)";
  if (utcHour >= 13) return "rgba(255,80,80,0.04)";
  return "transparent";
}

const forexSessionHighlighter = (date: Time): string =>
  getForexSessionColor(new Date((date as number) * 1000).getUTCHours());

interface PluginBuildCtx {
  isDark: boolean;
  timeframe: Timeframe;
  symbolCategory?: string;
}

const EQUITY_CATEGORY = /stock|equit|share|etf|index|indices/i;

// Session breaks are intraday-only — on daily+ charts every bar is already a
// full session. Equities/indices reset at 09:30 New York (RTH open); forex,
// crypto and everything else reset at 00:00 UTC.
function buildSessionBreaks(ctx: PluginBuildCtx): ISeriesPrimitive<Time> | null {
  const intervalMs = timeframeMs(ctx.timeframe) || 60_000;
  if (intervalMs >= 86_400_000) return null;
  return new SessionBreaks({
    color: ctx.isDark ? "rgba(130, 150, 190, 0.5)" : "rgba(90, 110, 150, 0.45)",
    sessionStart: EQUITY_CATEGORY.test(ctx.symbolCategory ?? "") ? "ny-0930" : "utc-midnight",
  });
}

const PLUGIN_FACTORIES: Record<string, (ctx: PluginBuildCtx) => ISeriesPrimitive<Time> | null> = {
  crosshair: ({ isDark }) =>
    new CrosshairHighlightPrimitive({
      color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
    }),
  session: () => new SessionHighlighting(forexSessionHighlighter),
  "session-breaks": buildSessionBreaks,
  bands: () => new BandsIndicator(),
  tooltip: () => new TooltipPrimitive({}),
  "delta-tooltip": () => new DeltaTooltipPrimitive({}),
};

function buildPlugin(id: string, ctx: PluginBuildCtx): ISeriesPrimitive<Time> | null {
  return PLUGIN_FACTORIES[id]?.(ctx) ?? null;
}

// Shared OHLCV legend shape — derive the percent change once at the call site
// so the crosshair, candle, and tick paths all produce identical legend objects.
interface OhlcvLegend {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  change: number;
}

function candleToLegend(c: CandlestickData<Time>, volume: number): OhlcvLegend {
  const change = c.open ? ((c.close - c.open) / c.open) * 100 : 0;
  return { o: c.open, h: c.high, l: c.low, c: c.close, v: volume, change };
}

// ── Real-time series update helpers ──────────────────────────────────────────
// Extracted from the live-candle / tick / bid-ask effects so each effect body
// stays under the cognitive-complexity limit. Behaviour is unchanged — these are
// pure relocations that operate on a shared context handed in by the effect.

type ChartColors = (typeof CHART_COLORS)["dark"];
type Ref<T> = { current: T };
type LiveCandleData = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};
type TickData = { bid: number; ask: number; timestamp: number };

interface RtCtx {
  series: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram"> | null;
  lastCandle: Ref<CandlestickData<Time> | null>;
  sessionOffset: Ref<number>;
  liveCandleTs: Ref<number>;
  legendVol: Ref<number>;
  gapAt: Ref<number>;
  bidLine: Ref<IPriceLine | null>;
  askLine: Ref<IPriceLine | null>;
  midLine: Ref<IPriceLine | null>;
  colors: ChartColors;
  timeframe: Timeframe;
  symbol: string;
  qc: ReturnType<typeof useQueryClient>;
  setLegend: Dispatch<SetStateAction<OhlcvLegend | null>>;
}

function intervalSecOf(tf: Timeframe): number {
  return (timeframeMs(tf) || 60_000) / 1000;
}

// Paint the authoritative server volume bar for the current candle.
function paintServerVolume(live: LiveCandleData, barTime: Time, ctx: RtCtx): void {
  if (!ctx.volume || live.volume == null) return;
  ctx.legendVol.current = live.volume;
  try {
    ctx.volume.update({
      time: barTime,
      value: live.volume,
      color: live.close >= live.open ? ctx.colors.volumeUp : ctx.colors.volumeDown,
    });
  } catch {
    /* safe to ignore */
  }
}

// Primary: server-aggregated CandleUpdate (authoritative OHLCV).
function applyServerCandle(live: LiveCandleData, ctx: RtCtx): void {
  const ts = toUnixSeconds(live.timestamp);
  if (Number.isNaN(ts) || ts <= 0 || !ctx.lastCandle.current) return;
  if (ts - fromChartTime(ctx.lastCandle.current.time as number) > intervalSecOf(ctx.timeframe) * 1.5) {
    requestGapRefetch(ctx.gapAt, ctx.qc, ctx.symbol, ctx.timeframe);
  }
  const bar: CandlestickData<Time> = {
    time: toChartTime(ts) as Time,
    open: live.open,
    high: live.high,
    low: live.low,
    close: live.close,
  };
  ctx.lastCandle.current = bar;
  ctx.liveCandleTs.current = toUnixMs(live.timestamp);
  try {
    ctx.series.update(bar);
  } catch {
    /* timestamp older than series — safe to ignore */
  }
  paintServerVolume(live, bar.time, ctx);
  ctx.setLegend(candleToLegend(bar, live.volume || 0));
}

// Build the tick-smoothed bar for the current bucket (continuation or fresh).
function buildTickBar(
  prev: CandlestickData<Time>,
  isContinuation: boolean,
  bucketTime: Time,
  mid: number,
  ctx: RtCtx,
): CandlestickData<Time> | null {
  if (isContinuation) {
    return {
      time: bucketTime,
      open: prev.open,
      high: Math.max(prev.high, mid),
      low: Math.min(prev.low, mid),
      close: mid,
    };
  }
  if ((bucketTime as number) <= (prev.time as number)) return null;
  // A tick more than one bar past the last bar (a closed session, or a gap)
  // does not invent a candle: the bars in between come from a refetch.
  if ((bucketTime as number) - (prev.time as number) > intervalSecOf(ctx.timeframe) * 1.5) {
    requestGapRefetch(ctx.gapAt, ctx.qc, ctx.symbol, ctx.timeframe);
    return null;
  }
  const seedOpen = prev.close;
  return {
    time: bucketTime,
    open: seedOpen,
    high: Math.max(seedOpen, mid),
    low: Math.min(seedOpen, mid),
    close: mid,
  };
}

// A new bucket has no aggregated volume yet — seed it at 0 so a fresh candle
// never inherits the previous bar's full-height volume.
function paintTickVolume(
  bar: CandlestickData<Time>,
  isContinuation: boolean,
  bucketTime: Time,
  ctx: RtCtx,
): void {
  if (!ctx.volume) return;
  if (!isContinuation) ctx.legendVol.current = 0;
  try {
    ctx.volume.update({
      time: bucketTime,
      value: ctx.legendVol.current,
      color: bar.close >= bar.open ? ctx.colors.volumeUp : ctx.colors.volumeDown,
    });
  } catch {
    /* safe to ignore */
  }
}

// Secondary: tick smoothing between server CandleUpdate pulses.
function applyTick(tick: TickData, ctx: RtCtx): void {
  if (!tick.timestamp) return;
  const tickMs = toUnixMs(tick.timestamp);
  if (ctx.liveCandleTs.current && tickMs <= ctx.liveCandleTs.current) return;
  const prev = ctx.lastCandle.current;
  if (!prev) return;
  // A quote with no price (0 / 0, or not a number) is no trade: never paint it.
  if (!Number.isFinite(tick.bid) || !Number.isFinite(tick.ask) || (tick.bid === 0 && tick.ask === 0)) return;
  const mid = (tick.bid + tick.ask) / 2;
  const bucketTime = toChartTime(liveBucket(Math.floor(tickMs / 1000), ctx.timeframe, ctx.sessionOffset.current)) as Time;
  const isContinuation = prev.time === bucketTime;
  const bar = buildTickBar(prev, isContinuation, bucketTime, mid, ctx);
  if (!bar) return;
  ctx.lastCandle.current = bar;
  try {
    ctx.series.update(bar);
  } catch {
    /* safe to ignore */
  }
  paintTickVolume(bar, isContinuation, bucketTime, ctx);
  ctx.setLegend((prevLegend) => ({
    ...candleToLegend(bar, 0),
    v: isContinuation ? (prevLegend?.v ?? 0) : 0,
  }));
}

function removePriceLineSafe(ref: Ref<IPriceLine | null>, series: ISeriesApi<"Candlestick">): void {
  if (!ref.current) return;
  try {
    series.removePriceLine(ref.current);
  } catch {
    /* ignore */
  }
  ref.current = null;
}

// Move an existing price line in place (applyOptions) or create it — avoids the
// remove+create churn that flickers the chart at tick rate.
function upsertPriceLine(
  ref: Ref<IPriceLine | null>,
  series: ISeriesApi<"Candlestick">,
  enabled: boolean,
  opts: Parameters<ISeriesApi<"Candlestick">["createPriceLine"]>[0],
): void {
  if (!enabled) {
    removePriceLineSafe(ref, series);
    return;
  }
  if (ref.current) {
    try {
      ref.current.applyOptions(opts);
      return;
    } catch {
      ref.current = null;
    }
  }
  ref.current = series.createPriceLine(opts);
}

function applyBidAskLines(
  tick: TickData | undefined,
  prefs: { showBidLine: boolean; showAskLine: boolean },
  ctx: RtCtx,
): void {
  const series = ctx.series;
  if (!tick) {
    removePriceLineSafe(ctx.bidLine, series);
    removePriceLineSafe(ctx.askLine, series);
    removePriceLineSafe(ctx.midLine, series);
    return;
  }
  upsertPriceLine(ctx.bidLine, series, prefs.showBidLine, {
    price: tick.bid,
    color: ctx.colors.bidLine,
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: "Bid",
    axisLabelColor: ctx.colors.bidLabelBg,
    axisLabelTextColor: "#ffffff",
  });
  upsertPriceLine(ctx.askLine, series, prefs.showAskLine, {
    price: tick.ask,
    color: ctx.colors.askLine,
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: "Ask",
    axisLabelColor: ctx.colors.askLabelBg,
    axisLabelTextColor: "#ffffff",
  });
  // With both lines hidden the candle series shows its own last-price label
  // (TradingView's look), so no separate mid line is drawn.
  removePriceLineSafe(ctx.midLine, series);
}

function detachPlugins(series: ISeriesApi<"Candlestick">, list: ISeriesPrimitive<Time>[]): void {
  for (const p of list) {
    try {
      series.detachPrimitive(p);
    } catch {
      /* stale ref */
    }
  }
}

function attachPlugins(
  series: ISeriesApi<"Candlestick">,
  ids: string[],
  ctx: PluginBuildCtx,
  list: ISeriesPrimitive<Time>[],
): void {
  for (const id of ids) {
    const p = buildPlugin(id, ctx);
    if (p) {
      try {
        series.attachPrimitive(p);
        list.push(p);
      } catch {
        /* ignore */
      }
    }
  }
}

// ── Server-data (setData) helpers ────────────────────────────────────────────
// Extracted from the historical-fetch / periodic-sync effect so its body stays
// under the complexity limit. Pure relocations — behaviour is unchanged.

function liveBarFrom(live: LiveCandleData): CandlestickData<Time> | null {
  const ts = toUnixSeconds(live.timestamp);
  if (Number.isNaN(ts) || ts <= 0) return null;
  return { time: toChartTime(ts) as Time, open: live.open, high: live.high, low: live.low, close: live.close };
}

function legendFromSeries(
  chartData: CandlestickData<Time>[],
  volumeData: HistogramData<Time>[],
): OhlcvLegend | null {
  const last = chartData[chartData.length - 1];
  if (!last) return null;
  const vol = volumeData.length > 0 ? (volumeData[volumeData.length - 1]?.value ?? 0) : 0;
  return candleToLegend(last, vol);
}

// The time scale runs on into the future (see futureBarTimes), so "latest"
// is the last real bar, not the end of the scale: these helpers place the
// view relative to it instead of using scrollToRealTime / scrollPosition.

/** Right margin in bars after the newest bar. */
function rightMarginBars(tf: string): number {
  return tf === "1m" ? 10 : 6;
}

/** Put the newest bar `margin` bars from the right edge, keeping the zoom (or `bars` wide). */
function scrollToLatest(chart: IChartApi | null, barCount: number, margin: number, bars?: number): void {
  const ts = chart?.timeScale();
  if (!ts || barCount === 0) return;
  const r = ts.getVisibleLogicalRange();
  const span = bars ?? (r ? r.to - r.from : ts.width() / 6);
  const last = barCount - 1;
  ts.setVisibleLogicalRange({ from: last + margin - span, to: last + margin });
}

/** Whether the newest bar is on screen (the view follows new bars). */
function showsLatest(chart: IChartApi | null, barCount: number): boolean {
  const r = chart?.timeScale().getVisibleLogicalRange();
  return !r || r.to >= barCount - 1.5;
}

/** A new chart: TradingView's default 6px bars, or every bar when there are few. */
function initialView(chart: IChartApi | null, barCount: number, margin: number): void {
  const ts = chart?.timeScale();
  if (!ts) return;
  const fit = ts.width() / 6;
  scrollToLatest(chart, barCount, margin, barCount > fit ? fit : barCount + margin);
}

// Re-apply the latest live bar after a periodic refetch (viewport preserved).
function reapplyLive(live: LiveCandleData | undefined, ctx: RtCtx): void {
  if (!live) return;
  const bar = liveBarFrom(live);
  if (!bar) return;
  try {
    ctx.series.update(bar);
  } catch {
    /* safe to ignore */
  }
  ctx.lastCandle.current = bar;
}

// Replay the buffered live candle immediately after history is painted so the
// last bar isn't stuck at the final historical close until the next tick.
function replayBufferedLive(
  buffered: LiveCandleData | undefined,
  chartData: CandlestickData<Time>[],
  ctx: RtCtx,
): void {
  if (!buffered) return;
  const liveTs = toUnixSeconds(buffered.timestamp);
  const lastHistBarSec = fromChartTime((chartData[chartData.length - 1]?.time as number) ?? 0);
  if (Number.isNaN(liveTs) || liveTs <= 0 || liveTs < lastHistBarSec) return;
  const liveBar = liveBarFrom(buffered);
  if (!liveBar) return;
  try {
    ctx.series.update(liveBar);
    ctx.lastCandle.current = liveBar;
    ctx.liveCandleTs.current = toUnixMs(buffered.timestamp);
  } catch {
    /* safe to ignore — timestamp may be older than series */
  }
}

// If the freshest bar is >2 intervals stale, schedule one delayed refetch to
// close the gap before any live CandleUpdate paints over it. Throttled to 3 s.
function scheduleStaleRefetch(
  chartData: CandlestickData<Time>[],
  ctx: RtCtx,
): (() => void) | undefined {
  const lastBarSec = fromChartTime((chartData[chartData.length - 1]?.time as number) ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (lastBarSec <= 0 || nowSec - lastBarSec <= intervalSecOf(ctx.timeframe) * 2) return undefined;
  const now = Date.now();
  if (now - ctx.gapAt.current <= 3_000) return undefined;
  ctx.gapAt.current = now;
  const { symbol, timeframe, qc } = ctx;
  const timer = window.setTimeout(() => {
    qc.invalidateQueries({ queryKey: queryKeys.market.candles(symbol, timeframe) });
  }, 1_500);
  return () => window.clearTimeout(timer);
}

// ── Position / order overlay helpers ─────────────────────────────────────────

type SlTpField = "takeProfit" | "stopLoss";
interface SlTpEntry {
  line: IPriceLine;
  price: number;
  positionId: string;
  field: SlTpField;
  side: string;
  entryPrice: number;
  quantity: number;
}
type SlTpMap = Map<string, SlTpEntry>;
interface OverlayOpts {
  symbol: string;
  colors: ChartColors;
  contractSize: number;
}

function clearPriceLines(series: ISeriesApi<"Candlestick">, list: IPriceLine[]): void {
  for (const pl of list) {
    try {
      series.removePriceLine(pl);
    } catch {
      /* ignore */
    }
  }
}

// One SL or TP line for a position, registered in the drag-to-edit map.
function addSlTpLine(
  series: ISeriesApi<"Candlestick">,
  pos: Position,
  field: SlTpField,
  price: number,
  pnl: number,
  out: IPriceLine[],
  map: SlTpMap,
  colors: ChartColors,
): void {
  const isTp = field === "takeProfit";
  const line = series.createPriceLine({
    price,
    color: isTp ? colors.tpLine : colors.slLine,
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: `${isTp ? "TP" : "SL"}  ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
  });
  out.push(line);
  map.set(`${pos.id}:${isTp ? "tp" : "sl"}`, {
    line,
    price,
    positionId: pos.id,
    field,
    side: pos.side,
    entryPrice: pos.entryPrice,
    quantity: pos.quantity,
  });
}

function addPositionOverlay(
  series: ISeriesApi<"Candlestick">,
  pos: Position,
  opts: OverlayOpts,
  out: IPriceLine[],
  map: SlTpMap,
): void {
  if (pos.symbolName !== opts.symbol || !Number.isFinite(pos.entryPrice)) return;
  out.push(
    series.createPriceLine({
      price: pos.entryPrice,
      color: pos.side === "LONG" ? opts.colors.up : opts.colors.down,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: `${pos.side === "LONG" ? "buy" : "sell"} ${pos.quantity.toFixed(2)}`,
    }),
  );
  const direction = pos.side === "LONG" ? 1 : -1;
  const pnlAt = (target: number) =>
    parseFloat(
      ((target - pos.entryPrice) * direction * pos.quantity * opts.contractSize).toFixed(2),
    );
  if (typeof pos.takeProfit === "number" && Number.isFinite(pos.takeProfit)) {
    addSlTpLine(
      series,
      pos,
      "takeProfit",
      pos.takeProfit,
      pnlAt(pos.takeProfit),
      out,
      map,
      opts.colors,
    );
  }
  if (typeof pos.stopLoss === "number" && Number.isFinite(pos.stopLoss)) {
    addSlTpLine(series, pos, "stopLoss", pos.stopLoss, pnlAt(pos.stopLoss), out, map, opts.colors);
  }
}

function addOrderOverlay(
  series: ISeriesApi<"Candlestick">,
  ord: Order,
  symbol: string,
  orderColor: string,
  out: IPriceLine[],
): void {
  if (
    ord.symbolName !== symbol ||
    ord.status !== "PENDING" ||
    !Number.isFinite(ord.price as number)
  ) {
    return;
  }
  out.push(
    series.createPriceLine({
      price: ord.price as number,
      color: orderColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `[P] ${ord.side} ${ord.type} ${ord.quantity}`,
    }),
  );
}

// ── Chart interaction handlers ───────────────────────────────────────────────

// Crosshair left the series — restore the legend to the latest live bar exactly
// once so it doesn't stay frozen on the last hovered candle.
function restoreLegendOnLeave(
  restored: Ref<boolean>,
  lastCandle: Ref<CandlestickData<Time> | null>,
  legendVol: Ref<number>,
  setLegend: Dispatch<SetStateAction<OhlcvLegend | null>>,
): void {
  if (!restored.current && lastCandle.current) {
    setLegend(candleToLegend(lastCandle.current, legendVol.current));
  }
  restored.current = true;
}

// ── Replay trade-event marker helpers ────────────────────────────────────────

type ReplayTradeEvent = NonNullable<ChartPanelProps["replayTradeEvents"]>[number];

function entryMarker(ev: ReplayTradeEvent, time: Time): SeriesMarker<Time> {
  const isBuy = ev.side === "BUY";
  return {
    time,
    position: isBuy ? "belowBar" : "aboveBar",
    color: isBuy ? "#2196F3" : "#FF9800",
    shape: isBuy ? "arrowUp" : "arrowDown",
    text: isBuy ? "B" : "S",
  };
}

function exitMarker(ev: ReplayTradeEvent, time: Time): SeriesMarker<Time> {
  const profit = ev.pnl != null && ev.pnl >= 0;
  const text = ev.pnl != null ? `${ev.pnl >= 0 ? "+" : ""}$${Math.abs(ev.pnl).toFixed(0)}` : "Exit";
  return {
    time,
    position: profit ? "aboveBar" : "belowBar",
    color: profit ? "#089981" : "#f23645",
    shape: "circle",
    text,
  };
}

function buildReplayMarker(ev: ReplayTradeEvent, timeframe: Timeframe): SeriesMarker<Time> | null {
  const evMs = new Date(ev.timestamp).getTime();
  if (Number.isNaN(evMs)) return null;
  const time = toChartTime(liveBucket(Math.floor(evMs / 1000), timeframe)) as Time;
  if (ev.type === "entry") return entryMarker(ev, time);
  if (ev.type === "exit") return exitMarker(ev, time);
  return {
    time,
    position: "aboveBar",
    color: "#FF1744",
    shape: "square",
    text: ev.ruleCode ?? "Rule",
  };
}

// ── HUD presentational sub-components ────────────────────────────────────────
// Extracted so the legend's per-value colour ternaries live here instead of
// inflating the ChartPanel render function's cognitive complexity.

interface PickLine {
  x: number;
  /** Cursor y, where the scissors sit. */
  y: number;
  /** Time of the bar under the cursor, for the "Re:" label on the time axis. */
  time: number;
  intraday: boolean;
  /** Price-scale width and time-scale height: the overlay stays off the axes. */
  right: number;
  bottom: number;
}

/**
 * Replay's select-bar step, as TradingView draws it: a blue line through the
 * hovered bar down across the time axis, scissors at the cursor, the bars to
 * the right faded, and a blue "Re: <date>" label on the time axis.
 */
function ReplayPickOverlay({ x }: { x: PickLine }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      <div className="absolute top-0 bg-card/65" style={{ left: x.x + 1, right: x.right, bottom: x.bottom }} />
      <div className="absolute bottom-0 top-0 w-px bg-[#2962ff]" style={{ left: x.x }} />
      <Scissors
        className="absolute h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 -rotate-90 text-foreground"
        strokeWidth={1.5}
        style={{ left: x.x + 1, top: x.y }}
      />
      <div
        className="absolute flex -translate-x-1/2 items-center whitespace-nowrap bg-[#2962ff] px-1.5 text-[12px] text-white"
        style={{ left: x.x, bottom: 0, height: x.bottom - 2 }}
      >
        Re: {formatAxisTime(x.time, x.intraday)}
      </div>
    </div>
  );
}

const TF_LABEL: Record<string, string> = {
  "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "1h", "4h": "4h", "1d": "1D", "1w": "1W",
};

/** The legend's lines for a snapshot: the series with O / H / L / C and change, then Vol. */
function snapshotLegendLines(
  selectedSymbol: string,
  description: string | null,
  timeframe: Timeframe,
  legend: OhlcvLegend | null,
  digits: number,
): LegendLine[] {
  const colon = selectedSymbol.indexOf(":");
  const exchange = colon > 0 ? selectedSymbol.slice(0, colon) : null;
  const ticker = colon > 0 ? selectedSymbol.slice(colon + 1) : selectedSymbol;
  const text = [description || ticker, TF_LABEL[timeframe] ?? timeframe, exchange].filter(Boolean).join(" · ");
  if (!legend) return [{ text, values: [] }];
  const color = legend.c >= legend.o ? "#089981" : "#f23645";
  const change = legend.c - legend.o;
  const sign = (v: number) => (v >= 0 ? "+" : "−");
  return [
    {
      text,
      values: [
        { title: "O", value: legend.o.toFixed(digits), color },
        { title: "H", value: legend.h.toFixed(digits), color },
        { title: "L", value: legend.l.toFixed(digits), color },
        { title: "C", value: legend.c.toFixed(digits), color },
        { value: `${sign(change)}${Math.abs(change).toFixed(digits)} (${sign(legend.change)}${Math.abs(legend.change).toFixed(2)}%)`, color },
      ],
    },
    { text: "Vol", values: [{ value: compactVolume(legend.v), color }] },
  ];
}

function compactVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} K`;
  return v.toFixed(v < 10 ? 2 : 0);
}

function OhlcValue({ label, value, digits, tone }: { label: string; value: number; digits: number; tone: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-foreground">{label}</span>
      <span className={tone}>{value.toFixed(digits)}</span>
    </span>
  );
}

/** A TradingView-style SELL / BUY quote box under the legend title. */
function QuoteBox({
  side,
  price,
  digits,
  onClick,
  solid,
}: {
  side: "SELL" | "BUY";
  price: number;
  digits: number;
  onClick?: () => void;
  /** Filled boxes, as TradingView shows them once a broker is connected. */
  solid?: boolean;
}) {
  const sell = side === "SELL";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? `${sell ? "Sell" : "Buy"} at market` : undefined}
      className={cn(
        // TradingView: 59 × 34, 0 10px 2px padding, 6px corners, 13px regular text.
        "pointer-events-auto flex h-[34px] min-w-[59px] flex-col items-center justify-center rounded-[6px] border bg-card px-[10px] pb-[2px] leading-none transition-colors",
        solid
          ? sell
            ? "border-[#f23645] bg-[#f23645] text-white hover:brightness-110"
            : "border-[#2962ff] bg-[#2962ff] text-white hover:brightness-110"
          : sell
            ? "border-[#f23645] text-[#f23645] hover:bg-[#f23645] hover:text-white"
            : "border-[#2962ff] text-[#2962ff] hover:bg-[#2962ff] hover:text-white",
        !onClick && "pointer-events-none",
      )}
    >
      <span className="text-[13px] tabular-nums">
        {price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}
      </span>
      <span className="mt-0.5 text-[10px] tracking-wide">{side}</span>
    </button>
  );
}

// Symbol / interval / exchange and OHLC header in the chart's top-left corner,
// laid out like TradingView's legend.
function ChartLegendHeader({
  selectedSymbol,
  description,
  timeframe,
  legend,
  tick,
  pipDigits,
  showOhlcLegend,
  isReplaying,
  replayPrice,
  onMarketOrder,
  tradingConnected,
  availableWidth,
}: {
  /** The legend's available width (px), which picks its layout as TradingView's does. */
  availableWidth: number;
  selectedSymbol: string;
  description?: string | null;
  timeframe: Timeframe;
  legend: OhlcvLegend | null;
  tick?: TickData;
  pipDigits: number;
  showOhlcLegend: boolean;
  isReplaying: boolean;
  /** Close of the bar under the replay cursor: what replay orders fill at. */
  replayPrice?: number;
  onMarketOrder?: (side: "BUY" | "SELL") => void;
  tradingConnected?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const colon = selectedSymbol.indexOf(":");
  const exchange = colon > 0 ? selectedSymbol.slice(0, colon) : null;
  const ticker = colon > 0 ? selectedSymbol.slice(colon + 1) : selectedSymbol;
  const title = description || ticker;
  const up = legend ? legend.c >= legend.o : true;
  const tone = up ? "text-[#089981]" : "text-[#f23645]";
  const absChange = legend ? legend.c - legend.o : 0;
  // In replay the quote boxes trade the close of the bar under the cursor.
  const bid = isReplaying ? replayPrice : tick?.bid;
  const ask = isReplaying ? replayPrice : tick?.ask;
  // The legend's width modes (LegendRenderer.updateMode).
  const stacked = availableWidth < 542;
  const hideUnimportant = availableWidth <= 272;
  const showIntervalAndExchange = availableWidth >= 442;

  return (
    <div className="absolute top-1.5 left-2 z-10 select-none pointer-events-none text-[13px] leading-[20px]">
      {/* TradingView's series row: the title block (it never wraps; its titles
          shrink, the exchange three times faster) then the values, which wrap
          onto their own line when they don't fit. Under 542px they always go
          below; at 272px and under O / H / L are dropped; under 442px the
          interval and exchange titles are. */}
      <div
        className={cn("flex max-w-full", stacked ? "flex-col items-start" : "flex-wrap items-center")}
        style={{ maxWidth: availableWidth }}
      >
        <div className="flex min-w-0 max-w-full flex-nowrap items-center gap-1.5">
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-tv-active text-[10px] font-bold text-tv-active-foreground">
            {ticker.charAt(0)}
          </span>
          <span className="flex min-w-0 items-center overflow-hidden whitespace-nowrap text-[16px] text-foreground">
            <span className="min-w-[23px] truncate" style={{ flex: "0 1 auto" }}>{title}</span>
            {showIntervalAndExchange && (
              <span className="min-w-[23px] shrink-0">
                <span className="mx-1 text-muted-foreground">·</span>
                {TF_LABEL[timeframe] ?? timeframe}
              </span>
            )}
            {showIntervalAndExchange && exchange && (
              <span className="min-w-[23px] truncate" style={{ flex: "0 3 auto" }}>
                <span className="mx-1 text-muted-foreground">·</span>
                {exchange}
              </span>
            )}
          </span>
          {!isReplaying && (
            <span
              title="Live data"
              className="flex h-[20px] shrink-0 items-center rounded-[10px] bg-[#089981]/15 px-[7px]"
            >
              <span className="h-[7px] w-[7px] rounded-full bg-[#089981]" />
            </span>
          )}
          {isReplaying && (
            <span
              title="Bar replay is on"
              className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#2962ff] text-white"
            >
              <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="currentColor" aria-hidden="true">
                <path d="M8 3v10L1.5 8zM15 3v10L8.5 8z" />
              </svg>
            </span>
          )}
        </div>
        {legend && showOhlcLegend && !collapsed && (
          // A values row too long for the legend is cut off with an ellipsis.
          <span className={cn("block max-w-full overflow-hidden text-ellipsis whitespace-nowrap tabular-nums [&>span]:mr-2", !stacked && "ml-1")}>
            {!hideUnimportant && <OhlcValue label="O" value={legend.o} digits={pipDigits} tone={tone} />}
            {!hideUnimportant && <OhlcValue label="H" value={legend.h} digits={pipDigits} tone={tone} />}
            {!hideUnimportant && <OhlcValue label="L" value={legend.l} digits={pipDigits} tone={tone} />}
            <OhlcValue label="C" value={legend.c} digits={pipDigits} tone={tone} />
            <span className={cn("whitespace-nowrap", tone)}>
              {absChange >= 0 ? "+" : "−"}
              {Math.abs(absChange).toFixed(pipDigits)} ({legend.change >= 0 ? "+" : "−"}
              {Math.abs(legend.change).toFixed(2)}%)
            </span>
          </span>
        )}
      </div>

      {!collapsed && bid != null && ask != null && (
        // TradingView's strip: 4px 5px padding on half-transparent white, the
        // spread in 10px between the two boxes.
        <div className="-ml-[4px] mt-[2px] flex w-fit items-center bg-card/50 px-[5px] py-1">
          <QuoteBox side="SELL" price={bid} digits={pipDigits} solid={tradingConnected} onClick={onMarketOrder && (() => onMarketOrder("SELL"))} />
          <span className="w-[35px] text-center text-[10px] tabular-nums text-foreground">
            {(ask - bid).toFixed(Math.min(pipDigits, 2))}
          </span>
          <QuoteBox side="BUY" price={ask} digits={pipDigits} solid={tradingConnected} onClick={onMarketOrder && (() => onMarketOrder("BUY"))} />
        </div>
      )}

      {!collapsed && legend && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-foreground">Vol</span>
          <span className={cn("tabular-nums", tone)}>{compactVolume(legend.v)}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "Show legend" : "Hide legend"}
        className="pointer-events-auto mt-1 flex h-[22px] w-[26px] items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <svg viewBox="0 0 12 12" className={cn("h-3 w-3 transition-transform", collapsed && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M3 7.5l3-3 3 3" />
        </svg>
      </button>
    </div>
  );
}

// Floating toolbar / settings dialog for the currently selected drawing.
// Extracted so the selection branching doesn't inflate ChartPanel's CC.
function DrawingOverlays({
  drawing,
  showSettings,
  currentTf,
  onUpdate,
  onClone,
  onRemove,
  onOpenSettings,
  onCloseSettings,
}: {
  drawing: DrawingLine | null;
  showSettings: boolean;
  currentTf: string;
  onUpdate: (d: DrawingLine) => void;
  onClone: () => void;
  onRemove: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  if (!drawing) return null;
  if (showSettings) {
    return (
      <DrawingSettingsDialog
        drawing={drawing}
        currentTf={currentTf}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onClose={onCloseSettings}
      />
    );
  }
  return (
    <DrawingToolbar
      drawing={drawing}
      onUpdate={onUpdate}
      onClone={onClone}
      onRemove={onRemove}
      onOpenSettings={onOpenSettings}
    />
  );
}


// ═══════════════════════════════════════════════════════════
// CHART PANEL (lightweight-charts)
// ═══════════════════════════════════════════════════════════

export function ChartPanel({
  candles,
  selectedSymbol,
  timeframe,
  isDark,
  activeIndicators,
  drawingTool,
  cursorMode = "cross",
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onRemoveDrawing,
  onDrawingComplete,
  onDrawingToolSelect,
  onUndoDrawing,
  onRedoDrawing,
  magnetMode = "none",
  stayInDrawingMode = false,
  positions,
  orders,
  tick,
  liveCandle,
  pipDigits,
  symbolInfo,
  onModifyPosition,
  replayTradeEvents,
  activePlugins = [],
  onTogglePlugin,
  accountEquity = 0,
  accountId,
  onQuickOrder,
  onClearDrawings,
  onClearIndicators,
  isReplaying = false,
  replayPicking = false,
  onReplayPick,
  onMarketOrder,
  onChartApi,
  snapshotLegendRef,
  settingsRequest = 0,
  onCrosshairBar,
  onOpenObjectTree,
  tradingConnected = false,
}: ChartPanelProps) {
  const queryClient = useQueryClient();
  const lastGapRefetchAtRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Scroll-triggered historical extension — older bars prepended as the user
  // scrolls left past what the initial deep-fetch already loaded.
  const [historicalExtra, setHistoricalExtra] = useState<{ view: string; bars: Candle[] }>({
    view: `${selectedSymbol}:${timeframe}`,
    bars: [],
  });
  const loadMoreRef = useRef<LoadMoreState>({
    loading: false,
    noMoreData: false,
    lastFetchedBeforeMs: 0,
    fetchFromMs: 0,
    emptyWindows: 0,
  });
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const futureSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRef = useRef<IPriceLine[]>([]);
  const drawingManagerRef = useRef<DrawingToolsManager | null>(null);
  // Current timeframe mirrored in a ref so the persistent chart's history
  // loader always fetches the active TF (the chart is no longer recreated on
  // TF change — see the TF-change effect below).
  const timeframeRef = useRef(timeframe);
  const chartPluginsRef = useRef<ISeriesPrimitive<Time>[]>([]);
  const bidLineRef = useRef<IPriceLine | null>(null);
  const askLineRef = useRef<IPriceLine | null>(null);
  const midLineRef = useRef<IPriceLine | null>(null);

  // ── SL/TP drag-to-edit state ──
  const slTpLinesRef = useRef<SlTpMap>(new Map());

  // Increments every time the chart instance is (re)created. Hooks that bind
  // DOM/series listeners (SL/TP drag, challenge levels) depend on this so they
  // re-bind against the live chart — without it they'd capture null refs on
  // mount (the create-effect runs after them) and never attach.
  const [chartEpoch, setChartEpoch] = useState(0);
  // The theme-coloured plugins (recoloured in place on a theme change).
  const boldTicksRef = useRef<BoldPriceTicks | null>(null);
  const volumeLabelRef = useRef<CountdownLabel | null>(null);

  // OHLCV legend state
  const [legend, setLegend] = useState<OhlcvLegend | null>(null);
  // Chart snapshots draw the legend as it reads now.
  useEffect(() => {
    if (!snapshotLegendRef) return;
    snapshotLegendRef.current = () =>
      snapshotLegendLines(selectedSymbol, symbolInfo?.displayName ?? null, timeframe, legend, pipDigits);
  });
  // True once the legend has been restored to the latest bar after the crosshair
  // left the series — prevents re-setting (and re-rendering) on every off-series
  // mouse move while the cursor sits outside the plotted data.
  const legendRestoredRef = useRef(true);

  const chartPrefs = useChartPreferences();
  // Theme palette with the user's Chart Settings color overrides applied.
  // Everything downstream (chart options, bid/ask lines, position overlays,
  // volume bars) reads from this merged object.
  const colors = useMemo(
    () => mergeChartColors(isDark ? CHART_COLORS.dark : CHART_COLORS.light, chartPrefs),
    [isDark, chartPrefs],
  );
  // The theme the chart is (re)created with.
  const themeRef = useRef({ colors, isDark });

  // Scroll-loaded history is tagged with the view it belongs to, so a symbol
  // or timeframe change drops it during render rather than from a reset effect
  // — stale out-of-range candles can never be mixed into the new view, not even
  // for one frame. The imperative loader state is reset in the same effect that
  // rebuilds the loader (below).
  useEffect(() => {
    // Async so the mutation happens after commit rather than in the body.
    const id = setTimeout(() => {
      loadMoreRef.current = {
        loading: false,
        noMoreData: false,
        lastFetchedBeforeMs: 0,
        fetchFromMs: 0,
        emptyWindows: 0,
      };
      lastGapRefetchAtRef.current = 0;
    }, 0);
    return () => clearTimeout(id);
  }, [selectedSymbol, timeframe]);

  // ── Drawing selection (floating toolbar / settings dialog / object tree) ──
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<string[]>([]);
  const [showDrawingSettings, setShowDrawingSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // ── Chart-wide context menu + settings dialog ──
  // When a right-click lands on a drawing the DrawingToolsManager opens the
  // drawing menu and sets this flag synchronously (native listeners fire before
  // React's delegated onContextMenu), so the chart menu stays closed.
  const drawingMenuOpenedRef = useRef(false);
  const [chartMenu, setChartMenu] = useState<{ x: number; y: number; price: number | null } | null>(
    null,
  );
  const [showChartSettings, setShowChartSettings] = useState(false);
  const [legendWidth, setLegendWidth] = useState(1000);
  /** The drawing whose text is being typed in place, and the table cell. */
  const [textEdit, setTextEdit] = useState<{ id: string; cell?: [number, number] } | null>(null);

  // The layout's settings button bumps `settingsRequest`; open on each bump.
  const [seenSettingsRequest, setSeenSettingsRequest] = useState(settingsRequest);
  if (settingsRequest !== seenSettingsRequest) {
    setSeenSettingsRequest(settingsRequest);
    if (settingsRequest > 0) setShowChartSettings(true);
  }

  // ── Bar replay: choosing the start bar ──
  const [pickX, setPickX] = useState<PickLine | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !replayPicking) return;
    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.point || param.time == null) {
        setPickX(null);
        return;
      }
      // Snap to the hovered bar's centre, as TradingView does.
      const x = chart.timeScale().timeToCoordinate(param.time) ?? param.point.x;
      setPickX({
        x,
        y: param.point.y,
        time: Number(param.time),
        intraday: (timeframeMs(timeframeRef.current) || 60_000) < 86_400_000,
        right: chart.priceScale("right").width(),
        bottom: chart.timeScale().height(),
      });
    };
    const onClick = (param: MouseEventParams<Time>) => {
      if (param.time != null) onReplayPick?.(fromChartTime(Number(param.time)));
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      setPickX(null);
    };
  }, [replayPicking, chartEpoch, onReplayPick]);

  // Without bid/ask lines (TradingView's default, and always in replay) the
  // series shows its last-price line and labels. The labels are ours
  // (CountdownLabel): lightweight-charts' own follows the last visible bar.
  const showSeriesLast = isReplaying || (!chartPrefs.showBidLine && !chartPrefs.showAskLine);
  const countdownRef = useRef<CountdownLabel | null>(null);
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      lastValueVisible: false,
      priceLineVisible: showSeriesLast,
      priceLineStyle: LineStyle.Dotted,
    });
    countdownRef.current?.setVisible(showSeriesLast);
  }, [showSeriesLast, chartEpoch]);
  // The style toolbar / settings dialog only apply to a single selection.
  const selectedDrawing = useMemo(
    () =>
      selectedDrawingIds.length === 1
        ? (drawings.find((d) => d.id === selectedDrawingIds[0]) ?? null)
        : null,
    [drawings, selectedDrawingIds],
  );

  // Drawings actually shown on this chart: not hidden, and either visible on
  // all timeframes or scoped to the current one.
  const visibleDrawings = useMemo(
    () => drawings.filter((d) => !d.hidden && (d.visibility !== "tf" || d.createdTf === timeframe)),
    [drawings, timeframe],
  );

  // Stable refs so the chart-create effect doesn't re-run on every parent render
  // when these props are unstable (e.g. inline onAddDrawing).
  const drawingToolRef = useRef(drawingTool);
  const drawingsRef = useRef(visibleDrawings);
  const magnetRef = useRef(magnetMode);
  const stayInModeRef = useRef(stayInDrawingMode);
  const accountEquityRef = useRef(accountEquity);
  const styleDefaultsRef = useRef(getStyleDefaults());
  const onAddDrawingRef = useRef(onAddDrawing);
  const onUpdateDrawingRef = useRef(onUpdateDrawing);
  const onRemoveDrawingRef = useRef(onRemoveDrawing);
  const onDrawingCompleteRef = useRef(onDrawingComplete);
  const onDrawingToolSelectRef = useRef(onDrawingToolSelect);
  const onUndoDrawingRef = useRef(onUndoDrawing);
  const onRedoDrawingRef = useRef(onRedoDrawing);
  const onChartApiRef = useRef(onChartApi);
  /** Manually panned price range (TradingView's auto-scale off), or null. */
  const priceOverrideRef = useRef<{ min: number; max: number } | null>(null);
  const resetPriceOverrideRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    drawingToolRef.current = drawingTool;
    drawingManagerRef.current?.setTool(drawingTool);
  }, [drawingTool]);
  const cursorModeRef = useRef(cursorMode);
  useEffect(() => {
    cursorModeRef.current = cursorMode;
    drawingManagerRef.current?.setCursorMode(cursorMode);
    // The Arrow cursor hides the crosshair lines; their axis labels stay.
    chartRef.current?.applyOptions({
      crosshair: { vertLine: { visible: cursorMode !== "arrow" }, horzLine: { visible: cursorMode !== "arrow" } },
    });
  }, [cursorMode]);
  useEffect(() => {
    drawingsRef.current = visibleDrawings;
    drawingManagerRef.current?.setDrawings(visibleDrawings);
  }, [visibleDrawings]);

  // TradingView's Image tool: placing it asks for a picture; cancelling
  // (or an unreadable file) removes the drawing again.
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRef = useRef<string | null>(null);
  const pickImage = useCallback((id: string) => {
    imageTargetRef.current = id;
    const input = imageInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);
  const onImageChosenRef = useRef<(file: File | undefined) => void>(() => undefined);
  const onImageChosen = (file: File | undefined) => {
    const id = imageTargetRef.current;
    imageTargetRef.current = null;
    const d = drawingsRef.current.find((x) => x.id === id);
    if (!d) return;
    if (!file) {
      onRemoveDrawing?.(d.id);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const chart = chartRef.current;
        const pane = chart ? { w: chart.timeScale().width(), h: chart.paneSize().height } : { w: 800, h: 600 };
        const size = initialImageSize({ w: img.naturalWidth, h: img.naturalHeight }, pane);
        onUpdateDrawing?.({ ...d, imageUrl: url, cssWidth: size.w, cssHeight: size.h, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      };
      img.onerror = () => onRemoveDrawing?.(d.id);
      img.src = url;
    };
    reader.readAsDataURL(file);
  };
  useEffect(() => {
    onImageChosenRef.current = onImageChosen;
  });
  useEffect(() => {
    setOnImageLoaded(() => drawingManagerRef.current?.setDrawings(drawingsRef.current));
  }, []);
  const pickImageRef = useRef(pickImage);
  useEffect(() => {
    pickImageRef.current = pickImage;
  });
  // The file dialog's Cancel (React has no onCancel for inputs).
  useEffect(() => {
    const input = imageInputRef.current;
    if (!input) return;
    const onCancel = () => onImageChosenRef.current(undefined);
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
  }, []);
  useEffect(() => {
    magnetRef.current = magnetMode;
    drawingManagerRef.current?.setMagnetMode(magnetMode);
  }, [magnetMode]);
  useEffect(() => {
    accountEquityRef.current = accountEquity;
    drawingManagerRef.current?.setAccountEquity(accountEquity);
  }, [accountEquity]);
  useEffect(() => {
    const refresh = () => {
      styleDefaultsRef.current = getStyleDefaults();
      drawingManagerRef.current?.setStyleDefaults(styleDefaultsRef.current);
    };
    window.addEventListener(DRAWING_STYLES_EVENT, refresh);
    return () => window.removeEventListener(DRAWING_STYLES_EVENT, refresh);
  }, []);
  useEffect(() => {
    stayInModeRef.current = stayInDrawingMode;
    drawingManagerRef.current?.setStayInDrawingMode(stayInDrawingMode);
  }, [stayInDrawingMode]);
  useEffect(() => {
    onAddDrawingRef.current = onAddDrawing;
    onUpdateDrawingRef.current = onUpdateDrawing;
    onRemoveDrawingRef.current = onRemoveDrawing;
    onDrawingCompleteRef.current = onDrawingComplete;
    onDrawingToolSelectRef.current = onDrawingToolSelect;
    onUndoDrawingRef.current = onUndoDrawing;
    onRedoDrawingRef.current = onRedoDrawing;
    onChartApiRef.current = onChartApi;
  });

  // Clone the selected drawing, offset 5 bars right so the copy is visible.
  const handleCloneDrawing = useCallback(() => {
    const d = selectedDrawing;
    if (!d) return;
    const offsetSec = ((timeframeMs(timeframe) || 60_000) / 1000) * 5;
    onAddDrawing({
      ...d,
      id: uid(),
      time: d.time != null ? d.time + offsetSec : undefined,
      time2: d.time2 != null ? d.time2 + offsetSec : undefined,
    });
  }, [selectedDrawing, timeframe, onAddDrawing]);

  // Z-order: bring to front = above the current max, send to back = below min.
  const handleReorderDrawing = useCallback(
    (d: DrawingLine, dir: "front" | "back") => {
      const zs = drawings.map((x) => x.zIndex ?? 0);
      const zIndex = dir === "front" ? Math.max(...zs, 0) + 1 : Math.min(...zs, 0) - 1;
      onUpdateDrawing?.({ ...d, zIndex });
    },
    [drawings, onUpdateDrawing],
  );

  // Object-tree row click → select on the chart (no-op for drawings that are
  // hidden or scoped off this timeframe, since the manager doesn't know them).
  const handleObjectTreeSelect = useCallback((d: DrawingLine) => {
    drawingManagerRef.current?.setSelection([d.id]);
  }, []);

  // ── Extracted hooks ────────────────────────────────────────
  // Merge scroll-loaded historical extension (older) with the live data (newer).
  // useChartData deduplicates by timestamp, so overlap is safe.
  const allCandles = useMemo(() => {
    // Bars loaded for a different symbol/timeframe are discarded during render,
    // so a view switch can never mix stale out-of-range candles into the chart.
    const extra =
      historicalExtra.view === `${selectedSymbol}:${timeframe}` ? historicalExtra.bars : [];
    return extra.length === 0 ? candles : [...extra, ...candles];
  }, [historicalExtra, candles, selectedSymbol, timeframe]);
  const { chartData, volumeData } = useChartData(allCandles, colors, timeframe);

  const {
    newsConfig,
    setNewsConfig,
    showNewsConfigDialog,
    setShowNewsConfigDialog,
    newsPopup,
    setNewsPopup,
  } = useNewsOverlay(containerRef, chartRef, selectedSymbol, isDark, chartData);

  const dragPrice = useSlTpDrag(
    containerRef,
    chartRef,
    candleSeriesRef,
    slTpLinesRef,
    drawingTool,
    onModifyPosition,
    pipDigits,
    symbolInfo,
    chartEpoch,
  );

  // ── Challenge-aware rule levels (daily loss / max DD / profit target) ──
  const challengeFlags = useMemo(
    () => ({
      enabled: chartPrefs.challengeOverlay && !!accountId,
      dailyLoss: chartPrefs.challengeDailyLossLine,
      maxDrawdown: chartPrefs.challengeMaxDrawdownLine,
      profitTarget: chartPrefs.challengeProfitTargetLine,
    }),
    [
      chartPrefs.challengeOverlay,
      chartPrefs.challengeDailyLossLine,
      chartPrefs.challengeMaxDrawdownLine,
      chartPrefs.challengeProfitTargetLine,
      accountId,
    ],
  );
  useChallengeLevels({
    accountId,
    selectedSymbol,
    positions,
    tick,
    contractSize: symbolInfo?.contractSize || 100000,
    accountEquity,
    candleSeriesRef,
    flags: challengeFlags,
    chartEpoch,
  });

  // ── Chart context-menu actions ──
  const handleChartContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (drawingMenuOpenedRef.current) {
      drawingMenuOpenedRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = candleSeriesRef.current?.coordinateToPrice(e.clientY - rect.top);
    const price = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    setChartMenu({ x: e.clientX, y: e.clientY, price });
  }, []);

  const handleResetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale("right").applyOptions({ autoScale: true });
    resetPriceOverrideRef.current?.();
    initialView(chart, candleSeriesRef.current?.data().length ?? 0, rightMarginBars(timeframeRef.current));
  }, []);

  // The Object tree selects drawings on the chart through a window event.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) handleObjectTreeSelect({ id } as DrawingLine);
    };
    window.addEventListener(SELECT_DRAWING_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_DRAWING_EVENT, onSelect);
  }, [handleObjectTreeSelect]);

  // Report the bar under the crosshair (the last bar when it leaves) for the
  // Data window.
  const onCrosshairBarRef = useRef(onCrosshairBar);
  useEffect(() => {
    onCrosshairBarRef.current = onCrosshairBar;
  });
  const chartDataRef = useRef<{ data: CandlestickData<Time>[]; volume: HistogramData<Time>[] }>({ data: [], volume: [] });
  useEffect(() => {
    chartDataRef.current = { data: chartData, volume: volumeData };
    const last = chartData.length - 1;
    if (last >= 0) onCrosshairBarRef.current?.(barAt(chartData, volumeData, last));
  }, [chartData, volumeData]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onMove = (param: MouseEventParams<Time>) => {
      const { data, volume } = chartDataRef.current;
      if (data.length === 0) return;
      let idx = data.length - 1;
      if (param.time != null) {
        const t = Number(param.time);
        const i = lowerBoundTime(data, t);
        if (i < data.length && Number(data[i]!.time) === t) idx = i;
      }
      onCrosshairBarRef.current?.(barAt(data, volume, idx));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [chartEpoch]);

  // Alt + R from anywhere on the page resets the view (see TradingPage).
  useEffect(() => {
    window.addEventListener(RESET_VIEW_EVENT, handleResetView);
    return () => window.removeEventListener(RESET_VIEW_EVENT, handleResetView);
  }, [handleResetView]);

  const handleCopyPrice = useCallback(
    (price: number) => {
      const text = price.toFixed(pipDigits);
      void navigator.clipboard
        ?.writeText(text)
        .then(() => toast.success("Copied", text))
        .catch(() => toast.error("Copy failed", "Clipboard unavailable"));
    },
    [pipDigits],
  );

  const handleAddAlert = useCallback(
    (price: number) => {
      const rounded = parseFloat(price.toFixed(pipDigits));
      onAddDrawing({
        id: uid(),
        type: "horizontal",
        price: rounded,
        color: "#f0b90b",
        alertEnabled: true,
        createdTf: timeframe,
      });
      toast.info("Alert set", `${selectedSymbol} at ${rounded}`);
    },
    [onAddDrawing, pipDigits, timeframe, selectedSymbol],
  );

  useIndicators(chartRef, candleSeriesRef, chartData, activeIndicators, isDark);

  // ── Replay trade event markers ─────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    if (!replayTradeEvents || replayTradeEvents.length === 0) {
      series.setMarkers([]);
      return;
    }
    const markers: SeriesMarker<Time>[] = [];
    for (const ev of replayTradeEvents) {
      const marker = buildReplayMarker(ev, timeframe);
      if (marker) markers.push(marker);
    }
    // lightweight-charts requires markers sorted by time ascending
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(markers);
    return () => {
      series.setMarkers([]);
    };
  }, [replayTradeEvents, timeframe]);

  // ── Countdown to bar close, on the last-price label ─────────
  // TradingView's default; shown while the current bar is still open, so a
  // closed market shows none.
  const showBarCountdown = chartPrefs.showCountdown && showSeriesLast && !isReplaying;
  useEffect(() => {
    const label = countdownRef.current;
    if (!label) return;
    const intervalSec = timeframeSeconds(timeframe);
    if (!showBarCountdown || !intervalSec) {
      label.setState(null);
      return;
    }
    const tick = () => {
      const last = lastCandleRef.current;
      if (!last) return label.setState(null);
      const left = fromChartTime(last.time as number) + intervalSec - Date.now() / 1000;
      if (left <= 0 || left > intervalSec) return label.setState(null);
      label.setState({ text: countdownText(left) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeframe, showBarCountdown, chartEpoch]);

  // ── Create / destroy the chart instance ────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const minMove = getMinMove(pipDigits);
    // The theme at creation; later theme changes are applied in place (below),
    // so switching theme never resets the chart's position or scale.
    const colors = themeRef.current.colors;
    const isDark = themeRef.current.isDark;

    const chart = createChart(containerRef.current, {
      // The crosshair's time label reads like TradingView's: "Thu 22 Oct '26 15:00".
      localization: {
        // The crosshair's label writes the year out ("2026"), so it is never
        // read as a day of the month.
        timeFormatter: (t: Time) =>
          formatAxisTime(t as number, (timeframeMs(timeframeRef.current) || 60_000) < 86_400_000, true),
      },
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontFamily: CHART_FONT,
        fontSize: 12,
      },
      // TradingView defaults both grids to LINESTYLE_DOTTED (1px on, 3px off);
      // SparseDotted (1 on, 4 off) is the nearest lightweight-charts style.
      grid: {
        vertLines: { color: colors.grid, style: LineStyle.SparseDotted },
        horzLines: { color: colors.grid, style: LineStyle.SparseDotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: colors.crosshair,
          width: 1,
          style: LineStyle.LargeDashed,
          labelBackgroundColor: isDark ? "#4a4a4a" : "#131722",
          labelVisible: true,
        },
        horzLine: {
          color: colors.crosshair,
          width: 1,
          style: LineStyle.LargeDashed,
          labelBackgroundColor: isDark ? "#4a4a4a" : "#131722",
          labelVisible: true,
        },
      },
      rightPriceScale: {
        // TradingView draws no scale border (its lineColor is transparent).
        borderVisible: false,
        // Measured on TradingView: 10 % above the highs, 8 % below the lows.
        scaleMargins: { top: 0.1, bottom: 0.08 },
        autoScale: true,
        alignLabels: true,
        entireTextOnly: false,
        ticksVisible: true,
        minimumWidth: 80,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: timeframeRef.current === "1m" ? 10 : 6,
        minBarSpacing: 0.5,
        // TradingView's time scale keeps the newest bar in place while the
        // wheel zooms (its rightBarStaysOnScroll default).
        rightBarStaysOnScroll: true,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      watermark: {
        visible: true,
        text: selectedSymbol,
        fontSize: 56,
        color: colors.watermark,
        horzAlign: "center",
        vertAlign: "center",
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        // The time scale's reset is ours (it must ignore the future bars).
        // The time scale's reset is ours (it must ignore the future bars).
        axisDoubleClickReset: { time: false, price: true },
      },
    });

    chartRef.current = chart;
    onChartApiRef.current?.(chart);

    const candleSeries = chart.addCandlestickSeries({
      // While the user has panned the chart vertically the price range is
      // theirs, as on TradingView (auto-scale off); otherwise auto-fit.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const o = priceOverrideRef.current;
        return o ? { priceRange: { minValue: o.min, maxValue: o.max } } : original();
      },
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      // TradingView groups thousands on the scale and labels: 80,021.85.
      priceFormat: {
        type: "custom",
        minMove,
        formatter: (p: number) =>
          p.toLocaleString("en-US", { minimumFractionDigits: pipDigits, maximumFractionDigits: pipDigits }).replace("-", "−"),
      },
      // Hide the candle's own last-value label and default close price-line.
      // Candle close is the mid price ((bid+ask)/2) — with a 1-pip spread that
      // sits half a pip below Ask, so the mid label stacks visually next to
      // the Ask label and rounds to the same 5-decimal string. The explicit
      // Bid/Ask price lines below are the authoritative right-edge prices for
      // trading; the mid label is redundant and creates the "misaligned" look.
      lastValueVisible: false,
      priceLineVisible: false,
      priceLineWidth: 1,
      priceLineColor: "",
      priceLineStyle: LineStyle.Dotted,
    });
    const boldTicks = new BoldPriceTicks(CHART_FONT, colors.text, colors.background, Math.round(1 / minMove));
    candleSeries.attachPrimitive(boldTicks);
    boldTicksRef.current = boldTicks;
    const countdownLabel = new CountdownLabel({
      fontFamily: CHART_FONT,
      upColor: colors.up,
      downColor: colors.down,
      background: colors.background,
    });
    candleSeries.attachPrimitive(countdownLabel);
    countdownRef.current = countdownLabel;
    candleSeriesRef.current = candleSeries;

    // Volume histogram at the bottom of the chart
    const volumeSeries = chart.addHistogramSeries({
      // TradingView's volume labels: whole units, then 253.86K / 1.2M / 3.4B.
      priceFormat: { type: "custom", minMove: 1, formatter: axisVolume },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      // TradingView's volume overlay fills the lowest quarter of the pane.
      scaleMargins: { top: 0.75, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;
    // Volume gets the same current / last-visible labels as TradingView's.
    const volumeLabel = new CountdownLabel({ fontFamily: CHART_FONT, background: colors.background, dataSeries: volumeSeries });
    candleSeries.attachPrimitive(volumeLabel);
    volumeLabelRef.current = volumeLabel;

    // Whitespace-only series of future bar times: lightweight-charts labels
    // only times that have points, and TradingView's time scale keeps going
    // past the newest bar.
    const futureSeries = chart.addLineSeries({
      priceScaleId: "future",
      color: "transparent",
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    futureSeriesRef.current = futureSeries;

    // Follow new bars while the newest one is on screen, as TradingView does
    // (lightweight-charts would not: the bar lands on an existing future time).
    let barCount = 0;
    let following = true;
    const onRange = () => {
      following = showsLatest(chart, barCount);
    };
    const onData = () => {
      const n = candleSeries.data().length;
      const grew = n - barCount;
      const wasFollowing = following;
      barCount = n;
      if (grew > 0 && grew < 5 && wasFollowing) {
        const r = chart.timeScale().getVisibleLogicalRange();
        if (r) chart.timeScale().setVisibleLogicalRange({ from: r.from + grew, to: r.to + grew });
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    candleSeries.subscribeDataChanged(onData);

    // Subscribe to crosshair move for OHLCV legend
    chart.subscribeCrosshairMove((param) => {
      if (!param?.time) {
        restoreLegendOnLeave(legendRestoredRef, lastCandleRef, legendVolRef, setLegend);
        return;
      }
      legendRestoredRef.current = false;
      const data = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
      if (data) {
        const vol = param.seriesData.get(volumeSeries) as HistogramData<Time> | undefined;
        setLegend(candleToLegend(data, vol?.value || 0));
      }
    });

    // Handle resize
    // The legend's available width (TradingView: the pane's width less its
    // top-right controls and the 4px column gap) drives its layout modes.
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
      setLegendWidth(Math.max(0, chart.timeScale().width() - 4));
    });
    ro.observe(containerRef.current);

    // Interactive drawing layer (place / preview / select / drag / delete) —
    // callbacks go through refs so the create-effect doesn't depend on them.
    const drawingManager = new DrawingToolsManager({
      chart,
      series: candleSeries,
      container: containerRef.current,
      intervalSec: (timeframeMs(timeframeRef.current) || 60_000) / 1000,
      timeframe: timeframeRef.current,
      accountEquity: accountEquityRef.current,
      callbacks: {
        onAdd: (d) => onAddDrawingRef.current(d),
        onUpdate: (d) => onUpdateDrawingRef.current?.(d),
        onRemove: (id) => onRemoveDrawingRef.current?.(id),
        onToolFinished: () => onDrawingCompleteRef.current?.(),
        onSelectionChange: (ids) => {
          setSelectedDrawingIds(ids);
          setShowDrawingSettings(false);
        },
        onRequestSettings: (id) => {
          setSelectedDrawingIds([id]);
          setShowDrawingSettings(true);
        },
        onEditText: (id, cell) => setTextEdit({ id, cell }),
        onPickImage: (id) => pickImageRef.current(id),
        onContextMenu: (id, clientX, clientY) => {
          drawingMenuOpenedRef.current = true;
          setSelectedDrawingIds([id]);
          setContextMenu({ id, x: clientX, y: clientY });
        },
        onSelectTool: (t) => onDrawingToolSelectRef.current?.(t),
        onUndo: () => onUndoDrawingRef.current?.(),
        onRedo: () => onRedoDrawingRef.current?.(),
      },
    });
    drawingManager.setDrawings(drawingsRef.current);
    drawingManager.setTool(drawingToolRef.current);
    drawingManager.setCursorMode(cursorModeRef.current);
    const linesShown = cursorModeRef.current !== "arrow";
    chart.applyOptions({ crosshair: { vertLine: { visible: linesShown }, horzLine: { visible: linesShown } } });
    drawingManager.setMagnetMode(magnetRef.current);
    drawingManager.setStyleDefaults(styleDefaultsRef.current);
    drawingManager.setVolumeSeries(volumeSeries);
    drawingManager.setStayInDrawingMode(stayInModeRef.current);
    drawingManagerRef.current = drawingManager;

    // ── Free panning, TradingView-style: dragging the pane moves the chart
    // both ways. Horizontal panning is lightweight-charts' own; the vertical
    // part holds the price range manually (auto-scale off) until it is reset
    // by double-clicking the price scale or Alt + R.
    const paneEl = containerRef.current;
    let pan: { x: number; y: number; min: number; max: number; perPx: number } | null = null;
    const applyOverride = () => candleSeries.applyOptions({ autoscaleInfoProvider: candleSeries.options().autoscaleInfoProvider });
    const onPaneDown = (e: MouseEvent) => {
      if (e.button !== 0 || !["none", "eraser", "measure"].includes(drawingToolRef.current)) return;
      const rect = paneEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const paneH = rect.height - chart.timeScale().height();
      if (x < 0 || x > chart.timeScale().width() || y < 0 || y > paneH) return;
      const top = candleSeries.coordinateToPrice(0);
      const bottom = candleSeries.coordinateToPrice(paneH);
      if (top === null || bottom === null) return;
      // Undo the scale margins lightweight-charts adds around the range.
      const m = chart.priceScale("right").options().scaleMargins;
      const span = top - bottom;
      pan = {
        x: e.clientX,
        y: e.clientY,
        max: priceOverrideRef.current?.max ?? top - span * m.top,
        min: priceOverrideRef.current?.min ?? bottom + span * m.bottom,
        perPx: span / paneH,
      };
    };
    const onPaneMove = (e: MouseEvent) => {
      if (!pan || (e.buttons & 1) === 0) return;
      const shift = (e.clientY - pan.y) * pan.perPx;
      // Any drag freezes the price range, so panning sideways never rescales.
      if (!priceOverrideRef.current && Math.abs(e.clientY - pan.y) < 2 && Math.abs(e.clientX - pan.x) < 2) return;
      priceOverrideRef.current = { min: pan.min + shift, max: pan.max + shift };
      chart.priceScale("right").applyOptions({ autoScale: true });
      applyOverride();
    };
    const onPaneUp = () => {
      pan = null;
    };
    const onAxisDblClick = (e: MouseEvent) => {
      const rect = paneEl.getBoundingClientRect();
      if (e.clientY - rect.top > rect.height - chart.timeScale().height()) {
        // Time scale: default bar spacing, newest bar at the right margin.
        initialView(chart, candleSeries.data().length, rightMarginBars(timeframeRef.current));
        return;
      }
      if (e.clientX - rect.left <= chart.timeScale().width()) return;
      priceOverrideRef.current = null;
      applyOverride();
    };
    // The wheel over the price scale scales prices; over the pane it stays
    // lightweight-charts' time zoom.
    const onAxisWheel = (e: WheelEvent) => {
      const rect = paneEl.getBoundingClientRect();
      const paneH = rect.height - chart.timeScale().height();
      if (e.clientX - rect.left <= chart.timeScale().width() || e.clientY - rect.top > paneH || e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const top = candleSeries.coordinateToPrice(0);
      const bottom = candleSeries.coordinateToPrice(paneH);
      if (top === null || bottom === null) return;
      const m = chart.priceScale("right").options().scaleMargins;
      const span = top - bottom;
      const max = priceOverrideRef.current?.max ?? top - span * m.top;
      const min = priceOverrideRef.current?.min ?? bottom + span * m.bottom;
      // TradingView's _onMousewheel: a price-scale drag from the cursor 15px
      // per notch, i.e. scaleTo()'s coefficient around the middle.
      const localY = e.clientY - rect.top;
      const from = paneH - localY;
      // processWheel: pixels / 100, lines × 32, pages × 120.
      const unit = e.deltaMode === 2 ? 120 : e.deltaMode === 1 ? 32 : 1;
      const to = Math.max(0, paneH - (localY + 15 * ((e.deltaY / 100) * unit)));
      const k = Math.max(0.1, (from + (paneH - 1) * 0.2) / (to + (paneH - 1) * 0.2));
      const mid = (max + min) / 2;
      priceOverrideRef.current = { min: mid - (mid - min) * k, max: mid + (max - mid) * k };
      chart.priceScale("right").applyOptions({ autoScale: true });
      applyOverride();
    };
    paneEl.addEventListener("wheel", onAxisWheel, { capture: true, passive: false });
    paneEl.addEventListener("mousedown", onPaneDown);
    window.addEventListener("mousemove", onPaneMove);
    window.addEventListener("mouseup", onPaneUp);
    paneEl.addEventListener("dblclick", onAxisDblClick);
    resetPriceOverrideRef.current = () => {
      priceOverrideRef.current = null;
      applyOverride();
    };

    // Subscribe to time-scale scrolling so we can load older bars when the
    // user scrolls past the leftmost loaded candle (infinite history pattern).
    // `historyLoadCancelled` guards against a stale fetch resolving after a
    // symbol/timeframe/theme change: the cleanup sets it to true before
    // unsubscribing so any in-flight `onLoaded` callback is silently dropped.
    let historyLoadCancelled = false;
    const handleRangeChange = makeHistoryLoader(
      selectedSymbol,
      timeframeRef,
      candleSeriesRef,
      loadMoreRef,
      (bars) => {
        if (historyLoadCancelled) return;
        const view = `${selectedSymbol}:${timeframeRef.current}`;
        setHistoricalExtra((prev) =>
          prev.view === view
            ? { view, bars: [...bars, ...prev.bars] }
            : { view, bars: [...bars] },
        );
      },
    );
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    // Signal listener-binding hooks that a live chart instance now exists.
    setChartEpoch((e) => e + 1);

    return () => {
      historyLoadCancelled = true;
      paneEl.removeEventListener("wheel", onAxisWheel, { capture: true });
      paneEl.removeEventListener("mousedown", onPaneDown);
      window.removeEventListener("mousemove", onPaneMove);
      window.removeEventListener("mouseup", onPaneUp);
      paneEl.removeEventListener("dblclick", onAxisDblClick);
      resetPriceOverrideRef.current = null;
      // A new symbol (or theme) starts auto-scaled again.
      priceOverrideRef.current = null;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      candleSeries.unsubscribeDataChanged(onData);
      futureSeriesRef.current = null;
      ro.disconnect();
      drawingManager.destroy();
      drawingManagerRef.current = null;
      setSelectedDrawingIds([]);
      setShowDrawingSettings(false);
      onChartApiRef.current?.(null);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      bidLineRef.current = null;
      askLineRef.current = null;
      midLineRef.current = null;
      chartPluginsRef.current = [];
      // Clear per-chart state so it doesn't bleed into the recreated chart
      // (theme toggle also destroys/recreates the chart instance).
      lastCandleRef.current = null;
      legendVolRef.current = 0;
      liveCandleTsRef.current = 0;
      loadMoreRef.current = {
        loading: false,
        noMoreData: false,
        emptyWindows: 0,
        lastFetchedBeforeMs: 0,
        fetchFromMs: 0,
      };
      lastGapRefetchAtRef.current = 0;
    };
  }, [pipDigits, selectedSymbol]); // Re-create on precision / symbol change — NOT theme or timeframe (the
  // chart persists across both, as TradingView's does: drawings never blink
  // out and the view keeps its position and scale; the effects below update
  // the live state in place).

  // A theme change recolours the live chart in place.
  useEffect(() => {
    themeRef.current = { colors, isDark };
    const chart = chartRef.current;
    if (!chart) return;
    const label = isDark ? "#4a4a4a" : "#131722";
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: {
        vertLine: { color: colors.crosshair, labelBackgroundColor: label },
        horzLine: { color: colors.crosshair, labelBackgroundColor: label },
      },
      watermark: { color: colors.watermark },
    });
    candleSeriesRef.current?.applyOptions({
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    });
    boldTicksRef.current?.setColors(colors.text, colors.background);
    countdownRef.current?.setColors({ upColor: colors.up, downColor: colors.down, background: colors.background });
    volumeLabelRef.current?.setColors({ background: colors.background });
  }, [isDark, colors, chartEpoch]);

  // Update watermark text when symbol changes (visibility comes from settings)
  useEffect(() => {
    chartRef.current?.applyOptions({
      watermark: {
        visible: chartPrefs.showWatermark,
        text: selectedSymbol,
        fontSize: 56,
        color: colors.watermark,
        horzAlign: "center",
        vertAlign: "center",
      },
    });
  }, [selectedSymbol, colors.watermark, chartPrefs.showWatermark, chartEpoch]);

  // ── Live appearance settings (no chart recreation) ──
  useEffect(() => {
    // `colors` already carries the user's overrides (mergeChartColors).
    const up = colors.up;
    const down = colors.down;
    candleSeriesRef.current?.applyOptions({
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      wickVisible: chartPrefs.showWicks,
      borderVisible: chartPrefs.showCandleBorders,
    });
  }, [
    chartPrefs.candleUpColor,
    chartPrefs.candleDownColor,
    chartPrefs.showWicks,
    chartPrefs.showCandleBorders,
    colors.up,
    colors.down,
    chartEpoch,
  ]);

  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: chartPrefs.showVolume });
  }, [chartPrefs.showVolume, chartEpoch]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: {
        vertLines: { visible: chartPrefs.showGrid },
        horzLines: { visible: chartPrefs.showGrid },
      },
    });
  }, [chartPrefs.showGrid, chartEpoch]);

  // Timeframe change — the chart instance is NOT recreated (so drawings stay
  // attached); instead we update the persistent chart's options and re-point
  // the drawing manager's interval/createdTf at the new TF in place.
  useEffect(() => {
    timeframeRef.current = timeframe;
    // Another interval re-fits the price scale, as TradingView does.
    resetPriceOverrideRef.current?.();
    chartRef.current?.applyOptions({
      timeScale: {
        rightOffset: timeframe === "1m" ? 10 : 6,
        minBarSpacing: 0.5,
      },
    });
    drawingManagerRef.current?.updateTimeframe(
      timeframe,
      (timeframeMs(timeframe) || 60_000) / 1000,
    );
  }, [timeframe]);

  // ── Refs for smooth real-time streaming ────────────────
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);
  // Where the history's intraday bars start each day, for live bucketing.
  const sessionOffsetRef = useRef(0);
  const lastLoadKeyRef = useRef<string>("");
  const latestLiveCandleRef = useRef<typeof liveCandle | undefined>(undefined);
  // Authoritative server candle timestamp, normalised to unix MILLISECONDS —
  // used to ignore ticks that pre-date the latest server CandleUpdate (those can
  // pollute H/L after a WS flush delivers a buffered tick *after* its
  // corresponding aggregated candle). Stored in ms so the tick guard compares
  // like-for-like regardless of whether the server emits seconds or ms.
  const liveCandleTsRef = useRef<number>(0);
  // Last known volume — needed to keep the volume bar coloured during tick
  // smoothing without overwriting the value with 0.
  const legendVolRef = useRef<number>(0);

  // Bundle the refs/config the real-time helpers need. Memoised so the live
  // effects can depend on `makeRtCtx` directly — it changes identity exactly when
  // colors / timeframe / symbol / queryClient change, so re-run timing matches
  // listing those values individually (refs and setLegend are stable).
  const makeRtCtx = useCallback(
    (series: ISeriesApi<"Candlestick">): RtCtx => ({
      series,
      volume: volumeSeriesRef.current,
      lastCandle: lastCandleRef,
      sessionOffset: sessionOffsetRef,
      liveCandleTs: liveCandleTsRef,
      legendVol: legendVolRef,
      gapAt: lastGapRefetchAtRef,
      bidLine: bidLineRef,
      askLine: askLineRef,
      midLine: midLineRef,
      colors,
      timeframe,
      symbol: selectedSymbol,
      qc: queryClient,
      setLegend,
    }),
    [colors, timeframe, selectedSymbol, queryClient],
  );

  // Keep latest live candle in a ref (avoids stale closure in setData effect)
  useEffect(() => {
    latestLiveCandleRef.current = liveCandle;
  }, [liveCandle]);

  // Update candle data from server (historical fetch / periodic sync)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || chartData.length === 0) return;
    const ctx = makeRtCtx(series);
    const loadKey = `${selectedSymbol}:${timeframe}`;
    const isNewChart = lastLoadKeyRef.current !== loadKey;
    const followRight = showsLatest(chartRef.current, series.data().length);

    series.setData(chartData);
    volumeSeriesRef.current?.setData(volumeData);
    futureSeriesRef.current?.setData(
      futureBarTimes(chartData.map((c) => c.time as number), timeframe, FUTURE_BARS).map((t) => ({ time: t as Time })),
    );
    sessionOffsetRef.current = sessionOpenOffset(chartData.map((c) => ({ time: fromChartTime(c.time as number) })));
    // These two refs are bookkeeping for the lightweight-charts instance — the
    // external system this effect synchronises — not render state. The React
    // Compiler rule cannot tell the difference, and restructuring the real-time
    // sync around it would buy nothing but risk.
    // eslint-disable-next-line react-hooks/immutability
    lastCandleRef.current = chartData[chartData.length - 1] ?? null;
    setLegend(legendFromSeries(chartData, volumeData));

    const buffered = latestLiveCandleRef.current;
    if (!isNewChart && isReplaying) {
      // Replay reveals bars by replacing the data; keep the newest bar in view
      // when the user was following it, as a live chart does.
      if (followRight) scrollToLatest(chartRef.current, chartData.length, rightMarginBars(timeframe));
      return;
    }
    if (!isNewChart) {
      // Periodic refetch — preserve viewport, re-apply latest live data.
      reapplyLive(buffered, ctx);
      return;
    }

    initialView(chartRef.current, chartData.length, rightMarginBars(timeframe));
    lastLoadKeyRef.current = loadKey;
    // eslint-disable-next-line react-hooks/immutability
    liveCandleTsRef.current = 0;
    replayBufferedLive(buffered, chartData, ctx);
    return scheduleStaleRefetch(chartData, ctx);
  }, [chartData, volumeData, selectedSymbol, timeframe, makeRtCtx, isReplaying]);

  // ── Real-time candle updates ──────────────────────────

  // Primary: server-aggregated CandleUpdate events (OHLCV from candle aggregator).
  // No client-side throttle — the WS layer already batches at ~50ms; throttling
  // again here just adds latency without reducing render work (lightweight-charts
  // batches DOM writes internally and series.update is O(1)). The guard below
  // skips painting until history exists so a live WS candle can't render alone.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !liveCandle || !lastCandleRef.current) return;
    applyServerCandle(liveCandle, makeRtCtx(series));
  }, [liveCandle, makeRtCtx]);

  // Secondary: tick-based smoothing between server CandleUpdate pulses.
  // Server CandleUpdate is authoritative — when it arrives next it will
  // overwrite this tick-merged bar via series.update.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !tick) return;
    applyTick(tick, makeRtCtx(series));
  }, [tick, makeRtCtx]);

  // ── Line-cross price alerts (client-side, in-session) ──────────
  // Fire a toast + beep when the live mid price crosses an alert-enabled
  // horizontal line or trendline. Drawings are read from a ref so this runs
  // only on tick changes.
  const alertMidRef = useRef<number | null>(null);
  const alertFiredRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!tick) return;
    const mid = (tick.bid + tick.ask) / 2;
    const prev = alertMidRef.current;
    alertMidRef.current = mid;
    if (prev === null) return;
    const nowSec = Math.floor(tick.timestamp / 1000);
    const crossed = detectCrossings(drawingsRef.current, prev, mid, nowSec, alertFiredRef.current);
    for (const d of crossed) {
      toast.info(
        "Price alert",
        d.alertMessage ?? `${selectedSymbol} crossed your ${d.type} @ ${mid.toFixed(pipDigits)}`,
      );
      playAlertBeep();
    }
  }, [tick, selectedSymbol, pipDigits]);

  // ── Staleness watchdog ────────────────────────────────────────
  // Guards against the case where CandleUpdates stop arriving entirely
  // (data-provider disconnect, aggregator restart). Both the live-candle and
  // tick effects only run when their props change, so this interval is the
  // only recovery path when neither prop is updating.
  useEffect(() => {
    // Replay shows a historical slice — its last bar is hours or days old by
    // design, so the staleness check would fire a refetch loop. Skip it.
    if (isReplaying) return;
    const intervalSec = (timeframeMs(timeframe) || 60_000) / 1000;
    const id = setInterval(() => {
      if (!lastCandleRef.current) return;
      const staleSec = Date.now() / 1000 - fromChartTime(lastCandleRef.current.time as number);
      if (staleSec < intervalSec * 2) return;
      requestGapRefetch(lastGapRefetchAtRef, queryClient, selectedSymbol, timeframe);
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedSymbol, timeframe, queryClient, isReplaying]);

  // ── Chart plugin overlays ──────────────────────────────────
  // Re-runs when active plugins change or the chart is recreated (isDark /
  // symbol / timeframe), so primitives are always attached to the live series.
  const symbolCategory = symbolInfo?.category;
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const series = candleSeriesRef.current;
    detachPlugins(series, chartPluginsRef.current);
    chartPluginsRef.current = [];
    attachPlugins(
      series,
      activePlugins,
      { isDark, timeframe, symbolCategory },
      chartPluginsRef.current,
    );
  }, [activePlugins, isDark, selectedSymbol, timeframe, symbolCategory]);

  // ── Live bid/ask price tracking lines ──────────────────────
  // applyBidAskLines moves the existing price lines in-place (applyOptions) or
  // creates them — remove+create would force two full chart redraws per tick.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    applyBidAskLines(
      tick,
      { showBidLine: chartPrefs.showBidLine, showAskLine: chartPrefs.showAskLine },
      makeRtCtx(series),
    );
  }, [tick, chartPrefs.showBidLine, chartPrefs.showAskLine, makeRtCtx]);

  // ── Position/order overlays ────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const lines = priceLineRef.current;
    clearPriceLines(series, lines);
    priceLineRef.current = [];
    slTpLinesRef.current.clear();
    if (!chartPrefs.overlayPositionsOnChart) return;

    const opts: OverlayOpts = {
      symbol: selectedSymbol,
      colors,
      contractSize: symbolInfo?.contractSize || 100000,
    };
    for (const pos of positions) {
      addPositionOverlay(series, pos, opts, priceLineRef.current, slTpLinesRef.current);
    }
    for (const ord of orders) {
      addOrderOverlay(series, ord, selectedSymbol, colors.orderLine, priceLineRef.current);
    }
  }, [
    positions,
    orders,
    selectedSymbol,
    chartData,
    symbolInfo,
    colors,
    chartPrefs.overlayPositionsOnChart,
  ]);

  return (
    <div className="relative w-full h-full">
      {/* OHLCV Legend Overlay */}
      <ChartLegendHeader
        selectedSymbol={selectedSymbol}
        description={symbolInfo?.displayName}
        isReplaying={isReplaying}
        replayPrice={isReplaying ? chartData[chartData.length - 1]?.close : undefined}
        tradingConnected={tradingConnected}
        onMarketOrder={onMarketOrder}
        timeframe={timeframe}
        legend={legend}
        tick={tick}
        pipDigits={pipDigits}
        showOhlcLegend={chartPrefs.showOhlcLegend}
        availableWidth={legendWidth}
      />

      {/* Drag-to-edit tooltip */}
      {dragPrice && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          style={{ top: dragPrice.y - 32 }}
        >
          <div
            className={cn(
              "px-2 py-1 rounded text-[11px] font-mono font-bold shadow-lg border",
              dragPrice.field === "TP"
                ? "bg-[#089981]/20 text-[#089981] border-[#089981]/40"
                : "bg-[#f23645]/20 text-[#f23645] border-[#f23645]/40",
            )}
          >
            {dragPrice.field} → {dragPrice.price.toFixed(pipDigits)}
            <span
              className={dragPrice.pnlUsd >= 0 ? "ml-1.5 text-[#089981]" : "ml-1.5 text-[#f23645]"}
            >
              {dragPrice.pnlUsd >= 0 ? "+" : ""}${dragPrice.pnlUsd.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Selected-drawing floating toolbar / settings dialog */}
      <DrawingOverlays
        drawing={selectedDrawing}
        showSettings={showDrawingSettings}
        currentTf={timeframe}
        onUpdate={(d) => onUpdateDrawing?.(d)}
        onClone={handleCloneDrawing}
        onRemove={() => selectedDrawing && onRemoveDrawing?.(selectedDrawing.id)}
        onOpenSettings={() => setShowDrawingSettings(true)}
        onCloseSettings={() => setShowDrawingSettings(false)}
      />

      {contextMenu && selectedDrawing && (
        <DrawingContextMenu
          drawing={selectedDrawing}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onSettings={() => setShowDrawingSettings(true)}
          onDuplicate={handleCloneDrawing}
          onReorder={(dir) => handleReorderDrawing(selectedDrawing, dir)}
          onToggleLock={() =>
            onUpdateDrawing?.({ ...selectedDrawing, locked: !selectedDrawing.locked })
          }
          onToggleAlert={() =>
            onUpdateDrawing?.({ ...selectedDrawing, alertEnabled: !selectedDrawing.alertEnabled })
          }
          onRemove={() => onRemoveDrawing?.(selectedDrawing.id)}
        />
      )}

      {/* Object tree: toggle button + panel listing every drawing on the symbol */}

      {/* News overlay (popup, config dialog, button) */}
      <NewsOverlay
        newsConfig={newsConfig}
        setNewsConfig={setNewsConfig}
        showNewsConfigDialog={showNewsConfigDialog}
        setShowNewsConfigDialog={setShowNewsConfigDialog}
        newsPopup={newsPopup}
        setNewsPopup={setNewsPopup}
        isDark={isDark}
        pipDigits={pipDigits}
        containerRef={containerRef}
      />

      {/* Chart-wide right-click menu (TradingView-style) */}
      {chartMenu && (
        <ChartContextMenu
          x={chartMenu.x}
          y={chartMenu.y}
          price={chartMenu.price}
          pipDigits={pipDigits}
          symbol={selectedSymbol}
          tick={tick}
          drawingsCount={visibleDrawings.length}
          indicatorsCount={activeIndicators.length}
          onClose={() => setChartMenu(null)}
          onResetView={handleResetView}
          onCopyPrice={handleCopyPrice}
          onAddAlert={handleAddAlert}
          onQuickOrder={onQuickOrder}
          onOpenObjectTree={() => onOpenObjectTree?.()}
          onRemoveAllDrawings={onClearDrawings}
          onClearIndicators={onClearIndicators}
          onOpenSettings={() => setShowChartSettings(true)}
        />
      )}

      <ChartSettingsDialog
        open={showChartSettings}
        onClose={() => setShowChartSettings(false)}
        prefs={chartPrefs}
        isDark={isDark}
        activePlugins={activePlugins}
        onTogglePlugin={onTogglePlugin}
        onOpenNewsConfig={() => setShowNewsConfigDialog(true)}
        hasAccount={!!accountId}
      />

      {/* Chart container — cursor is managed imperatively by DrawingToolsManager */}
      <div ref={containerRef} className="w-full h-full" onContextMenu={handleChartContextMenu} />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => onImageChosen(e.target.files?.[0])}
      />

      {textEdit && drawings.find((d) => d.id === textEdit.id) && (
        <InlineTextEditor
          key={`${textEdit.id}:${textEdit.cell?.join(",") ?? ""}`}
          drawing={drawings.find((d) => d.id === textEdit.id)!}
          cell={textEdit.cell}
          onChange={(d) => onUpdateDrawing?.(d)}
          onRepaint={() => drawingManagerRef.current?.setDrawings(drawingsRef.current)}
          onClose={() => {
            const d = drawings.find((x) => x.id === textEdit.id);
            // A Comment left empty goes (TradingView's shouldBeRemovedOnDeselect).
            if (d?.type === "comment" && !(d.text ?? "").trim()) onRemoveDrawing?.(d.id);
            setTextEdit(null);
          }}
        />
      )}

      {replayPicking && pickX != null && <ReplayPickOverlay x={pickX} />}
    </div>
  );
}

// ── Local helper: Build chart data (candles + volume) ────────

type CandleRow = CandlestickData<Time> & { volume: number };

// Treat values below 1e12 as seconds, at/above as milliseconds.
function secOrMsToMs(v: number): number {
  return v < 1_000_000_000_000 ? v * 1000 : v;
}

// Normalise a raw candle's timestamp (seconds, ms, or ISO string) to unix seconds.
function candleTimeSec(c: Candle): number {
  let tMs = NaN;
  if (typeof c.time === "number" && c.time > 0) tMs = secOrMsToMs(c.time);
  else if (typeof c.timestamp === "number" && c.timestamp > 0) tMs = secOrMsToMs(c.timestamp);
  else if (typeof c.timestamp === "string") tMs = Date.parse(c.timestamp);
  return Number.isNaN(tMs) ? NaN : Math.floor(tMs / 1000);
}

function toCandleRow(c: Candle): CandleRow {
  return {
    time: toChartTime(candleTimeSec(c)) as Time,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume) || 0,
  };
}

// Keep the last row for each timestamp (input must be time-sorted ascending).
function dedupeByTime(sorted: CandleRow[]): CandleRow[] {
  const out: CandleRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    if (!next || (cur.time as number) !== (next.time as number)) out.push(cur);
  }
  return out;
}

function useChartData(candles: Candle[], colors: { volumeUp: string; volumeDown: string }, timeframe: Timeframe) {
  return useMemo(() => {
    // Intraday bars are drawn in the viewer's timezone (see chart-time.ts).
    setChartTimeShift(isIntraday(timeframe));
    const sorted = candles
      .map(toCandleRow)
      .filter((c) => !Number.isNaN(c.time as number) && (c.time as number) > 0)
      .sort((a, b) => (a.time as number) - (b.time as number));
    const deduped = dedupeByTime(sorted);

    const chartData: CandlestickData<Time>[] = deduped.map(({ volume: _v, ...rest }) => rest);
    const volumeData: HistogramData<Time>[] = deduped.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? colors.volumeUp : colors.volumeDown,
    }));

    return { chartData, volumeData };
  }, [candles, colors.volumeUp, colors.volumeDown, timeframe]);
}
