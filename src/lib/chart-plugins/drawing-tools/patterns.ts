import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawingLine } from "../../../pages/trading/constants";
import type { ResolvedEntry } from "./types";

/**
 * TradingView's chart patterns and Elliott waves, ported from its line-tool
 * modules (line-tool-5points-patterns, -abcd, -head-and-shoulders,
 * -triangle-pattern, -three-drivers, -elliott): N anchors placed click by click, a solid
 * polyline through them, dotted ratio lines with their retracement in a
 * label at the midpoint, letter labels above or below each point, and
 * translucent triangle fills.
 */

export type PatternType =
  | "xabcd"
  | "cypher"
  | "abcd"
  | "headshoulders"
  | "trianglepattern"
  | "threedrives"
  | "elliottimpulse"
  | "elliottcorrection"
  | "elliotttriangle"
  | "elliottdouble"
  | "elliotttriple";

interface PatternSpec {
  points: number;
  /** Factory default colour (line, label background and fill). */
  color: string;
  name: string;
  fill: boolean;
}

// Colours: colorTvBlue500, colorMintyGreen500, colorDeepBlue500, and the
// Elliott defaults (#3d85c6, colorTanOrange500, #6aa84f).
export const PATTERNS: Record<PatternType, PatternSpec> = {
  xabcd: { points: 5, color: "#2962ff", name: "XABCD pattern", fill: true },
  cypher: { points: 5, color: "#2962ff", name: "Cypher pattern", fill: true },
  abcd: { points: 4, color: "#089981", name: "ABCD pattern", fill: false },
  headshoulders: { points: 7, color: "#089981", name: "Head and shoulders", fill: true },
  trianglepattern: { points: 4, color: "#673ab7", name: "Triangle pattern", fill: true },
  threedrives: { points: 7, color: "#673ab7", name: "Three drives pattern", fill: false },
  elliottimpulse: { points: 6, color: "#3d85c6", name: "Elliott impulse wave (1·2·3·4·5)", fill: false },
  elliottcorrection: { points: 4, color: "#3d85c6", name: "Elliott correction wave (A·B·C)", fill: false },
  elliotttriangle: { points: 6, color: "#ff9800", name: "Elliott triangle wave (A·B·C·D·E)", fill: false },
  elliottdouble: { points: 4, color: "#6aa84f", name: "Elliott double combo wave (W·X·Y)", fill: false },
  elliotttriple: { points: 6, color: "#6aa84f", name: "Elliott triple combo wave (W·X·Y·X·Z)", fill: false },
};

export function isPattern(type: string): type is PatternType {
  return type in PATTERNS;
}

