import { tvDash } from "./geometry";
import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawCtxInfo, ResolvedEntry } from "./types";

/**
 * TradingView's line tools beyond the basic trend / horizontal / vertical
 * lines, ported from their modules (line-tool-horizontal-ray, -cross-line,
 * -trend-angle, -flat-bottom, -disjoint-channel, -regression-trend,
 * -pitchfork). All keep their anchors in the drawing's point list.
 */

export type LineToolType =
  | "horzray"
  | "crossline"
  | "trendangle"
  | "flatbottom"
  | "disjointchannel"
  | "regression"
  | "pitchfork"
  | "schiffpitchfork"
  | "modschiffpitchfork"
  | "insidepitchfork"
  | "cycliclines"
  | "timecycles"
  | "sineline";

interface LineToolSpec {
  points: number;
  color: string;
  name: string;
}

// Defaults from each module's factory defaults (colorTvBlue500,
// colorTanOrange500, colorMintyGreen500; pitchforks draw their median in
// colorRipeRed500 and keep their own level colours).
export const LINE_TOOLS: Record<LineToolType, LineToolSpec> = {
  horzray: { points: 1, color: "#2962ff", name: "Horizontal ray" },
  crossline: { points: 1, color: "#2962ff", name: "Crossline" },
  trendangle: { points: 2, color: "#2962ff", name: "Trend angle" },
  flatbottom: { points: 3, color: "#ff9800", name: "Flat top/bottom" },
  disjointchannel: { points: 3, color: "#089981", name: "Disjoint channel" },
  regression: { points: 2, color: "#2962ff", name: "Regression trend" },
  pitchfork: { points: 3, color: "#f23645", name: "Pitchfork" },
  schiffpitchfork: { points: 3, color: "#f23645", name: "Schiff pitchfork" },
  modschiffpitchfork: { points: 3, color: "#f23645", name: "Modified Schiff pitchfork" },
  insidepitchfork: { points: 3, color: "#f23645", name: "Inside pitchfork" },
  // Cycles (line-tool-cyclic-lines, -time-cycles, -sine-line).
  cycliclines: { points: 2, color: "#80ccdb", name: "Cyclic lines" },
  timecycles: { points: 2, color: "#159980", name: "Time cycles" },
  sineline: { points: 2, color: "#159980", name: "Sine line" },
};

export function isLineTool(type: string): type is LineToolType {
  return type in LINE_TOOLS;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const FAR = 100_000;

type P = { x: number; y: number };

const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const mid = (a: P, b: P): P => scale(add(a, b), 0.5);

/** The far end of the ray from `a` through `b`. */
function rayEnd(a: P, b: P): P {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y) || 1;
  return add(a, scale(d, FAR / len));
}

function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : hex;
}

