import type { IChartApi, ISeriesApi, Logical, SeriesType } from "lightweight-charts";
import type {
  CursorMode,
  DrawingLine,
  DrawingTool,
  DrawingType,
  MagnetMode,
} from "../../../pages/trading/constants";
import { DrawingsPrimitive } from "./drawings-primitive";
import { dist, type Pt, snapAngle } from "./geometry";
import { hitTest } from "./hit-test";
import { makeResolveCtx, type ResolveCtx, resolveEntry, timeToX, xToTime } from "./resolve";
import type { DataPoint, DrawingCallbacks, Hit, ResolvedEntry } from "./types";
import { uid } from "../../uid.ts";
import { ANNOTATION_TOOLS, type AnnotationToolType } from "./annotationtools";
import { pointToolSpec } from "./point-tools";
import { DemonstrationPrimitive } from "./demonstration";
import { MeasurePrimitive, type MeasurePoint } from "./measure";
import { regressionFit } from "./linetools";
import { volumeProfile } from "./measuretools";
import { firstPatternPrice, lastPatternPrice } from "./barspattern";
import { generateGhostBars, ghostSegmentSizes } from "./ghostfeed";
import { alignGannIndex, alignGannPrice } from "./gann";
import { DEFAULT_ICON_SIZE, iconSelection, onIconAssetLoaded } from "./icontools";