// Elliott labels at the default "Intermediate" degree: bracketed, 18px regular.
const ELLIOTT_LABELS: Partial<Record<PatternType, string[]>> = {
  elliottimpulse: ["0", "1", "2", "3", "4", "5"],
  elliottcorrection: ["0", "A", "B", "C"],
  elliotttriangle: ["0", "A", "B", "C", "D", "E"],
  elliottdouble: ["0", "W", "X", "Y"],
  elliotttriple: ["0", "W", "X", "Y", "X", "Z"],
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
/** TradingView's default "transparency: 85" for pattern fills. */
const FILL_ALPHA = 0.15;

type P = { x: number; y: number };

const ratio = (a: number, b: number) => Math.round(1000 * Math.abs(a / b)) / 1000;
const fmt = (v: number) => (Number.isFinite(v) ? String(v) : "");

/** The retracement labels' values, per TradingView's _updateBaseData. */
function retracements(type: PatternType, pr: number[]): (number | undefined)[] {
  const [x, a, b, c, d] = pr;
  if (type === "cypher") {
    return [
      b !== undefined ? ratio(b - a!, a! - x!) : undefined,
      c !== undefined ? ratio(c - x!, a! - x!) : undefined,
      d !== undefined ? ratio(d - c!, c! - b!) : undefined,
      d !== undefined ? ratio(d - c!, x! - c!) : undefined,
    ];
  }
  return [
    b !== undefined ? ratio(b - a!, a! - x!) : undefined,
    c !== undefined ? ratio(c - b!, b! - a!) : undefined,
    d !== undefined ? ratio(d - c!, c! - b!) : undefined,
    d !== undefined ? ratio(d - a!, a! - x!) : undefined,
  ];
}

export function renderPattern(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry, creating: boolean): void {
  const d = e.d;
  const type = d.type as PatternType;
  const pts = e.pts ?? [];
  if (pts.length < 2) return;
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  const color = d.color;
  const width = d.width ?? 2;
  const prices = (d.points ?? []).map((p) => p.price);
  ctx.save();
  ctx.scale(hpr, vpr);
  const fillOn = PATTERNS[type].fill && d.fillOpacity !== 0;
  const fillColor = withAlpha(d.fillColor ?? color, d.fillOpacity ?? FILL_ALPHA);
  const tri = (a: P | undefined, b: P | undefined, c: P | undefined) => {
    if (!fillOn || !a || !b || !c) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  };
  const dotted = (a: P, b: P, w = 1) => {
    ctx.beginPath();
    ctx.setLineDash([w, w * 2]);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const polyline = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  };
  const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const textColor = d.textColor ?? "#ffffff";
  const fontSize = d.fontSize ?? 12;
  const boxed = (p: P, text: string, place: "above" | "below" | "middle") =>
    labelBox(ctx, p, text, place, color, textColor, fontSize, d.bold, d.italic);
  // A point's letter sits above it when it is higher than its neighbour.
  const letter = (i: number, text: string, ref: number) => {
    const p = pts[i];
    const r = pts[ref];
    if (!p || !r) return;
    boxed(p, text, (i === 0 ? r.y > p.y : p.y < r.y) ? "above" : "below");
  };

  if (type === "xabcd" || type === "cypher") {
    const [x, a, b, c, dd] = pts;
    tri(x, a, pts.length < 3 ? a : b);
    if (pts.length > 3) tri(b, c, pts.length === 5 ? dd : c);
    polyline();
    const r = retracements(type, prices);
    if (b) { dotted(x!, b); boxed(mid(x!, b), fmt(r[0]!), "middle"); }
    if (c) { dotted(a!, c); boxed(mid(a!, c), fmt(r[1]!), "middle"); }
    if (dd) {
      boxed(mid(b!, dd), fmt(r[2]!), "middle");
      dotted(x!, dd);
      boxed(mid(x!, dd), fmt(r[3]!), "middle");
      dotted(b!, dd);
    }
    ["X", "A", "B", "C", "D"].forEach((t, i) => letter(i, t, i === 0 ? 1 : i - 1));
  } else if (type === "abcd") {
    polyline();
    ["A", "B", "C", "D"].forEach((t, i) => letter(i, t, i === 0 ? 1 : i - 1));
    const [a, b, c, dd] = pts;
    if (c) {
      dotted(a!, c, width);
      boxed(mid(a!, c), fmt(ratio(prices[2]! - prices[1]!, prices[1]! - prices[0]!)), "middle");
    }
    if (dd) {
      dotted(b!, dd, width);
      boxed(mid(b!, dd), fmt(ratio(prices[3]! - prices[2]!, prices[2]! - prices[1]!)), "middle");
    }
  } else if (type === "headshoulders") {
    renderHeadShoulders(ctx, pts, color, width, tri, polyline, boxed);
  } else if (type === "threedrives") {
    // Retracements of drives 1 → 2 (points 1–3) and 2 → 3 (points 3–5), 2 decimals.
    polyline();
    const r2 = (a: number, b: number) => Math.round(100 * Math.abs(a / b)) / 100;
    if (pts[3]) {
      dotted(pts[1]!, pts[3], width);
      boxed(mid(pts[1]!, pts[3]), fmt(r2(prices[3]! - prices[2]!, prices[2]! - prices[1]!)), "middle");
    }
    if (pts[5]) {
      dotted(pts[3]!, pts[5], width);
      boxed(mid(pts[5], pts[3]!), fmt(r2(prices[5]! - prices[4]!, prices[4]! - prices[3]!)), "middle");
    }
  } else if (type === "trianglepattern") {
    renderTrianglePattern(ctx, pts, color, width, fillOn ? fillColor : null);
    ["A", "B", "C", "D"].forEach((t, i) => letter(i, t, i === 0 ? 1 : i - 1));
  } else {
    // Elliott: the wave, then each label 10px off its point, alternating
    // sides from the direction of the second leg; point 0 only while the
    // anchors show, and none for the point still following the cursor.
    polyline();
    const labels = ELLIOTT_LABELS[type] ?? [];
    let side = pts.length > 2 ? Math.sign(pts[2]!.y - pts[1]!.y) || 1 : 1;
    const anchorsVisible = e.state === "hovered" || e.state === "selected" || e.state === "preview";
    const shown = pts.length - (creating ? 1 : 0);
    ctx.font = `18px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    for (let i = 0; i < shown; i++, side = -side) {
      if (i === 0 && !anchorsVisible) continue;
      const p = pts[i]!;
      // TradingView's vertAlign "top" (side 1) hangs the label 10px below the point.
      ctx.textBaseline = side === 1 ? "top" : "bottom";
      ctx.fillText(`(${labels[i] ?? ""})`, p.x, p.y + (side === 1 ? 10 : -10));
    }
  }
  ctx.restore();
}

function renderHeadShoulders(
  ctx: CanvasRenderingContext2D,
  pts: P[],
  color: string,
  width: number,
  tri: (a: P | undefined, b: P | undefined, c: P | undefined) => void,
  polyline: () => void,
  boxed: (p: P, text: string, place: "above" | "below" | "middle") => void,
): void {
  const [p0, p1, p2, p3, p4, p5, p6] = pts;
  // The neckline through points 2 and 4, cut where it meets the shoulders' outer legs.
  let left: P | undefined;
  let right: P | undefined;
  if (pts.length >= 5) {
    const t = segmentHit(p2!, p4!, p0!, p1!);
    if (t !== null) left = { x: p2!.x + (p4!.x - p2!.x) * t, y: p2!.y + (p4!.y - p2!.y) * t };
    if (pts.length === 7) {
      const t2 = segmentHit(p2!, p4!, p5!, p6!);
      if (t2 !== null) right = { x: p2!.x + (p4!.x - p2!.x) * t2, y: p2!.y + (p4!.y - p2!.y) * t2 };
    }
  }
  polyline();
  if (pts.length >= 5) {
    tri(p2, p3, p4);
    const a = left ?? p2!;
    const b = right ?? p4!;
    // Extended where it is not cut, like TradingView's extendleft / extendright.
    const dir = { x: b.x - a.x, y: b.y - a.y };
    const far = 10_000;
    const len = Math.hypot(dir.x, dir.y) || 1;
    const from = left ? a : { x: a.x - (dir.x / len) * far, y: a.y - (dir.y / len) * far };
    const to = right ? b : { x: b.x + (dir.x / len) * far, y: b.y + (dir.y / len) * far };
    ctx.beginPath();
    ctx.setLineDash([width, width * 2]);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (left) tri(left, p1, p2);
  if (right) tri(p4, p5, right);
  const place = (p: P, ref: P) => (p.y < ref.y ? "above" : "below");
  if (p1) boxed(p1, "Left Shoulder", place(p1, p0!));
  if (p3) boxed(p3, "Head", place(p3, p2!));
  if (p5) boxed(p5, "Right Shoulder", place(p5, p4!));
}

function renderTrianglePattern(ctx: CanvasRenderingContext2D, pts: P[], color: string, width: number, fill: string | null): void {
  const [t, n, i, r] = pts;
  const line = (a: P, b: P) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  line(t!, n!);
  if (i) line(n!, i);
  if (!r) return;
  line(i!, r);
  // The two trend lines A–C and B–D, run to their apex: the shaded wedge.
  if (Math.abs(i!.x - t!.x) < 1 || Math.abs(r.x - n!.x) < 1) return;
  let x0 = Math.min(t!.x, n!.x, i!.x, r.x);
  const k1 = (i!.y - t!.y) / (i!.x - t!.x);
  const k2 = (r.y - n!.y) / (r.x - n!.x);
  if (Math.abs(k1 - k2) < 1e-6) return;
  let a: P = { x: x0, y: t!.y + (x0 - t!.x) * k1 };
  let b: P = { x: x0, y: n!.y + (x0 - n!.x) * k2 };
  const apexX = (n!.y - t!.y + (t!.x * k1 - n!.x * k2)) / (k1 - k2);
  if (apexX < x0) {
    x0 = Math.max(t!.x, n!.x, i!.x, r.x);
    a = { x: x0, y: t!.y + (x0 - t!.x) * k1 };
    b = { x: x0, y: n!.y + (x0 - n!.x) * k2 };
  }
  const apex: P = { x: apexX, y: t!.y + (apexX - t!.x) * k1 };
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.setLineDash([width, width * 2]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Where segment a–b meets segment c–d, as a fraction along a–b (TradingView's intersectLineSegments). */
function segmentHit(a: P, b: P, c: P, d: P): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return u >= 0 && u <= 1 ? t : null;
}

/** TradingView's TextRenderer label: 4px round rect, padded, 5px off the point. */
function labelBox(
  ctx: CanvasRenderingContext2D,
  p: P,
  text: string,
  place: "above" | "below" | "middle",
  bg: string,
  color: string,
  size: number,
  bold?: boolean,
  italic?: boolean,
): void {
  if (!text) return;
  ctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}${size}px ${FONT}`;
  const padX = Math.round(size / 3) + 1;
  const padY = Math.round(size / 3);
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = size + padY * 2;
  const top = place === "above" ? p.y - 5 - h : place === "below" ? p.y + 5 : p.y - h / 2;
  ctx.beginPath();
  ctx.roundRect(p.x - w / 2, top, w, h, 4);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, p.x, top + h / 2);
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : color;
}

/** A new pattern drawing from its placed points. */
export function patternDefaults(type: PatternType): Partial<DrawingLine> {
  return { color: PATTERNS[type].color, width: 2 };
}
