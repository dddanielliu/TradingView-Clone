import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  ISeriesApi,
  ISeriesPrimitiveAxisView,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesType,
} from "lightweight-charts";
import type { DrawingLine } from "../../../pages/trading/constants";
import { PluginBase } from "../plugin-base";
import { fromChartTime, toChartTime } from "../../chart-time.ts";
import { renderEntry } from "./renderers";
import { makeResolveCtx, resolveEntry, timeToX } from "./resolve";
import type { DrawCtxInfo, EntryState, ResolvedEntry } from "./types";

class DrawingsPaneRenderer implements ISeriesPrimitivePaneRenderer {
  private readonly _entries: ResolvedEntry[];
  private readonly _info: DrawCtxInfo;

  constructor(entries: ResolvedEntry[], info: DrawCtxInfo) {
    this._entries = entries;
    this._info = info;
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      for (const e of this._entries) renderEntry(scope, e, this._info);
    });
  }
}

class DrawingsPaneView implements ISeriesPrimitivePaneView {
  private readonly _source: DrawingsPrimitive;
  private _entries: ResolvedEntry[] = [];

  constructor(source: DrawingsPrimitive) {
    this._source = source;
  }

  update(): void {
    this._entries = this._source.resolveEntries();
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new DrawingsPaneRenderer(this._entries, this._source.drawInfo());
  }
}

class PriceAxisLabelView implements ISeriesPrimitiveAxisView {
  private readonly _source: DrawingsPrimitive;
  private readonly _price: number;
  private readonly _color: string;
  private _y: number | null = null;

  constructor(source: DrawingsPrimitive, price: number, color: string) {
    this._source = source;
    this._price = price;
    this._color = color;
  }

  update(): void {
    this._y = this._source.series.priceToCoordinate(this._price);
  }

  coordinate(): number {
    return this._y ?? -1;
  }

  visible(): boolean {
    return this._y !== null;
  }

  tickVisible(): boolean {
    return true;
  }

  text(): string {
    return this._source.series.priceFormatter().format(this._price);
  }

  textColor(): string {
    return "#ffffff";
  }

