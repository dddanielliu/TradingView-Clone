import type { CanvasRenderingTarget2D } from "fancy-canvas";
import {
  type ISeriesApi,
  type ISeriesPrimitivePaneRenderer,
  type ISeriesPrimitivePaneView,
  MismatchDirection,
  type SeriesType,
} from "lightweight-charts";
import { PluginBase } from "./plugin-base";

/**
 * TradingView's price-scale labels for a series, drawn in place of
 * lightweight-charts' own last-value label (that one follows the last
 * *visible* bar, so the current price vanished while viewing history):
 *
 * - the current value, filled in the newest bar's colour and always shown,
 *   with the "Countdown to bar close" as a second line when there is one;
 * - while the newest bar is off screen, the last visible bar's value too,
 *   outlined (background fill, border and text in that bar's colour) and
 *   moved clear of the filled label when they would overlap.
 */
export interface CountdownLabelState {
  text: string;
}

export interface SeriesLabelOptions {
  fontFamily: string;
  /** Bar colours for OHLC series; histogram bars carry their own. */
  upColor?: string;
  downColor?: string;
  /** Chart background, the fill of the outlined label. */
  background: string;
  /**
   * Label another series on this one's price scale: an overlay such as
   * volume has no scale of its own, and TradingView shows its labels here.
   */
  dataSeries?: ISeriesApi<SeriesType>;
}

// lightweight-charts' label: 12px text with 3px above and below; TradingView
// adds a second 12px line for the countdown and keeps the 3px under it.
const FONT_SIZE = 12;
const HALF_LINE = 9;
const LINE_BOX = 18;
const COUNTDOWN_BOX = 32;
const TEXT_LEFT = 8;

interface Bar {
  time: unknown;
  open?: number;
  close?: number;
  value?: number;
  color?: string;
}

/** Drop the alpha from "rgba(r, g, b, a)": TradingView's labels are solid. */
function solid(color: string): string {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)$/.exec(color);
  return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : color;
}

interface LabelBox {
  /** Box top; the text line is centred HALF_LINE below it. */
  top: number;
  height: number;
}

/**
 * The price axis's label alignment (TradingView's, kept by lightweight-charts
 * as _fixLabelOverlap / recalculateOverlapping), on box tops: labels hugging
 * an edge are pulled inside; then the labels above the centre are stacked
 * upwards and those below downwards, nearest the centre first, each pushed
 * just clear of the one before, shifting a group back when it would run off
 * the scale and there is room behind it.
 */
export function alignLabels(boxes: LabelBox[], scaleHeight: number): void {
  for (const b of boxes) {
    if (b.top < 0 && b.top > -b.height) b.top = 0;
    if (b.top + b.height > scaleHeight && b.top < scaleHeight) b.top = scaleHeight - b.height;
  }
  const center = scaleHeight / 2;
  const anchor = (b: LabelBox) => b.top + HALF_LINE;
  const up = boxes.filter((b) => anchor(b) <= center).sort((a, b) => b.top - a.top);
  const down = boxes.filter((b) => anchor(b) > center).sort((a, b) => a.top - b.top);
  stack(up, 1, center, scaleHeight);
  stack(down, -1, center, scaleHeight);
}

function stack(boxes: LabelBox[], direction: 1 | -1, center: number, scaleHeight: number): void {
  if (boxes.length === 0) return;
  let groupStart = 0;
  let space = Math.max(0, direction === 1 ? center - boxes[0]!.top : boxes[0]!.top + boxes[0]!.height - center);
  for (let i = 1; i < boxes.length; i++) {
    const cur = boxes[i]!;
    const prev = boxes[i - 1]!;
    const overlap = direction === 1 ? cur.top + cur.height > prev.top : cur.top < prev.top + prev.height;
    if (!overlap) {
      groupStart = i;
      space = direction === 1 ? prev.top - (cur.top + cur.height) : cur.top - (prev.top + prev.height);
      continue;
    }
    cur.top = direction === 1 ? prev.top - cur.height : prev.top + prev.height;
    const out = direction === 1 ? -cur.top : cur.top + cur.height - scaleHeight;
    if (out > 0 && space > 0) {
      const shift = Math.min(out, space);
      for (let k = groupStart; k < boxes.length; k++) boxes[k]!.top += direction * shift;
      space -= shift;
    }
  }
}