export function renderLineTool(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry, info: DrawCtxInfo): void {
  const d = e.d;
  const pts = e.pts ?? [];
  if (pts.length === 0) return;
  const ctx = scope.context;
  ctx.save();
  ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
  const width = d.width ?? 2;
  const dash = tvDash(d.lineStyle, width);
  const line = (a: P, b: P, color = d.color, w = width, pattern: number[] = dash) => {
    ctx.beginPath();
    ctx.setLineDash(pattern);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const fillPoly = (poly: P[], color: string) => {
    ctx.beginPath();
    ctx.moveTo(poly[0]!.x, poly[0]!.y);
    for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const W = scope.mediaSize.width;
  const H = scope.mediaSize.height;
  const type = d.type as LineToolType;

  switch (type) {
    case "horzray": {
      const p = pts[0]!;
      line(p, { x: W, y: p.y });
      break;
    }
    case "crossline": {
      const p = pts[0]!;
      line({ x: 0, y: p.y }, { x: W, y: p.y });
      line({ x: p.x, y: 0 }, { x: p.x, y: H });
      break;
    }
    case "trendangle": {
      const [a, b] = pts;
      if (!a || !b) break;
      line(a, b);
      // The angle on screen, its 50px dotted arc and "45.5º" beside it.
      const angle = d.angle ?? Math.atan2(-(b.y - a.y), b.x - a.x);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 2]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(50, 0);
      ctx.arc(0, 0, 50, 0, -angle, angle > 0);
      ctx.stroke();
      ctx.restore();
      ctx.font = `${d.fontSize ?? 12}px ${FONT}`;
      ctx.fillStyle = d.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`${Math.round((100 * 180 * angle) / Math.PI) / 100}º`, a.x + 55, a.y);
      break;
    }
    case "flatbottom":
    case "disjointchannel": {
      const [a, b, c] = pts;
      if (!a || !b) break;
      if (c) {
        // Flat: a level at the third point. Disjoint: the first line's slope reversed.
        const p3: P = { x: b.x, y: c.y };
        const p4: P = type === "flatbottom" ? { x: a.x, y: c.y } : { x: a.x, y: p3.y + (b.y - a.y) };
        fillPoly([a, b, p3, p4], rgba(d.fillColor ?? d.color, d.fillOpacity ?? 0.2));
        line(p4, p3);
      }
      line(a, b);
      break;
    }
    case "regression":
      renderRegression(ctx, e, info, line, fillPoly);
      break;
    case "cycliclines": {
      const [a, b] = pts;
      if (!a || !b) break;
      // A vertical line every (point 2 − point 1), from point 1 to the screen edge.
      const step = b.x - a.x;
      line(a, b, "#808080", 1, [4, 4]);
      if (Math.abs(step) < 1) break;
      for (let x = a.x; step > 0 ? x <= W : x >= 0; x += step) line({ x, y: 0 }, { x, y: H }, d.color, width);
      break;
    }
    case "timecycles": {
      const [a, b] = pts;
      if (!a || !b) break;
      // Half circles as wide as the two points are apart, repeated both ways along point 1's price.
      const w = Math.abs(a.x - b.x);
      if (w < 1) break;
      const left = Math.min(a.x, b.x);
      let start = left;
      while (start > -w) start -= w;
      for (let x = start; x < W; x += w) {
        ctx.save();
        ctx.translate(x + 1, a.y);
        ctx.scale(w, w);
        ctx.beginPath();
        ctx.arc(0.5, 0, 0.5, Math.PI, 0, false);
        ctx.restore();
        ctx.fillStyle = d.fillColor ? rgba(d.fillColor, d.fillOpacity ?? 0.5) : "rgba(106, 168, 79, 0.5)";
        ctx.fill();
        ctx.strokeStyle = d.color;
        ctx.lineWidth = width;
        ctx.stroke();
      }
      break;
    }
    case "sineline": {
      const [a, b] = pts;
      if (!a || !b) break;
      // Half period = the points' x gap, amplitude = their y gap; it runs across the pane.
      const w = Math.abs(a.x - b.x);
      const h = b.y - a.y;
      if (w < 1) break;
      const period = 2 * w;
      const x0 = a.x > 0 ? a.x - Math.ceil(a.x / period) * period : a.x + Math.floor(-a.x / period) * period;
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.moveTo(x0, a.y);
      const stepX = Math.max(1, w / 30);
      for (let k = 1; k <= W - x0 + stepX; k += stepX) {
        ctx.lineTo(x0 + k, a.y + (Math.sin((k * Math.PI) / w - Math.PI / 2) * h) / 2 + h / 2);
      }
      ctx.strokeStyle = d.color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    default:
      renderPitchfork(type, pts, d.color, width, line, fillPoly, d.fillOpacity ?? 0.2);
  }
  ctx.restore();
}

// TradingView's pitchfork levels: coefficient, visible by default, colour.
const PITCH_LEVELS: [number, boolean, string][] = [
  [0.25, false, "#ffb74d"],
  [0.382, false, "#81c784"],
  [0.5, true, "#089981"],
  [0.618, false, "#089981"],
  [0.75, false, "#00bcd4"],
  [1, true, "#2962ff"],
  [1.5, false, "#9c27b0"],
  [1.75, false, "#e91e63"],
  [2, false, "#f77c80"],
];

function renderPitchfork(
  type: LineToolType,
  pts: P[],
  median: string,
  width: number,
  line: (a: P, b: P, color?: string, w?: number) => void,
  fillPoly: (poly: P[], color: string) => void,
  fillAlpha: number,
): void {
  const [p0, p1, p2] = pts;
  if (!p0 || !p1) return;
  const m = p2 ? mid(p1, p2) : p1;
  // Where the median starts: point 0 (original), the 0–1 midpoint (Schiff
  // style "Schiff", our modified Schiff), or point 0's x at the 0–1 mid
  // price (style "Schiff2", the Schiff pitchfork). Inside starts its fork
  // from the 1–2 midpoint, aimed along base → point 2.
  let base = p0;
  if (type === "modschiffpitchfork" || type === "insidepitchfork") base = mid(p0, p1);
  if (type === "schiffpitchfork") base = { x: p0.x, y: (p0.y + p1.y) / 2 };
  if (type !== "pitchfork") line(p0, p1, median, width);
  if (type === "insidepitchfork") {
    if (p2) line(base, p2, median, width);
  } else {
    line(base, rayEnd(base, m), median, width);
  }
  if (!p2) return;
  line(p1, p2, median, width);
  const half = scale(sub(p2, p1), 0.5);
  const dir = type === "insidepitchfork" ? sub(p2, base) : sub(m, base);
  if (type === "insidepitchfork") line(m, rayEnd(m, add(m, dir)), median, width);
  const far = (p: P) => rayEnd(p, add(p, dir));
  let prev = 0;
  for (const [coeff, visible, color] of PITCH_LEVELS) {
    if (!visible) continue;
    const up = add(m, scale(half, coeff));
    const down = add(m, scale(half, -coeff));
    const prevUp = add(m, scale(half, prev));
    const prevDown = add(m, scale(half, -prev));
    fillPoly([prevUp, far(prevUp), far(up), up], rgba(color, fillAlpha));
    fillPoly([prevDown, far(prevDown), far(down), down], rgba(color, fillAlpha));
    prev = coeff;
    line(up, far(up), color, width);
    line(down, far(down), color, width);
  }
}

// Regression trend (TradingView's "Regression Trend" study): least squares on
// the closes between the two points, upper / lower lines two standard
// deviations away, the band filled at 30 %, the dashed base line, and
// Pearson's R under the lower line.
/**
 * TradingView's Regression trend (its server-side study, as published in the
 * "Linear Regression Channel"): least squares on the closes between the
 * points, channel at ±2 standard deviations of the residuals (n − 1), and
 * Pearson's R between price and the fitted line.
 */
export function regressionFit(
  bars: readonly { time: number; close: number }[],
  t1: number,
  t2: number,
): { from: number; to: number; start: number; end: number; dev: number; pearson: number } | null {
  const from = Math.min(t1, t2);
  const to = Math.max(t1, t2);
  const xs = bars.filter((b) => b.time >= from && b.time <= to);
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  xs.forEach((b, i) => {
    sx += i;
    sy += b.close;
    sxy += i * b.close;
    sxx += i * i;
  });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const icpt = (sy - slope * sx) / n;
  const avg = sy / n;
  const mid = icpt + (slope * (n - 1)) / 2;
  let acc = 0;
  let dxx = 0;
  let dyy = 0;
  let dxy = 0;
  xs.forEach((b, i) => {
    const fit = icpt + slope * i;
    const dx = b.close - avg;
    const dy = fit - mid;
    acc += (b.close - fit) ** 2;
    dxx += dx * dx;
    dyy += dy * dy;
    dxy += dx * dy;
  });
  const dev = Math.sqrt(acc / (n - 1));
  const pearson = dxx === 0 || dyy === 0 ? 0 : dxy / Math.sqrt(dxx * dyy);
  return { from: xs[0]!.time, to: xs[n - 1]!.time, start: icpt, end: icpt + slope * (n - 1), dev: 2 * dev, pearson };
}

function renderRegression(
  ctx: CanvasRenderingContext2D,
  e: ResolvedEntry,
  info: DrawCtxInfo,
  line: (a: P, b: P, color?: string, w?: number, pattern?: number[]) => void,
  fillPoly: (poly: P[], color: string) => void,
): void {
  const d = e.d;
  const [t1, t2] = [d.points?.[0]?.time, d.points?.[1]?.time];
  if (t1 == null || t2 == null) return;
  const fit = regressionFit(info.bars(), t1, t2);
  const yOf = info.priceToY;
  if (!fit || !yOf) return;
  const x1 = info.timeToX(fit.from);
  const x2 = info.timeToX(fit.to);
  if (x1 === null || x2 === null) return;
  const at = (a: number, b: number): [P, P] | null => {
    const y1 = yOf(a);
    const y2 = yOf(b);
    return y1 === null || y2 === null ? null : [{ x: Math.round(x1), y: y1 }, { x: Math.round(x2), y: y2 }];
  };
  const base = at(fit.start, fit.end);
  const up = at(fit.start + fit.dev, fit.end + fit.dev);
  const down = at(fit.start - fit.dev, fit.end - fit.dev);
  if (!base || !up || !down) return;
  // Bands: base–down in the base line's colour, up–base in the up line's, transparency 70.
  fillPoly([base[0], base[1], down[1], down[0]], "rgba(242, 54, 69, 0.3)");
  fillPoly([up[0], up[1], base[1], base[0]], "rgba(41, 98, 255, 0.3)");
  line(down[0], down[1], "#2962ff", 2, []);
  line(base[0], base[1], "#f23645", 1, tvDash("dashed", 1));
  line(up[0], up[1], "#2962ff", 2, []);
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = "#2962ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(String(fit.pearson), down[0].x, down[0].y + 4);
}