  backColor(): string {
    return this._color;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** TradingView's time-axis label: "Mon 19 Oct '26 18:45" (date only for daily bars). */
export function formatAxisTime(sec: number, intraday: boolean, fullYear = false): string {
  const d = new Date(sec * 1000);
  const year = fullYear ? String(d.getUTCFullYear()) : `'${String(d.getUTCFullYear()).slice(2)}`;
  const date = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${year}`;
  if (!intraday) return date;
  return `${date} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

class TimeAxisLabelView implements ISeriesPrimitiveAxisView {
  private _x: number | null = null;

  constructor(
    private readonly _source: DrawingsPrimitive,
    private readonly _time: number,
    private readonly _color: string,
  ) {}

  update(): void {
    this._x = timeToX(makeResolveCtx(this._source.chart, this._source.series, this._source.intervalSec), this._time);
  }

  coordinate(): number {
    return this._x ?? -1;
  }

  visible(): boolean {
    return this._x !== null;
  }

  tickVisible(): boolean {
    return true;
  }

  text(): string {
    return formatAxisTime(toChartTime(this._time), this._source.intervalSec < 86_400);
  }

  textColor(): string {
    return "#ffffff";
  }

  backColor(): string {
    return this._color;
  }
}

/**
 * The selected drawing's span highlighted on an axis: a translucent band
 * between its two prices (price scale) or its two times (time scale), as
 * TradingView draws while a drawing is selected.
 */
class AxisBandView implements ISeriesPrimitivePaneView {
  private _range: [number, number] | null = null;

  constructor(
    private readonly _source: DrawingsPrimitive,
    private readonly _axis: "price" | "time",
  ) {}

  update(): void {
    this._range = this._source.selectedSpan(this._axis);
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    const range = this._range;
    const axis = this._axis;
    const color = AXIS_LABEL_BLUE;
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        if (!range) return;
        target.useBitmapCoordinateSpace((scope) => {
          const ctx = scope.context;
          ctx.save();
          ctx.fillStyle = hexWithAlpha(color, 0.25);
          if (axis === "price") {
            const y1 = Math.round(Math.min(...range) * scope.verticalPixelRatio);
            const y2 = Math.round(Math.max(...range) * scope.verticalPixelRatio);
            ctx.fillRect(0, y1, scope.bitmapSize.width, y2 - y1);
          } else {
            const x1 = Math.round(Math.min(...range) * scope.horizontalPixelRatio);
            const x2 = Math.round(Math.max(...range) * scope.horizontalPixelRatio);
            ctx.fillRect(x1, 0, x2 - x1, scope.bitmapSize.height);
          }
          ctx.restore();
        });
      },
    };
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})(?:[a-f\d]{2})?$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

// Horizontal lines always label their price on the axis; other drawings show
// their anchor prices only while selected (TradingView behavior).
function appendAxisViews(
  views: PriceAxisLabelView[],
  d: DrawingLine,
  selectedIds: ReadonlySet<string>,
  source: DrawingsPrimitive,
): void {
  // Horizontal rays and crosslines always label their price too (showPrice).
  if ((d.type === "horzray" || d.type === "crossline") && d.points?.[0]) {
    views.push(new PriceAxisLabelView(source, d.points[0].price, d.color));
    return;
  }
  if (d.type === "horizontal") {
    views.push(new PriceAxisLabelView(source, d.price, d.color));
    return;
  }
  if (!selectedIds.has(d.id)) return;
  // Line tools label in TradingView's axisLabelBackgroundColor (tv-blue-500);
  // the position labels each level in its own colour.
  const colors = d.type === "position" ? ["#089981", "#787b86", "#f23645"] : [];
  spanPrices(d).forEach((p, i) => views.push(new PriceAxisLabelView(source, p, colors[i] ?? AXIS_LABEL_BLUE)));
}

const AXIS_LABEL_BLUE = "#2962ff";

/** The prices a selected drawing marks on the price scale. */
function spanPrices(d: DrawingLine): number[] {
  if (d.type === "vertical" || d.type === "text") return [];
  if (d.points) return [...new Set(d.points.map((p) => p.price))];
  if (d.type === "position") {
    return d.targetPrice != null && d.stopPrice != null ? [d.targetPrice, d.price, d.stopPrice] : [d.price];
  }
  return [d.price, d.price2].filter((v): v is number => v != null && Number.isFinite(v));
}

/** The times a selected drawing marks on the time scale. */
function spanTimes(d: DrawingLine): number[] {
  if (d.type === "horizontal" || d.type === "horzray") return [];
  if (d.points) return [...new Set(d.points.map((p) => p.time))];
  return [d.time, d.time2].filter((v): v is number => v != null);
}

/**
 * Single series primitive that renders every user drawing (plus the in-flight
 * preview) on one canvas pass. Interaction state (hover/selection) is pushed
 * in by DrawingToolsManager.
 */
export class DrawingsPrimitive extends PluginBase {
  private _drawings: DrawingLine[] = [];
  private _preview: DrawingLine | null = null;
  private _selectedIds: Set<string> = new Set();
  private _hoveredId: string | null = null;
  private _intervalSec = 60;
  private _accountEquity = 0;
  private readonly _paneViews = [new DrawingsPaneView(this)];
  private readonly _priceBand = [new AxisBandView(this, "price")];
  private readonly _timeBand = [new AxisBandView(this, "time")];
  private _axisViews: PriceAxisLabelView[] = [];
  private _timeAxisViews: TimeAxisLabelView[] = [];

  get intervalSec(): number {
    return this._intervalSec;
  }

  /** The single selected drawing, when exactly one is selected. */
  private _selectedOne(): DrawingLine | null {
    if (this._selectedIds.size !== 1) return null;
    const [id] = this._selectedIds;
    return this._drawings.find((d) => d.id === id) ?? null;
  }

  /** Pixel span of the selected drawing on one axis, or null. */
  selectedSpan(axis: "price" | "time"): [number, number] | null {
    const d = this._selectedOne();
    if (!d) return null;
    if (axis === "price") {
      const prices = spanPrices(d);
      if (prices.length < 2) return null;
      const ys = prices.map((p) => this.series.priceToCoordinate(p));
      if (ys.some((y) => y === null)) return null;
      return [Math.min(...(ys as number[])), Math.max(...(ys as number[]))];
    }
    const times = spanTimes(d);
    if (times.length < 2) return null;
    const ctx = makeResolveCtx(this.chart, this.series, this._intervalSec);
    const xs = times.map((t) => timeToX(ctx, t));
    if (xs.some((x) => x === null)) return null;
    return [Math.min(...(xs as number[])), Math.max(...(xs as number[]))];
  }

  setDrawings(drawings: DrawingLine[]): void {
    this._drawings = drawings;
    this._rebuildAxisViews();
    this.requestUpdate();
  }