class SeriesLabelsView implements ISeriesPrimitivePaneView {
  constructor(private readonly _source: CountdownLabel) {}

  // After the tick labels, before anything lightweight-charts labels itself.
  zOrder(): "normal" {
    return "normal";
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    const src = this._source;
    const series = src.opts.dataSeries ?? src.series;
    const value = (b: Bar) => (b.close ?? b.value)!;
    const colorOf = (b: Bar) =>
      solid(b.color ?? ((b.close ?? 0) >= (b.open ?? 0) ? (src.opts.upColor ?? "#089981") : (src.opts.downColor ?? "#f23645")));
    const barAt = (index: number) => {
      const b = series.dataByIndex(index, MismatchDirection.NearestLeft) as Bar | null;
      return b && (b.close != null || b.value != null) ? b : null;
    };
    // Read at draw time so the labels move with every tick.
    const last = src.visible ? barAt(Number.MAX_SAFE_INTEGER) : null;
    const range = src.chart.timeScale().getVisibleLogicalRange();
    const edge = range ? barAt(Math.floor(range.to)) : null;
    const shown = last && edge && edge.time !== last.time ? edge : null;
    const format = series.priceFormatter();
    const countdown = src.state?.text ?? null;
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        if (!last) return;
        const yLast = series.priceToCoordinate(value(last));
        if (yLast === null) return;
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: h, verticalPixelRatio: v }) => {
          ctx.font = `${Math.round(FONT_SIZE * v)}px ${src.opts.fontFamily}`;
          ctx.textBaseline = "middle";
          const lastBox: LabelBox = { top: yLast - HALF_LINE, height: countdown ? COUNTDOWN_BOX : LINE_BOX };
          const yShown = shown ? series.priceToCoordinate(value(shown)) : null;
          const shownBox: LabelBox | null = yShown !== null ? { top: yShown - HALF_LINE, height: LINE_BOX } : null;
          alignLabels(shownBox ? [lastBox, shownBox] : [lastBox], bitmapSize.height / v);
          const lastTop = lastBox.top;
          const lastH = lastBox.height;

          if (shown && shownBox) {
            const top = shownBox.top;
            const c = colorOf(shown);
            const y0 = Math.round(top * v);
            const boxH = Math.round(LINE_BOX * v);
            const lw = Math.max(1, Math.floor(h));
            ctx.fillStyle = src.opts.background;
            ctx.fillRect(0, y0, bitmapSize.width, boxH);
            ctx.strokeStyle = c;
            ctx.lineWidth = lw;
            ctx.strokeRect(lw / 2, y0 + lw / 2, bitmapSize.width - lw, boxH - lw);
            ctx.fillStyle = c;
            ctx.fillText(format.format(value(shown)), Math.round(TEXT_LEFT * h), Math.round((top + HALF_LINE) * v));
          }

          ctx.fillStyle = colorOf(last);
          ctx.fillRect(0, Math.round(lastTop * v), bitmapSize.width, Math.round(lastH * v));
          ctx.fillStyle = "#ffffff";
          ctx.fillText(format.format(value(last)), Math.round(TEXT_LEFT * h), Math.round((lastTop + HALF_LINE) * v));
          if (countdown) ctx.fillText(countdown, Math.round(TEXT_LEFT * h), Math.round((lastTop + 2 * HALF_LINE + 6) * v));
        });
      },
    };
  }
}

export class CountdownLabel extends PluginBase {
  state: CountdownLabelState | null = null;
  /** Off while bid / ask lines stand in for the last price. */
  visible = true;
  private readonly _views = [new SeriesLabelsView(this)];

  constructor(readonly opts: SeriesLabelOptions) {
    super();
  }

  setState(state: CountdownLabelState | null): void {
    this.state = state;
    this.requestUpdate();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.requestUpdate();
  }

  /** A theme change recolours the labels in place. */
  setColors(colors: Pick<SeriesLabelOptions, "upColor" | "downColor" | "background">): void {
    Object.assign(this.opts, colors);
    this.requestUpdate();
  }

  priceAxisPaneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._views;
  }
}

/** TradingView's countdown text: "00:37", "12:05", "01:23:45", "2d 05h", "2M 5d". */
export function countdownText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d >= 30) return `${Math.floor(d / 30)}M ${d % 30}d`;
  if (d > 0) return `${d}d ${pad(h)}h`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
  return `${pad(m)}:${pad(s % 60)}`;
}
