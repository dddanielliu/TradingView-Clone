import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { fromChartTime, toChartTime } from "../../chart-time.ts";
import { tvTimeSpan } from "./forecast";
import { formatAxisTime } from "./drawings-primitive";

/**
 * TradingView's Measure (the crosshair's measure, not a drawing: it never
 * reaches the object tree). A start point, then an end that follows the
 * crosshair until the next click fixes it. Drawn as in the crosshair's
 * measure pane view: a tinted box, a horizontal and a vertical line through
 * its middle (arrowheads once 50px long), and a label with the change,
 * bars / time and volume; start and end are labelled on both axes.
 */

export type MeasurePoint = { index: number; price: number };

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const BLUE = "#2962ff"; // tv-blue-500
const BLUE_600 = "#1e53e5";
const RED = "#f7525f"; // ripe-red-400
const BG_POSITIVE = "rgba(41, 98, 255, 0.2)"; // tv-blue-500, transparency 80
const BG_NEGATIVE = "rgba(247, 82, 95, 0.2)"; // ripe-red-400, transparency 80
const AXIS_LABEL = BLUE; // axisLineToolLabelBackgroundColorCommon

/** VolumeFormatter: 3 significant digits before switching to K / M / B / T with 2 decimals. */
export function tvVolume(v: number): string {
  if (!Number.isFinite(v)) return "";
  const sign = v < 0 ? "−" : "";
  let e = Math.abs(v);
  let digits = e > 0 ? Math.floor(Math.log10(e)) + 1 : 1;
  const plain = (n: number, dp: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
  if (digits <= 3) return `${sign}${plain(Math.round(e), 0)}`;
  const dims: [number, string][] = [
    [3, "K"],
    [6, "M"],
    [9, "B"],
    [12, "T"],
  ];
  let dim = dims.find(([p]) => p >= digits - 3) ?? dims[dims.length - 1]!;
  e = +(e / 10 ** dim[0]).toFixed(2) * 10 ** dim[0];
  digits = Math.floor(Math.log10(e)) + 1;
  dim = dims.find(([p]) => p >= digits - 3) ?? dims[dims.length - 1]!;
  return `${sign}${plain(e / 10 ** dim[0], 2)} ${dim[1]}`;
}

/** The measure label's three lines (Cd.update). */
export function measureText(o: {
  from: MeasurePoint;
  to: MeasurePoint;
  seconds: number | null;
  volume: number;
  formatPrice: (p: number) => string;
  minMove: number;
}): string[] {
  const y = o.to.price - o.from.price;
  const pct = (100 * y) / Math.abs(o.from.price);
  const minus = (s: string) => s.replace(/^-/, "−");
  const pctText = minus(`${(Math.round(100 * pct) / 100).toFixed(2)}%`);
  // The pip formatter: the change in ticks (pricescale / minmov), grouped.
  const ticks = minus(Math.round(y / o.minMove).toLocaleString("en-US"));
  const bars = o.to.index - o.from.index;
  const span = o.seconds !== null ? `, ${tvTimeSpan(o.seconds)}` : "";
  const lines = [`${o.formatPrice(y)} (${pctText}) ${ticks}`, `${bars} bars${span}`];
  if (!Number.isNaN(o.volume)) lines.push(`Vol ${tvVolume(o.volume)}`);
  return lines;
}

/** calculateLabelPosition: under the box when measuring down, above it when up, kept in the pane. */
export function labelCenterY(h: number, p1y: number, p2y: number, offsetY: number, paneH: number): number {
  const a = 0.5 * h;
  const s = offsetY + a;
  const lo = Math.min(p1y, p2y);
  const hi = Math.max(p1y, p2y);
  let d: number;
  if (p1y > p2y) {
    d = lo - s;
    const t = a - d;
    if (t > 0) {
      const e = hi + s;
      if (e + a <= paneH) d = e;
      else d += t;
    }
  } else {
    d = hi + s;
    const t = d + a - paneH;
    if (t > 0) {
      const e = lo - s;
      if (e - a >= 0) d = e;
      else d -= t;
    }
  }
  return d;
}

class MeasurePaneView implements ISeriesPrimitivePaneView {
  constructor(private readonly src: MeasurePrimitive) {}
  zOrder() {
    return "top" as const;
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return { draw: (t: CanvasRenderingTarget2D) => t.useMediaCoordinateSpace(({ context, mediaSize }) => this.src.draw(context, mediaSize.height)) };
  }
}

class AxisLabel implements ISeriesPrimitiveAxisView {
  private c: number | null = null;
  private t = "";
  constructor(private readonly get: () => { coord: number | null; text: string } | null) {}
  update(): void {
    const v = this.get();
    this.c = v?.coord ?? null;
    this.t = v?.text ?? "";
  }
  coordinate(): number {
    return this.c ?? -1;
  }
  visible(): boolean {
    return this.c !== null;
  }
  tickVisible(): boolean {
    return true;
  }
  text(): string {
    return this.t;
  }
  textColor(): string {
    return "#ffffff";
  }
  backColor(): string {
    return AXIS_LABEL;
  }
}

class AxisBand implements ISeriesPrimitivePaneView {
  constructor(
    private readonly src: MeasurePrimitive,
    private readonly axis: "price" | "time",
  ) {}
  renderer(): ISeriesPrimitivePaneRenderer {
    return {
      draw: (target: CanvasRenderingTarget2D) =>
        target.useBitmapCoordinateSpace((scope) => {
          const span = this.src.span(this.axis);
          if (!span) return;
          const ctx = scope.context;
          ctx.fillStyle = "rgba(41, 98, 255, 0.25)";
          if (this.axis === "price") {
            const y1 = Math.round(span[0] * scope.verticalPixelRatio);
            const y2 = Math.round(span[1] * scope.verticalPixelRatio);
            ctx.fillRect(0, y1, scope.bitmapSize.width, y2 - y1);
          } else {
            const x1 = Math.round(span[0] * scope.horizontalPixelRatio);
            const x2 = Math.round(span[1] * scope.horizontalPixelRatio);
            ctx.fillRect(x1, 0, x2 - x1, scope.bitmapSize.height);
          }
        }),
    };
  }
}

export class MeasurePrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private volumeSeries: ISeriesApi<SeriesType> | null = null;
  private start: MeasurePoint | null = null;
  private end: MeasurePoint | null = null;
  private last: MeasurePoint | null = null;
  private readonly pane = [new MeasurePaneView(this)];
  private readonly priceLabels = [
    new AxisLabel(() => this.priceLabel(this.start)),
    new AxisLabel(() => this.priceLabel(this.lastPoint())),
  ];
  private readonly timeLabels = [
    new AxisLabel(() => this.timeLabel(this.start)),
    new AxisLabel(() => this.timeLabel(this.lastPoint())),
  ];
  private readonly priceBand = [new AxisBand(this, "price")];
  private readonly timeBand = [new AxisBand(this, "time")];

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setVolumeSeries(s: ISeriesApi<SeriesType> | null): void {
    this.volumeSeries = s;
  }

  // ── State (the crosshair source's measure state) ─────────────────────

  startPoint(): MeasurePoint | null {
    return this.start;
  }
  endPoint(): MeasurePoint | null {
    return this.end;
  }
  startMeasuring(p: MeasurePoint): void {
    this.start = p;
    this.end = null;
    this.last = p;
    this.requestUpdate?.();
  }
  finishMeasure(p: MeasurePoint): void {
    this.end = p;
    this.requestUpdate?.();
  }
  /** The crosshair moved: the unfinished end follows it. */
  setCurrent(p: MeasurePoint | null): void {
    if (!this.start || this.end || !p) return;
    this.last = p;
    this.requestUpdate?.();
  }
  clearMeasure(): void {
    this.start = null;
    this.end = null;
    this.last = null;
    this.requestUpdate?.();
  }
  private lastPoint(): MeasurePoint | null {
    return this.end ?? (this.start ? this.last : null);
  }

  // ── Views ─────────────────────────────────────────────────────────────

  updateAllViews(): void {
    for (const v of [...this.priceLabels, ...this.timeLabels]) v.update();
  }
  paneViews() {
    return this.pane;
  }
  priceAxisViews() {
    return this.start ? this.priceLabels : [];
  }
  timeAxisViews() {
    return this.start ? this.timeLabels : [];
  }
  priceAxisPaneViews() {
    return this.priceBand;
  }
  timeAxisPaneViews() {
    return this.timeBand;
  }

  private x(index: number): number | null {
    return this.chart?.timeScale().logicalToCoordinate(index as Logical) ?? null;
  }
  private y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  /** A bar index's time (UTC seconds), extrapolated past the data on the bar step. */
  timeAt(index: number): number | null {
    const data = this.series?.data() ?? [];
    if (data.length === 0) return null;
    const t = (i: number) => data[i]!.time as number;
    if (index >= 0 && index < data.length) return fromChartTime(t(index));
    const step = data.length > 1 ? t(data.length - 1) - t(data.length - 2) : 60;
    const base = index < 0 ? t(0) + index * step : t(data.length - 1) + (index - (data.length - 1)) * step;
    return fromChartTime(base);
  }

  private priceLabel(p: MeasurePoint | null) {
    if (!p || !this.series) return null;
    return { coord: this.y(p.price), text: this.series.priceFormatter().format(p.price) };
  }
  private timeLabel(p: MeasurePoint | null) {
    if (!p) return null;
    const t = this.timeAt(p.index);
    const data = this.series?.data() ?? [];
    const step = data.length > 1 ? (data[data.length - 1]!.time as number) - (data[data.length - 2]!.time as number) : 60;
    return { coord: this.x(p.index), text: t === null ? "" : formatAxisTime(toChartTime(t), step < 86400) };
  }

  span(axis: "price" | "time"): [number, number] | null {
    const a = this.start;
    const b = this.lastPoint();
    if (!a || !b) return null;
    if (axis === "price") {
      const y1 = this.y(a.price);
      const y2 = this.y(b.price);
      return y1 === null || y2 === null ? null : [Math.min(y1, y2), Math.max(y1, y2)];
    }
    const x1 = this.x(a.index);
    const x2 = this.x(b.index);
    return x1 === null || x2 === null ? null : [Math.min(x1, x2), Math.max(x1, x2)];
  }

  /** SeriesTimeRangeVolumeCalculator: the volume of the bars between the two indices. */
  private volume(i1: number, i2: number): number {
    const vol = this.volumeSeries?.data();
    const bars = this.series?.data();
    if (!vol || !bars || vol.length === 0) return NaN;
    const byTime = new Map(vol.map((v) => [v.time as number, (v as { value?: number }).value ?? 0]));
    let sum = 0;
    for (let i = Math.max(0, Math.min(i1, i2)); i <= Math.min(bars.length - 1, Math.max(i1, i2)); i++) {
      sum += byTime.get(bars[i]!.time as number) ?? 0;
    }
    return sum;
  }

  draw(ctx: CanvasRenderingContext2D, paneH: number): void {
    const t = this.start;
    const s = this.lastPoint();
    if (!t || !s || !this.series) return;
    const x1 = this.x(t.index);
    const x2 = this.x(s.index);
    const y1 = this.y(t.price);
    const y2 = this.y(s.price);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return;
    const down = s.price < t.price;
    const fmt = this.series.priceFormatter();
    const format = "minMove" in this.series.options().priceFormat ? this.series.options().priceFormat : null;
    const minMove = format && "minMove" in format && format.minMove ? format.minMove : 0.01;
    const ta = this.timeAt(t.index);
    const tb = this.timeAt(s.index);
    const lines = measureText({
      from: t,
      to: s,
      seconds: ta !== null && tb !== null ? tb - ta : null,
      volume: this.volume(t.index, s.index),
      formatPrice: (p) => fmt.format(p),
      minMove,
    });
    ctx.save();
    // The box.
    ctx.fillStyle = down ? BG_NEGATIVE : BG_POSITIVE;
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    // The two lines through its middle, arrowheads at the end once 50px long.
    const lineColor = down ? RED : BLUE_600;
    const my = Math.round((y1 + y2) / 2);
    const mx = Math.round((x1 + x2) / 2);
    strokeArrowLine(ctx, { x: x1, y: my }, { x: x2, y: my }, lineColor, Math.abs(x1 - x2) >= 50);
    strokeArrowLine(ctx, { x: mx, y: y1 }, { x: mx, y: y2 }, lineColor, Math.abs(y1 - y2) >= 50);
    // The label: white 12px lines 8px apart in a 9px-padded, 4px-rounded box.
    ctx.font = `12px ${FONT}`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
    const h = lines.length * 12 + (lines.length - 1) * 8 + 18;
    const cx = 0.5 * (x1 + x2);
    const cy = labelCenterY(h, y1, y2, 10, paneH);
    ctx.fillStyle = down ? RED : BLUE;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 4);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, cx, cy - h / 2 + 9 + 6 + i * 20));
    ctx.restore();
  }
}

/** A 1px line, with TradingView's arrowhead (two 5px strokes at 45°) at its end. */
function strokeArrowLine(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string, arrow: boolean): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (arrow && len >= 1) {
    const l = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const tr = { x: -l.y, y: l.x };
    const u = { x: b.x - l.x * 5, y: b.y - l.y * 5 };
    ctx.moveTo(u.x + tr.x * 5, u.y + tr.y * 5);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(u.x - tr.x * 5, u.y - tr.y * 5);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.stroke();
}