  setPreview(d: DrawingLine | null): void {
    this._preview = d;
    this.requestUpdate();
  }

  setSelected(ids: readonly string[]): void {
    this._selectedIds = new Set(ids);
    this._rebuildAxisViews();
    this.requestUpdate();
  }

  setHovered(id: string | null): void {
    if (this._hoveredId === id) return;
    this._hoveredId = id;
    this.requestUpdate();
  }

  setAccountEquity(equity: number): void {
    if (this._accountEquity === equity) return;
    this._accountEquity = equity;
    this.requestUpdate();
  }

  /** Account context the position tool reads for its $-risk / size readout. */
  drawInfo(): DrawCtxInfo {
    const series = this.series;
    const format = series.options().priceFormat;
    return {
      accountEquity: this._accountEquity,
      priceFormat: (p: number) => series.priceFormatter().format(p),
      tickSize: "minMove" in format && format.minMove ? format.minMove : 0.01,
      // In real UTC, like the drawings' own times, with each bar's volume.
      bars: () => {
        const vol = new Map<number, number>();
        for (const v of this._volumeSeries?.data() ?? []) {
          if ("value" in v) vol.set(v.time as number, v.value as number);
        }
        return series
          .data()
          .filter((b): b is typeof b & { open: number; high: number; low: number; close: number } => "close" in b)
          .map((b) => ({ ...b, volume: vol.get(b.time as number) ?? 0, time: fromChartTime(b.time as number) })) as unknown as ReturnType<
          DrawCtxInfo["bars"]
        >;
      },
      timeToX: (t: number) => timeToX(makeResolveCtx(this.chart, series, this._intervalSec), t),
      priceToY: (p: number) => series.priceToCoordinate(p),
      yToPrice: (y: number) => series.coordinateToPrice(y),
      background: backgroundOf(this.chart.options().layout.background),
    };
  }

  private _volumeSeries: ISeriesApi<SeriesType> | null = null;

  /** The volume histogram, read by the volume-based tools (VWAP, profiles). */
  setVolumeSeries(series: ISeriesApi<SeriesType> | null): void {
    this._volumeSeries = series;
  }

  setIntervalSec(intervalSec: number): void {
    if (this._intervalSec === intervalSec) return;
    this._intervalSec = intervalSec;
    // The interval drives whitespace extrapolation of anchors past either data
    // edge — repaint so a timeframe switch re-resolves drawings immediately
    // rather than waiting for the next unrelated chart paint.
    this.requestUpdate();
  }

  updateAllViews(): void {
    for (const v of this._paneViews) v.update();
    for (const v of this._axisViews) v.update();
    for (const v of this._timeAxisViews) v.update();
    this._priceBand[0]!.update();
    this._timeBand[0]!.update();
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this._timeAxisViews;
  }

  priceAxisPaneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._priceBand;
  }

  timeAxisPaneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._timeBand;
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this._axisViews;
  }

  resolveEntries(): ResolvedEntry[] {
    const ctx = makeResolveCtx(this.chart, this.series, this._intervalSec);
    const entries = this._drawings.map((d) => resolveEntry(d, ctx, this._stateFor(d.id)));
    if (this._preview) entries.push(resolveEntry(this._preview, ctx, "preview"));
    return entries;
  }

  private _stateFor(id: string): EntryState {
    if (this._selectedIds.has(id)) return "selected";
    if (id === this._hoveredId) return "hovered";
    return "normal";
  }

  private _rebuildAxisViews(): void {
    const views: PriceAxisLabelView[] = [];
    for (const d of this._drawings) appendAxisViews(views, d, this._selectedIds, this);
    this._axisViews = views;
    const one = this._selectedOne();
    const selectedTimes = one ? spanTimes(one).map((t) => new TimeAxisLabelView(this, t, AXIS_LABEL_BLUE)) : [];
    // A crossline labels its time whether selected or not (showTime).
    const crossTimes = this._drawings
      .filter((d) => d.type === "crossline" && !d.hidden && d.points?.[0] && d.id !== one?.id)
      .map((d) => new TimeAxisLabelView(this, d.points![0]!.time, d.color));
    this._timeAxisViews = [...selectedTimes, ...crossTimes];
  }
}

function backgroundOf(bg: { type: string; color?: string; topColor?: string }): string {
  return (bg.type === "solid" ? bg.color : bg.topColor) ?? "#ffffff";
}