// The pane cursor for each cursor tool (TradingView's pane--cursor-* classes:
// dot and eraser are .cur images, demonstration and arrow the default arrow).
const svgCursor = (svg: string, x: number, y: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, default`;
const DOT_CURSOR = svgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><circle cx="4.5" cy="4.5" r="3" fill="#000" stroke="#fff"/></svg>',
  4,
  4,
);
const ERASER_CURSOR = svgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M2.5 13.5l8-8 6 6-6 6h-3z" fill="#fff" stroke="#000"/><path d="M6.5 9.5l6 6" stroke="#000"/></svg>',
  4,
  16,
);
const CURSOR_FOR_MODE: Record<CursorMode, string> = {
  cross: "crosshair",
  dot: DOT_CURSOR,
  arrow: "default",
  demonstration: "default",
};
import { controlPoints } from "./shapetools";
import { fromChartTime, toChartTime } from "../../chart-time.ts";
import { defaultLevelOffset, defaultWidthBars, POSITION_DEFAULTS } from "./position-math";

// Releasing the pointer farther than this from the first anchor commits the
// drawing in one press-drag-release gesture (otherwise we wait for a second
// click), mirroring TradingView's dual placement modes.
const DRAG_COMMIT_THRESHOLD_PX = 10;

// Magnet mode: snap an anchor's price to the nearest O/H/L/C of the bar under
// the cursor when within this many pixels (TradingView's "weak magnet").
const MAGNET_THRESHOLD_PX = 14;

// Object snapping: snap a placed/dragged anchor onto another drawing's anchor
// when the cursor is within this many pixels of it.
const SNAP_ANCHOR_PX = 8;

// Touch input gets fat-finger-friendly hit tolerances and a long-press menu.
const TOUCH_HIT_SCALE = 2;
const LONG_PRESS_MS = 500;
const LONG_PRESS_CANCEL_PX = 10;

// TradingView keyboard shortcuts, matched on physical key code: Alt+T/H/V/F,
// and Alt+Shift+R for the rectangle (plain Alt+R resets the chart there).
const TOOL_SHORTCUTS: Record<string, DrawingTool> = {
  KeyT: "trendline",
  KeyH: "horizontal",
  KeyV: "vertical",
  KeyF: "fibonacci",
  KeyJ: "horzray",
  KeyC: "crossline",
};
const SHIFT_TOOL_SHORTCUTS: Record<string, DrawingTool> = {
  KeyR: "rectangle",
};

interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

function asOhlc(bar: object): OhlcBar | null {
  const b = bar as Partial<OhlcBar>;
  const valid =
    typeof b.open === "number" &&
    typeof b.high === "number" &&
    typeof b.low === "number" &&
    typeof b.close === "number";
  return valid ? (b as OhlcBar) : null;
}

/** Minimal cross-input event surface shared by mouse and touch paths. */
interface TakeoverEvt {
  shiftKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function evtFromTouch(e: TouchEvent): TakeoverEvt {
  return {
    shiftKey: false,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
  };
}

/** Drop undefined-valued keys so a style default never overwrites with undefined. */
function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function isTextInputTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

interface GroupMember {
  origin: DrawingLine;
  entry: ResolvedEntry;
}

interface DragState {
  hit: Hit;
  startX: number;
  startY: number;
  origin: DrawingLine;
  originEntry: ResolvedEntry;
  /** Other selected drawings that move together on body drags. */
  group: GroupMember[];
  moved: boolean;
  isTouch: boolean;
}

interface PlacingState {
  p1: DataPoint;
  startX: number;
  startY: number;
}

export interface DrawingToolsManagerOptions {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  container: HTMLElement;
  /** Chart timeframe interval in seconds — used for whitespace extrapolation. */
  intervalSec: number;
  /** Current timeframe label, stamped on new drawings as createdTf. */
  timeframe: string;
  /** Account equity — drives the position tool's $-risk / size readout. */
  accountEquity?: number;
  callbacks: DrawingCallbacks;
}

/**
 * TradingView-style interaction layer for chart drawings.
 *
 * Placement: arm a tool, then click-move-click or press-drag-release with a
 * live preview. Editing: hover highlights, drag anchors or bodies (Shift =
 * 45° snap, magnet = OHLC snap), shift-click multi-selects and body drags
 * move the whole group, Delete removes the selection, Escape cancels. Touch
 * gets scaled hit targets, drag support, and long-press for settings.
 * Pointer-down events that land on a drawing are stopped in the capture
 * phase so the chart never pans underneath a drag.
 */
export class DrawingToolsManager {
  private readonly chart: IChartApi;
  private readonly series: ISeriesApi<SeriesType>;
  private readonly container: HTMLElement;
  private readonly cb: DrawingCallbacks;
  private readonly primitive: DrawingsPrimitive;
  // Mutable: the chart instance persists across timeframe changes (TradingView
  // behavior), so these are updated in place via updateTimeframe rather than
  // recreating the manager.
  private intervalSec: number;
  private timeframe: string;

  private tool: DrawingTool = "none";
  private cursorMode: CursorMode = "cross";
  private readonly demo = new DemonstrationPrimitive();
  private offIconAsset: () => void = () => undefined;
  private volumeSeries: ISeriesApi<SeriesType> | null = null;
  private drawings: DrawingLine[] = [];
  private placing: PlacingState | null = null;
  /** Brush stroke in progress: its points and the last pixel sampled. */
  private brush: { kind: "brush" | "highlighter"; pts: DataPoint[]; last: Pt } | null = null;
  /** Pattern / wave being placed click by click: the points fixed so far. */
  private multi: { tool: DrawingType; pts: DataPoint[] } | null = null;
  private drag: DragState | null = null;
  private selectedIds: string[] = [];
  private hoveredId: string | null = null;
  private magnetMode: MagnetMode = "none";
  private stayInMode = false;
  private longPress: { timer: number; id: string; startPos: Pt } | null = null;
  // Measure is the crosshair's, not a drawing: never committed, never in the object tree.
  private readonly measure = new MeasurePrimitive();
  private resetMeasureLater = false;
  /** The crosshair's own label colours while they are swapped for the measure's blue. */
  private crossLabelColors: { horz: string; vert: string } | null = null;
  // Copy/paste clipboard (deep copies of the drawings copied with Ctrl/Cmd+C).
  private clipboard: DrawingLine[] = [];
  // Per-type style defaults new drawings inherit (set via the settings dialog).
  private styleDefaults: Record<string, Partial<DrawingLine>> = {};

  constructor(opts: DrawingToolsManagerOptions) {
    this.chart = opts.chart;
    this.series = opts.series;
    this.container = opts.container;
    this.cb = opts.callbacks;
    this.intervalSec = opts.intervalSec;
    this.timeframe = opts.timeframe;
    this.primitive = new DrawingsPrimitive();
    this.primitive.setIntervalSec(opts.intervalSec);
    this.primitive.setAccountEquity(opts.accountEquity ?? 0);
    this.series.attachPrimitive(this.primitive);
    this.series.attachPrimitive(this.demo);
    this.series.attachPrimitive(this.measure);
    this.offIconAsset = onIconAssetLoaded(() => this.primitive.setDrawings(this.drawings));
    this.container.addEventListener("mouseleave", this.handleMouseLeave);
    this.container.addEventListener("mousedown", this.handleMouseDown, true);
    this.container.addEventListener("dblclick", this.handleDblClick);
    this.container.addEventListener("contextmenu", this.handleContextMenu);
    this.container.addEventListener("touchstart", this.handleTouchStart, {
      capture: true,
      passive: false,
    });
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("touchmove", this.handleTouchMove, { passive: false });
    window.addEventListener("touchend", this.handleTouchEnd);
    window.addEventListener("touchcancel", this.handleTouchEnd);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  destroy(): void {
    this.clearLongPress();
    this.container.removeEventListener("mousedown", this.handleMouseDown, true);
    this.container.removeEventListener("dblclick", this.handleDblClick);
    this.container.removeEventListener("contextmenu", this.handleContextMenu);
    this.container.removeEventListener("touchstart", this.handleTouchStart, true);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("touchmove", this.handleTouchMove);
    window.removeEventListener("touchend", this.handleTouchEnd);
    window.removeEventListener("touchcancel", this.handleTouchEnd);
    window.removeEventListener("keydown", this.handleKeyDown);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    this.offIconAsset();
    try {
      this.series.detachPrimitive(this.demo);
      this.series.detachPrimitive(this.measure);
      this.series.detachPrimitive(this.primitive);
    } catch {
      /* chart already removed */
    }
    this.container.style.cursor = "";
  }

  setTool(tool: DrawingTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.cancelPlacement();
    this.applyCursor(null);
  }

  /** The cursor tool the chart returns to between drawings. */
  setCursorMode(mode: CursorMode): void {
    this.cursorMode = mode;
    this.demo.setEnabled(mode === "demonstration");
    this.applyCursor(null);
  }

  setMagnetMode(mode: MagnetMode): void {
    this.magnetMode = mode;
  }

  /** The volume series, for the volume-based tools. */
  setVolumeSeries(series: ISeriesApi<SeriesType> | null): void {
    this.volumeSeries = series;
    this.measure.setVolumeSeries(series);
    this.primitive.setVolumeSeries(series);
  }

  setStyleDefaults(defaults: Record<string, Partial<DrawingLine>>): void {
    this.styleDefaults = defaults;
  }

  setStayInDrawingMode(enabled: boolean): void {
    this.stayInMode = enabled;
  }

  setAccountEquity(equity: number): void {
    this.primitive.setAccountEquity(equity);
  }

  /**
   * Re-point the manager at a new timeframe without recreating it. The chart
   * and drawing primitive stay alive (so drawings never blink out on a TF
   * switch); only the interval used for whitespace extrapolation and the
   * createdTf stamped on new drawings change.
   */
  updateTimeframe(timeframe: string, intervalSec: number): void {
    this.timeframe = timeframe;
    this.intervalSec = intervalSec;
    this.primitive.setIntervalSec(intervalSec);
  }

  /** External selection (e.g. object tree row click). Unknown ids are dropped. */
  setSelection(ids: string[]): void {
    this.select(ids.filter((id) => this.drawings.some((d) => d.id === id)));
  }

  setDrawings(drawings: DrawingLine[]): void {
    // Mid-drag the local copy is authoritative; the post-onUpdate sync will
    // deliver the final state once the drag ends.
    if (this.drag) return;
    this.drawings = drawings.map((d) => ({ ...d }));
    const pruned = this.selectedIds.filter((id) => this.drawings.some((d) => d.id === id));
    if (pruned.length !== this.selectedIds.length) this.select(pruned);
    this.primitive.setDrawings(this.drawings);
  }

  // ── Coordinate helpers ─────────────────────────────────────────────

  private ctx(): ResolveCtx {
    return makeResolveCtx(this.chart, this.series, this.intervalSec);
  }

  /** Pointer position relative to the chart pane, or null when outside it. */
  private posFromClient(clientX: number, clientY: number): Pt | null {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const timeScale = this.chart.timeScale();
    const paneWidth = timeScale.width();
    const paneHeight = rect.height - timeScale.height();
    if (paneWidth <= 0 || x < 0 || y < 0 || x > paneWidth || y > paneHeight) return null;
    return { x, y };
  }

  private eventPos(e: MouseEvent): Pt | null {
    return this.posFromClient(e.clientX, e.clientY);
  }

  private toPoint(p: Pt): DataPoint | null {
    const time = xToTime(this.ctx(), p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (time === null || price === null) return null;
    return { time, price };
  }

  private resolveAll(): ResolvedEntry[] {
    const ctx = this.ctx();
    // Hit tests see the selection state: some anchors exist only while selected.
    return this.drawings.map((d) =>
      resolveEntry(d, ctx, this.selectedIds.includes(d.id) ? "selected" : d.id === this.hoveredId ? "hovered" : "normal"),
    );
  }

  // Build a drawing, then merge the user's saved style default for its type.
  private makeNew(tool: DrawingTool, p1: DataPoint, p2: DataPoint): DrawingLine {
    const d = this.buildNew(tool, p1, p2);
    const def = this.styleDefaults[d.type];
    return def ? { ...d, ...definedOnly(def) } : d;
  }

  private buildNew(tool: DrawingTool, p1: DataPoint, p2: DataPoint): DrawingLine {
    if (tool === "long-position" || tool === "short-position") {
      return this.makePosition(tool === "long-position" ? "long" : "short", p1);
    }
    const base = {
      id: uid(),
      // TradingView's line tools start in its blue at 2px.
      color: "#2962ff",
      width: 2,
      createdTf: this.timeframe,
    };
    if (tool === "horizontal") return { ...base, type: "horizontal", price: p1.price };
    if (tool === "vertical") return { ...base, type: "vertical", price: p1.price, time: p1.time };
    const two = { ...base, price: p1.price, time: p1.time, price2: p2.price, time2: p2.time };
    if (tool === "ray") return { ...two, type: "trendline", extendRight: true };
    // TradingView's Info line: a trend line whose stats are always on.
    if (tool === "infoline") return { ...two, type: "trendline", showStats: true, alwaysShowStats: true };
    if (tool === "extended")
      return { ...two, type: "trendline", extendLeft: true, extendRight: true };
    if (tool === "channel") {
      // Offset line defaults parallel and mirrored below so it's visible/draggable.
      return { ...two, type: "channel", time3: p1.time, price3: 2 * p1.price - p2.price };
    }
    if (tool === "text") return { ...two, type: "text", text: "Text" };
    // Shapes start in TradingView's colours, filled at 20 %.
    const shapeColor: Partial<Record<DrawingTool, string>> = { rectangle: "#9c27b0", ellipse: "#f23645", triangle: "#089981" };
    const sc = shapeColor[tool];
    if (sc) return { ...two, type: tool as DrawingType, color: sc, fillOpacity: 0.2 };
    return { ...two, type: tool as DrawingType };
  }

  private makePoints(type: DrawingType, points: DataPoint[]): DrawingLine {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const d: DrawingLine = {
      id: "preview",
      type,
      width: 2,
      color: pointToolSpec(type)!.color,
      createdTf: this.timeframe,
      time: first.time,
      price: first.price,
      time2: last.time,
      price2: last.price,
      points: points.map((p) => ({ time: p.time, price: p.price })),
    };
    const def = this.styleDefaults[type];
    return { ...(def ? { ...d, ...definedOnly(def) } : d), id: uid() };
  }

  // TradingView's defaults: the brush in colorSkyBlue500 at 2px, the
  // highlighter in colorRipeRed500Alpha20 at 20px.
  private makeBrush(points: DataPoint[], kind: "brush" | "highlighter"): DrawingLine {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const d: DrawingLine = {
      id: uid(),
      type: kind,
      color: kind === "highlighter" ? "rgba(242, 54, 69, 0.2)" : "#00bcd4",
      width: kind === "highlighter" ? 20 : 2,
      createdTf: this.timeframe,
      time: first.time,
      price: first.price,
      time2: last.time,
      price2: last.price,
      points: points.map((p) => ({ time: p.time, price: p.price })),
    };
    const def = this.styleDefaults[kind];
    return def ? { ...d, ...definedOnly(def) } : d;
  }

  // Position tool, placed with one click like TradingView's: the entry is the
  // clicked price; stop and target sit 20 % of the visible bars' price range
  // away (whole ticks, so the ratio starts at 1) and the box spans
  // max(3, 15 % of the visible bars). See position-math.ts.
  private makePosition(side: "long" | "short", p1: DataPoint): DrawingLine {
    const tick = this.tickSize();
    const entry = Math.round(p1.price / tick) * tick;
    const { range, visibleBars } = this.visiblePriceRange(entry);
    const off = defaultLevelOffset(range, tick);
    const long = side === "long";
    return {
      id: uid(),
      type: "position",
      side,
      color: long ? "#089981" : "#f23645",
      createdTf: this.timeframe,
      price: entry,
      time: p1.time,
      time2: p1.time + defaultWidthBars(visibleBars) * this.intervalSec,
      targetPrice: long ? entry + off : entry - off,
      stopPrice: long ? entry - off : entry + off,
      accountSize: POSITION_DEFAULTS.accountSize,
      lotSize: POSITION_DEFAULTS.lotSize,
      riskPct: POSITION_DEFAULTS.riskPct,
      leverage: POSITION_DEFAULTS.leverage,
    };
  }

  private tickSize(): number {
    const format = this.series.options().priceFormat;
    return "minMove" in format && format.minMove ? format.minMove : 0.01;
  }

  /** High − low of the bars on screen, and how many bars fit the pane. */
  private visiblePriceRange(fallbackPrice: number): { range: number; visibleBars: number } {
    const ts = this.chart.timeScale();
    const logical = ts.getVisibleLogicalRange();
    const data = this.series.data();
    let lo = Infinity;
    let hi = -Infinity;
    if (logical) {
      const from = Math.max(0, Math.ceil(logical.from));
      const to = Math.min(data.length - 1, Math.floor(logical.to));
      for (let i = from; i <= to; i++) {
        const bar = asOhlc(data[i]!);
        if (!bar) continue;
        lo = Math.min(lo, bar.low);
        hi = Math.max(hi, bar.high);
      }
    }
    const range = hi > lo ? hi - lo : Math.abs(fallbackPrice) * 0.02;
    const visibleBars = logical ? logical.to - logical.from : 100;
    return { range, visibleBars };
  }

  // ── Mouse handlers ─────────────────────────────────────────────────

  private handleMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const pos = this.eventPos(e);
    if (!pos) return;
    // TradingView's pane mouse-down: a finished measure is cleared; Shift with
    // the cursor arms Measure; then start a measure, or finish the open one.
    if (this.measure.startPoint() && this.measure.endPoint()) this.clearMeasure();
    if (e.shiftKey && this.tool === "none") {
      const hit = hitTest(this.resolveAll(), pos);
      if (!hit || this.selectedIds.length === 0) {
        this.tool = "measure";
        this.applyCursor(null);
        this.cb.onSelectTool?.("measure");
        if (this.selectedIds.length) this.select([]);
      }
    }
    if (this.tool === "measure" && !this.measure.startPoint()) {
      const p = this.measurePointAt(pos);
      if (p) this.measure.startMeasuring(p);
      return; // the chart still scrolls on a drag
    }
    if (this.measure.startPoint() && !this.measure.endPoint()) {
      const p = this.measurePointAt(pos);
      if (p) this.measure.finishMeasure(p);
      this.resetMeasureLater = true;
      return;
    }
    // Demonstration: Alt + drag leaves a fading trail instead of panning.
    if (this.tool === "none" && this.cursorMode === "demonstration" && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      this.demo.start(pos);
      return;
    }
    // Eraser: a click on a drawing removes it; anywhere else the chart pans.
    if (this.tool === "eraser") {
      const hit = hitTest(this.resolveAll(), pos);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      this.hoverHit(null);
      this.select(this.selectedIds.filter((id) => id !== hit.id));
      this.cb.onRemove(hit.id);
      return;
    }
    if (this.tool !== "none") {
      this.placementStart(pos, e);
      return;
    }
    this.selectionStart(pos, e, false);
  };

  private handleMouseLeave = (): void => {
    this.demo.setOrigin(null);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    const pos = this.eventPos(e);
    this.resetMeasureIfRequired();
    if (pos && this.measure.startPoint() && !this.measure.endPoint()) this.measure.setCurrent(this.measurePointAt(pos));
    this.syncCrosshairLabels(pos);
    this.demo.setOrigin(pos);
    if (this.demo.isDrawing()) return;
    if (this.drag) {
      if (pos) this.dragMove(pos, e.shiftKey);
      return;
    }
    if (!pos) {
      this.hoverHit(null);
      return;
    }
    if (this.placing) {
      this.placingMove(pos, e.shiftKey);
      return;
    }
    if (this.tool === "none" || this.tool === "eraser") this.hoverHit(hitTest(this.resolveAll(), pos));
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.resetMeasureIfRequired();
    if (this.demo.isDrawing()) {
      this.demo.finish();
      return;
    }
    if (this.drag) {
      this.endDrag();
      return;
    }
    if (this.placing) this.maybeCommitPlacement(this.eventPos(e), e.shiftKey);
  };

  private handleDblClick = (e: MouseEvent): void => {
    // A double-click ends an open-ended tool (path, polyline, ghost feed);
    // its second click added a duplicate point, dropped here.
    if (this.multi) {
      e.preventDefault();
      e.stopPropagation();
      this.finishOpenEnded();
      return;
    }
    if (this.tool !== "none") return;
    const pos = this.eventPos(e);
    if (!pos) return;
    const hit = hitTest(this.resolveAll(), pos);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    this.select([hit.id]);
    const target = this.drawings.find((x) => x.id === hit.id);
    if (target && ANNOTATION_TOOLS[target.type as AnnotationToolType]?.editsText) {
      this.cb.onEditText?.(hit.id, target.type === "table" ? this.tableCellAt(target, pos) : undefined);
      return;
    }
    this.cb.onRequestSettings?.(hit.id);
  };

  private handleContextMenu = (e: MouseEvent): void => {
    // A right-click while measuring cancels it and goes back to the cursor.
    if (this.measure.startPoint()) {
      e.preventDefault();
      e.stopPropagation();
      this.clearMeasure();
      this.resetMeasureLater = false;
      if (this.tool === "measure") {
        this.tool = "none";
        this.applyCursor(null);
        this.cb.onToolFinished();
      }
      return;
    }
    const pos = this.eventPos(e);
    if (!pos) return;
    const hit = hitTest(this.resolveAll(), pos);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.selectedIds.includes(hit.id)) this.select([hit.id]);
    this.cb.onContextMenu?.(hit.id, e.clientX, e.clientY);
  };

  // ── Touch handlers ─────────────────────────────────────────────────

  private handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return; // pinch / two-finger → chart
    const t = e.touches[0]!;
    const pos = this.posFromClient(t.clientX, t.clientY);
    if (!pos) return;
    if (this.tool !== "none") {
      this.placementStart(pos, evtFromTouch(e));
      return;
    }
    const hit = this.selectionStart(pos, evtFromTouch(e), true);
    if (hit) this.startLongPress(hit.id, pos);
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const pos = this.posFromClient(t.clientX, t.clientY);
    this.cancelLongPressIfMoved(pos);
    if (this.drag) {
      e.preventDefault(); // keep the page/chart from scrolling mid-drag
      if (pos) this.dragMove(pos, false);
      return;
    }
    if (this.placing && pos) this.placingMove(pos, false);
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    this.clearLongPress();
    if (this.drag) {
      this.endDrag();
      return;
    }
    if (!this.placing) return;
    const t = e.changedTouches[0];
    this.maybeCommitPlacement(t ? this.posFromClient(t.clientX, t.clientY) : null, false);
  };

  private startLongPress(id: string, pos: Pt): void {
    this.clearLongPress();
    const timer = window.setTimeout(() => {
      this.longPress = null;
      this.drag = null; // long-press opens settings instead of dragging
      this.applyCursor(null);
      this.cb.onRequestSettings?.(id);
    }, LONG_PRESS_MS);
    this.longPress = { timer, id, startPos: pos };
  }

  private cancelLongPressIfMoved(pos: Pt | null): void {
    if (!this.longPress) return;
    if (!pos || dist(pos, this.longPress.startPos) > LONG_PRESS_CANCEL_PX) this.clearLongPress();
  }

  private clearLongPress(): void {
    if (!this.longPress) return;
    window.clearTimeout(this.longPress.timer);
    this.longPress = null;
  }

  // ── Keyboard ───────────────────────────────────────────────────────

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (isTextInputTarget(e.target)) return;
    if (this.handleHistoryShortcut(e) || this.handleToolShortcut(e)) return;
    if (this.handleClipboardShortcut(e) || this.handleArrowNudge(e)) return;
    if (e.key === "Escape") {
      this.handleEscape();
      return;
    }
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      this.selectedIds.length > 0 &&
      !this.drag
    ) {
      e.preventDefault();
      this.removeSelected();
    }
  };

  /** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo. */
  private handleHistoryShortcut(e: KeyboardEvent): boolean {
    if (!e.ctrlKey && !e.metaKey) return false;
    if (e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) this.cb.onRedo?.();
      else this.cb.onUndo?.();
      return true;
    }
    if (e.code === "KeyY") {
      e.preventDefault();
      this.cb.onRedo?.();
      return true;
    }
    return false;
  }

  /** Alt+T/H/V/F and Alt+Shift+R arm the matching drawing tool. */
  private handleToolShortcut(e: KeyboardEvent): boolean {
    if (!e.altKey || e.ctrlKey || e.metaKey) return false;
    const tool = (e.shiftKey ? SHIFT_TOOL_SHORTCUTS : TOOL_SHORTCUTS)[e.code];
    if (!tool) return false;
    e.preventDefault();
    this.cb.onSelectTool?.(tool);
    return true;
  }

  /** Ctrl/Cmd+C copy, +V paste, +D duplicate the current selection. */
  private handleClipboardShortcut(e: KeyboardEvent): boolean {
    if (!e.ctrlKey && !e.metaKey) return false;
    if (e.code === "KeyC") {
      this.copySelected();
      return true;
    }
    if (e.code === "KeyV") {
      e.preventDefault();
      this.pasteClipboard();
      return true;
    }
    if (e.code === "KeyD") {
      e.preventDefault();
      this.copySelected();
      this.pasteClipboard();
      return true;
    }
    return false;
  }

  /** Arrow keys nudge the selection 1px (10px with Shift). */
  private handleArrowNudge(e: KeyboardEvent): boolean {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = deltas[e.key];
    if (!d || this.selectedIds.length === 0) return false;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    this.nudgeSelected(d[0] * step, d[1] * step);
    return true;
  }

  private copySelected(): void {
    this.clipboard = this.drawings
      .filter((d) => this.selectedIds.includes(d.id))
      .map((d) => ({ ...d }));
  }

  private pasteClipboard(): void {
    if (this.clipboard.length === 0) return;
    const dt = this.intervalSec * 3; // paste a few bars to the right
    const created = this.clipboard.map((d) => this.offsetCopy(d, dt));
    this.drawings = [...this.drawings, ...created];
    this.primitive.setDrawings(this.drawings);
    for (const d of created) this.cb.onAdd({ ...d });
    this.select(created.map((c) => c.id));
  }

  private offsetCopy(d: DrawingLine, dt: number): DrawingLine {
    return {
      ...d,
      id: uid(),
      time: d.time != null ? d.time + dt : undefined,
      time2: d.time2 != null ? d.time2 + dt : undefined,
      time3: d.time3 != null ? d.time3 + dt : undefined,
      points: d.points?.map((p) => ({ ...p, time: p.time + dt })),
    };
  }

  private nudgeSelected(dx: number, dy: number): void {
    const entries = this.resolveAll();
    const updates: DrawingLine[] = [];
    for (const id of this.selectedIds) {
      const origin = this.drawings.find((d) => d.id === id);
      const entry = entries.find((en) => en.d.id === id);
      if (!origin || !entry || origin.locked) continue;
      const u = this.shiftDrawing(origin, entry, dx, dy);
      if (u) updates.push(u);
    }
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u]));
    this.drawings = this.drawings.map((d) => byId.get(d.id) ?? d);
    this.primitive.setDrawings(this.drawings);
    for (const u of updates) this.cb.onUpdate({ ...u });
  }

  private handleEscape(): void {
    this.clearMeasure();
    if (this.multi && pointToolSpec(this.multi.tool)?.points === 0 && this.multi.pts.length >= 2) {
      this.finishOpenEnded();
      return;
    }
    if (this.tool !== "none") {
      this.tool = "none";
      this.cancelPlacement();
      this.applyCursor(null);
      this.cb.onToolFinished();
      return;
    }
    this.select([]);
  }

  // ── Placement ──────────────────────────────────────────────────────

  private placementStart(pos: Pt, e: TakeoverEvt): void {
    const pt = this.pointFor(pos, e.shiftKey, this.placementAnchorPx());
    if (!pt) return;
    // Take the event over so the chart doesn't pan while drawing.
    e.preventDefault();
    e.stopPropagation();
    // Brush: press, drag the stroke, release (TradingView's freehand tool).
    if (this.tool === "brush" || this.tool === "highlighter") {
      const raw = this.toPoint(pos);
      if (!raw) return;
      this.brush = { kind: this.tool, pts: [raw], last: pos };
      this.placing = { p1: raw, startX: pos.x, startY: pos.y };
      return;
    }
    // Patterns and waves: a click per point, the next one following the
    // cursor, done on the last (TradingView's pointsCount()).
    if (pointToolSpec(this.tool)) {
      if (!this.multi) {
        this.multi = { tool: this.tool as DrawingType, pts: [pt] };
        this.placing = { p1: pt, startX: pos.x, startY: pos.y };
      } else {
        this.multi.pts.push(this.shiftAligned(this.multi.tool, pt, this.multi.pts[0]!, e.shiftKey));
      }
      const { tool, pts } = this.multi;
      const need = pointToolSpec(tool)!.points;
      if (need > 0 && pts.length >= need) {
        this.multi = null;
        this.commitDrawing(this.makePoints(tool, [...pts, ...this.curveControls(tool, pts)]));
        return;
      }
      this.primitive.setPreview(this.makePoints(tool, [...pts, pt]));
      return;
    }
    // One-click tools: lines through a point, text, and TradingView's position tools.
    if (
      this.tool === "horizontal" ||
      this.tool === "vertical" ||
      this.tool === "text" ||
      this.tool === "long-position" ||
      this.tool === "short-position"
    ) {
      this.commitDrawing(this.makeNew(this.tool, pt, pt));
      return;
    }
    if (this.placing) {
      this.commitPlacement(this.placing.p1, pt);
      return;
    }
    this.placing = { p1: pt, startX: pos.x, startY: pos.y };
    this.primitive.setPreview(this.makeNew(this.tool, pt, pt));
  }

  // Branches the measure tool (a throwaway readout) away from the persist path.
  private commitPlacement(p1: DataPoint, p2: DataPoint): void {
    this.commitDrawing(this.makeNew(this.tool, p1, p2));
  }

  private clearMeasure(): void {
    this.measure.clearMeasure();
    this.syncCrosshairLabels(null);
  }

  /** The crosshair's point for measuring: its bar index, its price (magnet-aligned). */
  private measurePointAt(pos: Pt): MeasurePoint | null {
    const logical = this.chart.timeScale().coordinateToLogical(pos.x);
    const price = this.series.coordinateToPrice(pos.y);
    if (logical === null || price === null) return null;
    const index = Math.round(logical);
    if (this.magnetMode === "none") return { index, price };
    const time = this.measure.timeAt(index);
    const snapped = time === null ? null : this.magnetSnap({ time, price }, pos.y);
    return { index, price: snapped?.price ?? price };
  }

  /**
   * The measure's end labels are drawn over the crosshair's: while the
   * crosshair sits on the end (always, until it is fixed) its axis labels
   * show in the measure's blue.
   */
  private syncCrosshairLabels(pos: Pt | null): void {
    const end = this.measure.endPoint();
    const start = this.measure.startPoint();
    let onEnd = false;
    if (start && pos) {
      if (!end) onEnd = true;
      else {
        const y = this.series.priceToCoordinate(end.price);
        const x = this.chart.timeScale().logicalToCoordinate(end.index as Logical);
        const here = this.measurePointAt(pos);
        onEnd = y !== null && x !== null && here !== null && here.index === end.index && Math.abs(pos.y - y) < 1;
      }
    }
    if (onEnd === (this.crossLabelColors !== null)) return;
    const cross = this.chart.options().crosshair;
    if (onEnd) {
      this.crossLabelColors = { horz: cross.horzLine.labelBackgroundColor, vert: cross.vertLine.labelBackgroundColor };
      this.chart.applyOptions({ crosshair: { horzLine: { labelBackgroundColor: "#2962ff" }, vertLine: { labelBackgroundColor: "#2962ff" } } });
    } else if (this.crossLabelColors) {
      const { horz, vert } = this.crossLabelColors;
      this.crossLabelColors = null;
      this.chart.applyOptions({ crosshair: { horzLine: { labelBackgroundColor: horz }, vertLine: { labelBackgroundColor: vert } } });
    }
  }

  /** After a measure is finished the tool goes back to the cursor on the next move or click. */
  private resetMeasureIfRequired(): void {
    if (!this.resetMeasureLater) return;
    this.resetMeasureLater = false;
    if (this.tool === "measure") {
      this.tool = "none";
      this.applyCursor(null);
      this.cb.onToolFinished();
    }
  }

  private placingMove(pos: Pt, shiftKey: boolean): void {
    if (this.multi) {
      const raw = this.pointFor(pos, shiftKey, null);
      const pt = raw && this.shiftAligned(this.multi.tool, raw, this.multi.pts[0]!, shiftKey);
      if (pt) {
        // Curves preview with their middle point(s) already placed (setLastPoint).
        const placed = [...this.multi.pts, pt];
        this.primitive.setPreview(this.makePoints(this.multi.tool, [...placed, ...this.curveControls(this.multi.tool, placed)]));
      }
      return;
    }
    if (this.brush) {
      // Sample every 2px of travel.
      if (dist(pos, this.brush.last) < 2) return;
      const raw = this.toPoint(pos);
      if (!raw) return;
      this.brush.pts.push(raw);
      this.brush.last = pos;
      this.primitive.setPreview(this.makeBrush(this.brush.pts, this.brush.kind));
      return;
    }
    const pt = this.pointFor(pos, shiftKey, this.placementAnchorPx());
    if (!pt || !this.placing) return;
    this.primitive.setPreview(this.makeNew(this.tool, this.placing.p1, pt));
  }

  private maybeCommitPlacement(pos: Pt | null, shiftKey: boolean): void {
    if (this.multi) return; // placed by clicks, not drags
    if (this.brush) {
      const { pts, kind } = this.brush;
      this.brush = null;
      if (pts.length >= 2) this.commitDrawing(this.makeBrush(pts, kind));
      else this.cancelPlacement();
      return;
    }
    const placing = this.placing!;
    if (!pos || dist(pos, { x: placing.startX, y: placing.startY }) < DRAG_COMMIT_THRESHOLD_PX) {
      return;
    }
    const pt = this.pointFor(pos, shiftKey, this.placementAnchorPx());
    if (pt) this.commitPlacement(placing.p1, pt);
  }

  private commitDrawing(raw: DrawingLine): void {
    let d = raw.type === "signpost" ? this.withSignpostPosition(raw) : raw;
    if (d.type === "trendangle") d = this.withScreenAngle(d);
    if (d.type === "regression") d = this.withRegressionAnchors(d);
    if (d.type === "frvp" || d.type === "avp") d = this.withProfileAnchors(d);
    if (d.type === "anchoredvwap") d = this.withVwapAnchor(d);
    if (d.type === "barspattern" && !d.pattern) d = this.withBarsPattern(d);
    if (d.type === "ghostfeed" && !d.ghostBars) d = this.withGhostBars(d);
    if (d.type === "gannsquare" && d.scaleRatio === undefined) d = { ...d, scaleRatio: this.chartScaleRatio() ?? undefined };
    if (d.type === "icon" && d.icon === undefined) d = { ...d, icon: iconSelection.icon, iconSize: DEFAULT_ICON_SIZE, angle: Math.PI / 2 };
    if (d.type === "emoji" && d.emoji === undefined) d = { ...d, emoji: iconSelection.emoji, iconSize: DEFAULT_ICON_SIZE, angle: Math.PI / 2 };
    this.placing = null;
    this.primitive.setPreview(null);
    this.drawings = [...this.drawings, d];
    this.primitive.setDrawings(this.drawings);
    this.cb.onAdd({ ...d });
    if (d.type === "image" && !d.imageUrl) this.cb.onPickImage?.(d.id);
    // TradingView opens its text editor as soon as a text tool lands.
    if (ANNOTATION_TOOLS[d.type as AnnotationToolType]?.editsText) {
      this.select([d.id]);
      this.cb.onEditText?.(d.id, d.type === "table" ? [0, 0] : undefined);
    }
    if (this.stayInMode && this.tool !== "none") return; // keep tool armed
    this.select([d.id]);
    this.tool = "none";
    this.applyCursor(null);
    this.cb.onToolFinished();
  }

  /** Ghost feed: generate its bars, the average high−low being the chart's mean bar range (in ticks). */
  private withGhostBars(d: DrawingLine): DrawingLine {
    const idx = (d.points ?? []).map((p) => this.barIndex(p.time));
    if (idx.some((i) => i === null)) return d;
    const tick = this.tickSize();
    const ranges = this.series
      .data()
      .map((b) => asOhlc(b))
      .filter((b): b is OhlcBar => b !== null)
      .map((b) => b.high - b.low);
    const mean = ranges.length ? ranges.reduce((s, r) => s + r, 0) / ranges.length : tick;
    const averageHL = d.averageHL ?? Math.round(mean / tick);
    const variance = d.variance ?? 50;
    return { ...d, averageHL, variance, ghostBars: generateGhostBars(ghostSegmentSizes(idx as number[]), averageHL * tick, variance) };
  }

  /**
   * Bars pattern (addPoint / _preparePoint): copy the bars between the points,
   * put the first point on the first bar's high (close outside Bars mode)
   * raised 5% of the pane, and the second where the copy ends at 1:1.
   */
  private withBarsPattern(d: DrawingLine): DrawingLine {
    const [p, q] = d.points ?? [];
    if (!p || !q) return d;
    const from = toChartTime(Math.min(p.time, q.time));
    const to = toChartTime(Math.max(p.time, q.time));
    const bars = this.series
      .data()
      .filter((b) => (b.time as number) >= from && (b.time as number) <= to)
      .map((b) => ({ time: fromChartTime(b.time as number), bar: asOhlc(b) }))
      .filter((x): x is { time: number; bar: OhlcBar } => x.bar !== null);
    if (bars.length === 0) return d;
    const pattern = bars.map(({ bar }) => [bar.open, bar.high, bar.low, bar.close] as [number, number, number, number]);
    const mode = d.barsMode ?? "bars";
    const anchor = mode === "bars" ? bars[0]!.bar.high : bars[0]!.bar.close;
    const ya = this.series.priceToCoordinate(anchor);
    const lifted = ya === null ? null : this.series.coordinateToPrice(ya - 0.05 * this.chart.paneSize().height);
    const p0 = { time: bars[0]!.time, price: lifted ?? anchor };
    const diff = lastPatternPrice(pattern, mode, false) - firstPatternPrice(pattern, mode, false);
    const p1 = { time: bars[bars.length - 1]!.time, price: p0.price + diff };
    return { ...d, pattern, points: [p0, p1], time: p0.time, price: p0.price, time2: p1.time, price2: p1.price };
  }

  /**
   * Volume profiles: a fixed range's anchors sit on the range's high (first)
   * and low (second); an anchored profile's on its POC.
   */
  private withProfileAnchors(d: DrawingLine): DrawingLine {
    const [p, q] = d.points ?? [];
    if (!p) return d;
    const all = this.series.data().map((b) => ({ time: fromChartTime(b.time as number), bar: asOhlc(b), volume: (b as { volume?: number }).volume }));
    const end = d.type === "frvp" ? q?.time ?? p.time : all[all.length - 1]?.time ?? p.time;
    const from = Math.min(p.time, end);
    const to = Math.max(p.time, end);
    const volumes = new Map((this.volumeSeries?.data() ?? []).map((v) => [fromChartTime(v.time as number), (v as { value?: number }).value ?? 0]));
    const range = all.filter((x) => x.time >= from && x.time <= to && x.bar).map((x) => ({ ...x.bar!, volume: volumes.get(x.time) ?? x.volume ?? 0 }));
    const vp = volumeProfile(range);
    if (!vp) return d;
    if (d.type === "avp") return { ...d, points: [{ time: p.time, price: vp.pocPrice }], price: vp.pocPrice };
    if (!q) return d;
    const pts = [
      { time: p.time, price: vp.hi },
      { time: q.time, price: vp.lo },
    ];
    return { ...d, points: pts, price: vp.hi, price2: vp.lo };
  }

  /** Anchored VWAP: the anchor sits on the VWAP's first value (the anchor bar's hlc3). */
  private withVwapAnchor(d: DrawingLine): DrawingLine {
    const p = d.points?.[0];
    if (!p) return d;
    const time = toChartTime(p.time);
    const bar = this.series.data().find((b) => (b.time as number) >= time);
    const ohlc = bar ? asOhlc(bar) : null;
    if (!ohlc) return d;
    const price = (ohlc.high + ohlc.low + ohlc.close) / 3;
    return { ...d, points: [{ time: fromChartTime(bar!.time as number), price }], time: fromChartTime(bar!.time as number), price };
  }

  /** Regression trend (_updateAnchorsPrice): its anchors sit on the base line's ends. */
  private withRegressionAnchors(d: DrawingLine): DrawingLine {
    const [p, q] = d.points ?? [];
    if (!p || !q) return d;
    const bars = this.series.data().map((b) => ({ time: fromChartTime(b.time as number), close: asOhlc(b)?.close ?? NaN })).filter((b) => !Number.isNaN(b.close));
    const fit = regressionFit(bars, p.time, q.time);
    if (!fit) return d;
    const first = p.time <= q.time;
    const pts = [
      { time: p.time, price: first ? fit.start : fit.end },
      { time: q.time, price: first ? fit.end : fit.start },
    ];
    return { ...d, points: pts, price: pts[0]!.price, price2: pts[1]!.price };
  }

  /** Trend angle (_calculateAngle): the angle and length between its points on screen. */
  private withScreenAngle(d: DrawingLine): DrawingLine {
    const [p, q] = d.points ?? [];
    if (!p || !q) return d;
    const ctx = this.ctx();
    const x0 = timeToX(ctx, p.time);
    const y0 = this.series.priceToCoordinate(p.price);
    const x1 = timeToX(ctx, q.time);
    const y1 = this.series.priceToCoordinate(q.price);
    if (x0 === null || y0 === null || x1 === null || y1 === null) return d;
    const distance = Math.hypot(x1 - x0, y1 - y0);
    if (distance <= 0) return { ...d, angle: 0, distance: 0 };
    let angle = Math.acos((x1 - x0) / distance);
    if (y1 - y0 > 0) angle = -angle;
    return { ...d, angle, distance };
  }

  /** A time's bar index (logical, rounded). */
  private barIndex(time: number): number | null {
    const x = timeToX(this.ctx(), time);
    const l = x === null ? null : this.chart.timeScale().coordinateToLogical(x);
    return l === null ? null : Math.round(l);
  }

  /** Price per bar that keeps a box square on screen (TradingView's scaleRatio). */
  private chartScaleRatio(): number | null {
    const a = this.series.coordinateToPrice(0);
    const b = this.series.coordinateToPrice(100);
    if (a === null || b === null || a === b) return null;
    return this.chart.timeScale().options().barSpacing * (Math.abs(a - b) / 100);
  }

  /**
   * Gann square (_correctPoint): the moved point's price follows the box's
   * price-per-bar ratio from the other point, on the side the pointer is.
   */
  private gannRatioPoint(pt: DataPoint, other: DataPoint, ratio: number, moving: 0 | 1): DataPoint {
    const i = this.barIndex(pt.time);
    const j = this.barIndex(other.time);
    if (i === null || j === null) return pt;
    const di = moving === 1 ? i - j : j - i;
    const up = pt.price - other.price > 0;
    const right = i - j > 0;
    let sign = (up && !right) || (!up && right) ? -1 : 1;
    if (moving === 0) sign = -sign;
    return { time: pt.time, price: other.price + sign * di * ratio };
  }

  /** Shift on a Gann box snaps to Gann increments from the other point. */
  private shiftAligned(tool: DrawingType, pt: DataPoint, other: DataPoint, shiftKey: boolean): DataPoint {
    if (tool === "gannsquare") {
      // Placing a Gann square: the second point keeps the chart's current ratio.
      const ratio = this.chartScaleRatio();
      return ratio === null ? pt : this.gannRatioPoint(pt, other, ratio, 1);
    }
    if (!shiftKey || tool !== "gannbox") return pt;
    const ts = this.chart.timeScale();
    const ctx = this.ctx();
    const xa = timeToX(ctx, pt.time);
    const xb = timeToX(ctx, other.time);
    const la = xa === null ? null : ts.coordinateToLogical(xa);
    const lb = xb === null ? null : ts.coordinateToLogical(xb);
    let time = pt.time;
    if (la !== null && lb !== null) {
      const x = ts.logicalToCoordinate(alignGannIndex(Math.round(la), Math.round(lb)) as Logical);
      const t = x === null ? null : xToTime(ctx, x);
      if (t !== null) time = t;
    }
    return { time, price: alignGannPrice(pt.price, other.price) };
  }

  /** The table cell under a pane point (120px columns, rows of 14 × 1.3 + 16). */
  private tableCellAt(d: DrawingLine, pos: Pt): [number, number] {
    const p = d.points?.[0];
    const x0 = p ? timeToX(this.ctx(), p.time) : null;
    const y0 = p ? this.series.priceToCoordinate(p.price) : null;
    if (x0 === null || y0 === null) return [0, 0];
    const rowH = Math.ceil((d.fontSize ?? 14) * 1.3) + 16;
    const cells = d.cells ?? [["", "", ""], ["", "", ""], ["", "", ""]];
    const r = Math.min(cells.length - 1, Math.max(0, Math.floor((pos.y - y0) / rowH)));
    const c = Math.min((cells[0]?.length ?? 3) - 1, Math.max(0, Math.floor((pos.x - x0) / 120)));
    return [r, c];
  }

  /** A signpost keeps where it was clicked as a percentage between its bar and the pane edge. */
  private withSignpostPosition(d: DrawingLine): DrawingLine {
    const p = d.points?.[0];
    if (!p) return d;
    const bar = this.candleAt(p.time);
    const y = this.series.priceToCoordinate(p.price);
    if (!bar || y === null) return { ...d, signpostPos: 50 };
    const yHigh = this.series.priceToCoordinate(bar.high);
    const yLow = this.series.priceToCoordinate(bar.low);
    const H = this.chart.paneSize().height;
    if (yHigh !== null && y <= yHigh) return { ...d, signpostPos: yHigh > 0 ? ((yHigh - y) / yHigh) * 100 : 0 };
    if (yLow !== null && y >= yLow) return { ...d, signpostPos: H > yLow ? -((y - yLow) / (H - yLow)) * 100 : 0 };
    return { ...d, signpostPos: 0 };
  }

  /** Curves get their control points as real anchors once both ends are placed. */
  private curveControls(tool: string, pts: DataPoint[]): DataPoint[] {
    if (pts.length < 2) return [];
    const ctx = makeResolveCtx(this.chart, this.series, this.intervalSec);
    const px = (p: DataPoint) => {
      const x = timeToX(ctx, p.time);
      const y = this.series.priceToCoordinate(p.price);
      return x === null || y === null ? null : { x, y };
    };
    const a = px(pts[0]!);
    const b = px(pts[1]!);
    if (!a || !b) return [];
    return controlPoints(tool, a, b)
      .map((c) => this.toPoint(c))
      .filter((c): c is DataPoint => c !== null);
  }

  private finishOpenEnded(): void {
    const multi = this.multi!;
    const pts = multi.pts.filter((p, i) => i === 0 || p.time !== multi.pts[i - 1]!.time || p.price !== multi.pts[i - 1]!.price);
    this.multi = null;
    if (pts.length >= 2) this.commitDrawing(this.makePoints(multi.tool, pts));
    else this.cancelPlacement();
  }

  private cancelPlacement(): void {
    this.placing = null;
    this.brush = null;
    this.multi = null;
    this.primitive.setPreview(null);
  }

  // ── Selection & dragging ───────────────────────────────────────────

  private selectionStart(pos: Pt, e: TakeoverEvt, isTouch: boolean): Hit | null {
    const entries = this.resolveAll();
    const hit = hitTest(entries, pos, isTouch ? TOUCH_HIT_SCALE : 1);
    if (!hit) {
      if (!e.shiftKey) this.select([]);
      return null;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      this.toggleSelection(hit.id);
      return hit;
    }
    if (!this.selectedIds.includes(hit.id)) this.select([hit.id]);
    this.beginDrag(hit, pos, entries, isTouch);
    return hit;
  }

  private toggleSelection(id: string): void {
    const next = this.selectedIds.includes(id)
      ? this.selectedIds.filter((x) => x !== id)
      : [...this.selectedIds, id];
    this.select(next);
  }

  private beginDrag(hit: Hit, pos: Pt, entries: ResolvedEntry[], isTouch: boolean): void {
    const origin = this.drawings.find((d) => d.id === hit.id);
    const originEntry = entries.find((en) => en.d.id === hit.id);
    // Locked drawings are selectable (so they can be unlocked) but never drag.
    if (!origin || !originEntry || origin.locked) return;
    const group = hit.region.kind === "body" ? this.groupFor(hit.id, entries) : [];
    this.drag = {
      hit,
      startX: pos.x,
      startY: pos.y,
      origin: { ...origin },
      originEntry,
      group,
      moved: false,
      isTouch,
    };
    this.applyCursor("grabbing");
  }

  /** Other selected, unlocked drawings that ride along on a body drag. */
  private groupFor(primaryId: string, entries: ResolvedEntry[]): GroupMember[] {
    if (this.selectedIds.length < 2 || !this.selectedIds.includes(primaryId)) return [];
    const out: GroupMember[] = [];
    for (const id of this.selectedIds) {
      if (id === primaryId) continue;
      const origin = this.drawings.find((d) => d.id === id);
      const entry = entries.find((en) => en.d.id === id);
      if (origin && entry && !origin.locked) out.push({ origin: { ...origin }, entry });
    }
    return out;
  }

  private dragMove(pos: Pt, shiftKey: boolean): void {
    const drag = this.drag!;
    const updates = this.computeDragUpdates(drag, pos, shiftKey);
    if (updates.length === 0) return;
    drag.moved = true;
    const byId = new Map(updates.map((u) => [u.id, u]));
    this.drawings = this.drawings.map((d) => byId.get(d.id) ?? d);
    this.primitive.setDrawings(this.drawings);
  }

  private computeDragUpdates(drag: DragState, pos: Pt, shiftKey: boolean): DrawingLine[] {
    if (drag.hit.region.kind !== "body") {
      const u = this.dragPoint(drag, pos, shiftKey);
      return u ? [u] : [];
    }
    const dx = pos.x - drag.startX;
    const dy = pos.y - drag.startY;
    const updates: DrawingLine[] = [];
    const primary = this.shiftDrawing(drag.origin, drag.originEntry, dx, dy);
    if (!primary) return [];
    updates.push(primary);
    for (const g of drag.group) {
      const u = this.shiftDrawing(g.origin, g.entry, dx, dy);
      if (u) updates.push(u);
    }
    return updates;
  }

  private dragPoint(drag: DragState, pos: Pt, shiftKey: boolean): DrawingLine | null {
    const region = drag.hit.region;
    if (region.kind === "imageCorner") {
      // LineToolImage.setPoint: the opposite corner stays; the size follows the
      // pointer, keeping the picture's natural aspect.
      const o = drag.origin;
      const c = drag.originEntry.pts?.[0];
      if (!c || !o.cssWidth || !o.cssHeight) return null;
      const nw = o.naturalWidth ?? o.cssWidth;
      const nh = o.naturalHeight ?? o.cssHeight;
      const sx = region.index % 2 === 0 ? -1 : 1;
      const sy = region.index < 2 ? -1 : 1;
      const fixed = { x: c.x - (sx * o.cssWidth) / 2, y: c.y - (sy * o.cssHeight) / 2 };
      const k = Math.max(Math.abs(fixed.x - pos.x) / nw, Math.abs(fixed.y - pos.y) / nh);
      const cssWidth = Math.round(nw * k);
      const cssHeight = Math.round(nh * k);
      if (cssWidth < 1 || cssHeight < 1) return null;
      const centre = this.toPoint({ x: fixed.x + (sx * cssWidth) / 2, y: fixed.y + (sy * cssHeight) / 2 });
      if (!centre) return null;
      return { ...o, cssWidth, cssHeight, points: [centre], time: centre.time, price: centre.price };
    }
    if (region.kind === "iconCorner" || region.kind === "iconRotate") {
      // TradingView's LineToolSvgIconBase.setPoint, in pane pixels.
      const c = drag.originEntry.pts?.[0];
      if (!c) return null;
      const start = { x: drag.startX, y: drag.startY };
      const angle0 = drag.origin.angle ?? Math.PI / 2;
      if (region.kind === "iconRotate") {
        const turn = Math.atan2(pos.y - c.y, pos.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x);
        return { ...drag.origin, angle: angle0 + turn };
      }
      const len0 = Math.hypot(start.x - c.x, start.y - c.y) || 1;
      const size0 = drag.origin.iconSize ?? DEFAULT_ICON_SIZE;
      const iconSize = Math.max(20, (size0 * Math.hypot(pos.x - c.x, pos.y - c.y)) / len0);
      // Dragged through the centre: the glyph turns over.
      const flipped = start.y >= c.y !== pos.y >= c.y || start.x <= c.x !== pos.x <= c.x;
      return { ...drag.origin, iconSize, angle: flipped ? angle0 + Math.PI : angle0 };
    }
    if (drag.hit.region.kind === "vertex") {
      const raw = this.pointFor(pos, shiftKey, null);
      const pts = drag.origin.points ? [...drag.origin.points] : null;
      if (!raw || !pts) return null;
      const index = drag.hit.region.index;
      if (drag.origin.type === "gannbox" && pts.length === 2) {
        // Corners 2 and 3 are (first time, second price) and (second time, first price).
        const pt = this.shiftAligned("gannbox", raw, index % 2 === 0 ? pts[1]! : pts[0]!, shiftKey);
        const [a, b] = pts as [DataPoint, DataPoint];
        const next: [DataPoint, DataPoint] =
          index === 0 ? [pt, b] : index === 1 ? [a, pt] : index === 2 ? [{ time: pt.time, price: a.price }, { time: b.time, price: pt.price }] : [{ time: a.time, price: pt.price }, { time: pt.time, price: b.price }];
        return { ...drag.origin, points: next, time: next[0].time, price: next[0].price, time2: next[1].time, price2: next[1].price };
      }
      if (drag.origin.type === "gannsquare" && pts.length === 2 && index < 2) {
        const other = pts[index === 0 ? 1 : 0]!;
        const ratio = drag.origin.scaleRatio;
        if (shiftKey && ratio) {
          pts[index] = this.gannRatioPoint(raw, other, ratio, index as 0 | 1);
          return { ...drag.origin, points: pts, time: pts[0]!.time, price: pts[0]!.price, time2: pts[1]!.time, price2: pts[1]!.price };
        }
        pts[index] = raw;
        const i0 = this.barIndex(pts[0]!.time);
        const i1 = this.barIndex(pts[1]!.time);
        const scaleRatio = i0 !== null && i1 !== null && i0 !== i1 ? Math.abs((pts[1]!.price - pts[0]!.price) / (i1 - i0)) : drag.origin.scaleRatio;
        return { ...drag.origin, scaleRatio, points: pts, time: pts[0]!.time, price: pts[0]!.price, time2: pts[1]!.time, price2: pts[1]!.price };
      }
      if (drag.origin.type === "barspattern" && pts.length === 2) {
        // The second point stays right of the first (and vice versa) by a bar at least.
        const other = pts[index === 0 ? 1 : 0]!;
        const bar = this.intervalSec;
        const time = index === 1 ? Math.max(raw.time, other.time + bar) : Math.min(raw.time, other.time - bar);
        pts[index] = { time, price: raw.price };
        return { ...drag.origin, points: pts, time: pts[0]!.time, price: pts[0]!.price, time2: pts[1]!.time, price2: pts[1]!.price };
      }
      if (drag.origin.type === "anchoredvwap") {
        return this.withVwapAnchor({ ...drag.origin, points: [raw] });
      }
      if (drag.origin.type === "frvp" || drag.origin.type === "avp") {
        pts[index] = raw;
        return this.withProfileAnchors({ ...drag.origin, points: pts, time: pts[0]!.time, time2: pts[1]?.time });
      }
      if (drag.origin.type === "regression") {
        pts[index] = raw;
        return this.withRegressionAnchors({ ...drag.origin, points: pts, time: pts[0]!.time, time2: pts[1]!.time });
      }
      if (drag.origin.type === "trendangle" && index === 1) {
        pts[1] = raw;
        return this.withScreenAngle({ ...drag.origin, points: pts, time2: raw.time, price2: raw.price });
      }
      const pt = raw;
      pts[drag.hit.region.index] = { time: pt.time, price: pt.price };
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      return { ...drag.origin, points: pts, time: first.time, price: first.price, time2: last.time, price2: last.price };
    }
    if (drag.hit.region.kind !== "point") return null;
    const pt = this.pointFor(pos, shiftKey, this.dragAnchorPx(drag));
    if (!pt) return null;
    const updated: DrawingLine = { ...drag.origin };
    const { timeKey, priceKey } = drag.hit.region;
    if (timeKey) updated[timeKey] = pt.time;
    if (priceKey) updated[priceKey] = pt.price;
    return updated;
  }

  /** Move a whole drawing by a pixel delta (body / group drag). */
  private shiftDrawing(
    origin: DrawingLine,
    entry: ResolvedEntry,
    dx: number,
    dy: number,
  ): DrawingLine | null {
    if (origin.type === "horizontal") {
      if (entry.y1 === null) return null;
      const price = this.series.coordinateToPrice(entry.y1 + dy);
      return price === null ? null : { ...origin, price };
    }
    if (origin.type === "vertical") {
      const p = this.shiftPoint(entry.x1, entry.y1, dx, 0);
      return p ? { ...origin, time: p.time } : null;
    }
    if (origin.type === "position") return this.shiftPosition(origin, entry, dx, dy);
    if (origin.points) return this.shiftBrush(origin, entry, dx, dy);
    if (origin.type === "channel") return this.shiftChannel(origin, entry, dx, dy);
    const p1 = this.shiftPoint(entry.x1, entry.y1, dx, dy);
    const p2 = this.shiftPoint(entry.x2, entry.y2, dx, dy);
    if (!p1 || !p2) return null;
    return { ...origin, time: p1.time, price: p1.price, time2: p2.time, price2: p2.price };
  }

  // Body-drag a brush stroke: every point moves by the same pixels.
  private shiftBrush(origin: DrawingLine, entry: ResolvedEntry, dx: number, dy: number): DrawingLine | null {
    const pts = entry.pts;
    if (!pts || !origin.points || pts.length !== origin.points.length) return null;
    const moved: DataPoint[] = [];
    for (const p of pts) {
      const m = this.shiftPoint(p.x, p.y, dx, dy);
      if (!m) return null;
      moved.push(m);
    }
    const first = moved[0]!;
    const last = moved[moved.length - 1]!;
    return {
      ...origin,
      points: moved.map((p) => ({ time: p.time, price: p.price })),
      time: first.time,
      price: first.price,
      time2: last.time,
      price2: last.price,
    };
  }

  // Body-drag a parallel channel: move all three anchors together.
  private shiftChannel(
    origin: DrawingLine,
    entry: ResolvedEntry,
    dx: number,
    dy: number,
  ): DrawingLine | null {
    const p1 = this.shiftPoint(entry.x1, entry.y1, dx, dy);
    const p2 = this.shiftPoint(entry.x2, entry.y2, dx, dy);
    const p3 = this.shiftPoint(entry.x1, entry.y3 ?? entry.y1, dx, dy);
    if (!p1 || !p2 || !p3) return null;
    return {
      ...origin,
      time: p1.time,
      price: p1.price,
      time2: p2.time,
      price2: p2.price,
      time3: p3.time,
      price3: p3.price,
    };
  }

  // Body-drag a position: shift the box in time and every price row together.
  private shiftPosition(
    origin: DrawingLine,
    entry: ResolvedEntry,
    dx: number,
    dy: number,
  ): DrawingLine | null {
    const p = this.shiftPoint(entry.x1, entry.y1, dx, dy);
    if (!p) return null;
    const dPrice = p.price - origin.price;
    // Each edge moves by the same number of *bars*, through its own pixel
    // position. Shifting the right edge by seconds instead lands it inside a
    // session gap on stock charts, where it sticks while the left side moves.
    const right = this.shiftPoint(entry.x2, entry.y1, dx, dy);
    return {
      ...origin,
      time: p.time,
      time2: right ? right.time : origin.time2,
      price: p.price,
      stopPrice: origin.stopPrice != null ? origin.stopPrice + dPrice : undefined,
      targetPrice: origin.targetPrice != null ? origin.targetPrice + dPrice : undefined,
    };
  }

  private shiftPoint(x: number | null, y: number | null, dx: number, dy: number): DataPoint | null {
    if (x === null || y === null) return null;
    return this.toPoint({ x: x + dx, y: y + dy });
  }

  private endDrag(): void {
    const drag = this.drag!;
    this.drag = null;
    this.applyCursor(null);
    if (!drag.moved) return;
    const ids = [drag.hit.id, ...drag.group.map((g) => g.origin.id)];
    for (const id of ids) {
      const d = this.drawings.find((x) => x.id === id);
      if (d) this.cb.onUpdate({ ...d });
    }
  }

  // ── Snapping (Shift = 45° angle, magnet = OHLC price) ──────────────

  /**
   * Resolve a cursor position to a data point, applying Shift angle-snap
   * (trendlines, when an opposite anchor exists) or magnet OHLC snapping.
   */
  private pointFor(pos: Pt, shiftKey: boolean, angleAnchor: Pt | null): DataPoint | null {
    const snapped = this.snapToNearbyAnchor(pos);
    if (snapped) return snapped;
    if (shiftKey && angleAnchor) return this.toPoint(snapAngle(angleAnchor, pos));
    const pt = this.toPoint(pos);
    if (!pt || this.magnetMode === "none") return pt;
    return this.magnetSnap(pt, pos.y);
  }

  // Snap an anchor to a nearby *other* drawing's anchor (object snapping). The
  // currently-selected drawings are skipped so dragging never snaps to itself.
  private snapToNearbyAnchor(pos: Pt): DataPoint | null {
    for (const e of this.resolveAll()) {
      if (this.selectedIds.includes(e.d.id)) continue;
      for (const c of this.anchorPoints(e)) {
        if (dist(pos, { x: c.x, y: c.y }) <= SNAP_ANCHOR_PX)
          return { time: c.time, price: c.price };
      }
    }
    return null;
  }

  private anchorPoints(e: ResolvedEntry): Array<{ x: number; y: number } & DataPoint> {
    const d = e.d;
    const out: Array<{ x: number; y: number } & DataPoint> = [];
    if (e.x1 != null && e.y1 != null && d.time != null) {
      out.push({ x: e.x1, y: e.y1, time: d.time, price: d.price });
    }
    if (e.x2 != null && e.y2 != null && d.time2 != null && d.price2 != null) {
      out.push({ x: e.x2, y: e.y2, time: d.time2, price: d.price2 });
    }
    if (e.x3 != null && e.y3 != null && d.time3 != null && d.price3 != null) {
      out.push({ x: e.x3, y: e.y3, time: d.time3, price: d.price3 });
    }
    return out;
  }

  /** Pixel position of the first anchor while placing a trendline. */
  private placementAnchorPx(): Pt | null {
    if (!this.placing || this.tool !== "trendline") return null;
    const x = timeToX(this.ctx(), this.placing.p1.time);
    const y = this.series.priceToCoordinate(this.placing.p1.price);
    return x !== null && y !== null ? { x, y } : null;
  }

  /** Pixel position of the anchor opposite the one being dragged. */
  private dragAnchorPx(drag: DragState): Pt | null {
    if (drag.origin.type !== "trendline" || drag.hit.region.kind !== "point") return null;
    const en = drag.originEntry;
    const movingP1 = drag.hit.region.timeKey === "time";
    const x = movingP1 ? en.x2 : en.x1;
    const y = movingP1 ? en.y2 : en.y1;
    return x !== null && y !== null ? { x, y } : null;
  }

  private magnetSnap(pt: DataPoint, cursorY: number): DataPoint {
    const candle = this.candleAt(pt.time);
    if (!candle) return pt;
    let bestPrice = pt.price;
    // Strong magnet always snaps to the nearest OHLC; weak only when close.
    let bestDist = this.magnetMode === "strong" ? Number.POSITIVE_INFINITY : MAGNET_THRESHOLD_PX;
    for (const price of [candle.open, candle.high, candle.low, candle.close]) {
      const y = this.series.priceToCoordinate(price);
      if (y === null) continue;
      const d = Math.abs(y - cursorY);
      if (d < bestDist) {
        bestDist = d;
        bestPrice = price;
      }
    }
    return { time: pt.time, price: bestPrice };
  }

  /** Binary search the series data for the bar at the given unix time. */
  private candleAt(utcTime: number): OhlcBar | null {
    const time = toChartTime(utcTime);
    const data = this.series.data();
    let lo = 0;
    let hi = data.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = data[mid]!.time as number;
      if (t === time) return asOhlc(data[mid]!);
      if (t < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  // ── State helpers ──────────────────────────────────────────────────

  private removeSelected(): void {
    const ids = this.selectedIds;
    this.select([]);
    this.drawings = this.drawings.filter((d) => !ids.includes(d.id));
    this.primitive.setDrawings(this.drawings);
    for (const id of ids) this.cb.onRemove(id);
  }

  private select(ids: string[]): void {
    const same =
      ids.length === this.selectedIds.length && ids.every((id, i) => id === this.selectedIds[i]);
    if (same) return;
    this.selectedIds = ids;
    this.primitive.setSelected(ids);
    this.cb.onSelectionChange?.([...ids]);
  }

  private hoverHit(hit: Hit | null): void {
    const id = hit?.id ?? null;
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.primitive.setHovered(id);
    }
    this.applyCursor(hit && this.tool !== "eraser" ? "pointer" : null);
  }

  private applyCursor(interactionCursor: "pointer" | "grabbing" | null): void {
    if (interactionCursor) {
      this.container.style.cursor = interactionCursor;
      return;
    }
    if (this.tool === "eraser") this.container.style.cursor = ERASER_CURSOR;
    else if (this.tool !== "none") this.container.style.cursor = "crosshair";
    else this.container.style.cursor = CURSOR_FOR_MODE[this.cursorMode];
  }
}
