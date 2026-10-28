/**
 * The Gann box's Shift snapping (LineToolGannSquare._alignPointsFixedIncrement):
 * the price distance from the other point snaps to 4.5 / 9 / 11.25 / 18 /
 * 22.5 / 36 / 45 at the right power of ten, the bar distance to the same
 * steps as whole bars.
 */

const STEPS = [4.5, 9, 11.25, 18, 22.5, 36, 45];

const BAR_STEPS: number[] = (() => {
  const out: number[] = [];
  const last = STEPS.length - 1;
  let mult = 1;
  let i = 0;
  let v = 0;
  while (v < 1e10) {
    v = STEPS[i]! * mult;
    out.push(Math.round(v));
    out.push(Math.ceil(-v));
    if (i === last - 1) mult *= 10;
    i = (i + 1) % last;
  }
  return out.sort((a, b) => a - b);
})();

export function alignGannPrice(price: number, ref: number): number {
  const diff = Math.round(1e6 * (price - ref)) / 1e6;
  if (diff === 0) return price;
  const lo = STEPS[0]!;
  const hi = STEPS[STEPS.length - 1]!;
  let k = 1;
  const a = Math.abs(diff);
  while (a < lo * k || hi * k < a) {
    if (a < lo * k) k *= 0.1;
    else if (hi * k < a) k *= 10;
  }
  let step = hi * k;
  for (let i = STEPS.length - 2; i >= 0 && !(STEPS[i]! * k < a); --i) step = STEPS[i]! * k;
  return ref + (diff >= 0 ? step : -step);
}

export function alignGannIndex(index: number, ref: number): number {
  const diff = index - ref;
  if (diff === 0) return index;
  let r = BAR_STEPS.length - 2;
  while (r >= 0 && !(BAR_STEPS[r]! < diff)) --r;
  r += diff > 0 ? 1 : 0;
  return ref + BAR_STEPS[r]!;
}

// ── Gann square / Gann square fixed (line-tool-gann-complex / -gann-fixed) ──

type P = { x: number; y: number };

const GRAY = "#808080";
const ORANGE = "#ff9800";
const SKY = "#00bcd4";
const IGUANA = "#4caf50";
const MINTY = "#089981";
const BLUE = "#2962ff";
const DEEP200 = "#b39ddb";
const DEEP300 = "#9575cd";
const RED = "#f23645";

/** gannLevelsDefaults: grid lines at index / 5, all shown. */
export const GANN_LEVELS = [GRAY, ORANGE, SKY, IGUANA, MINTY, GRAY];
/** gannFanlinesDefaults: [x, y, colour, visible]. */
export const GANN_FANLINES: [number, number, string, boolean][] = [
  [8, 1, DEEP200, false], [5, 1, RED, false], [4, 1, GRAY, false], [3, 1, ORANGE, false], [2, 1, SKY, true],
  [1, 1, IGUANA, true], [1, 2, MINTY, true], [1, 3, MINTY, false], [1, 4, BLUE, false], [1, 5, DEEP300, false],
  [1, 8, DEEP200, false],
];
/** gannArcsDefaults: [x, y, colour], all shown. */
export const GANN_ARCS: [number, number, string][] = [
  [1, 0, ORANGE], [1, 1, ORANGE], [1.5, 0, ORANGE], [2, 0, SKY], [2, 1, SKY], [3, 0, IGUANA], [3, 1, IGUANA],
  [4, 0, MINTY], [4, 1, MINTY], [5, 0, BLUE], [5, 1, BLUE],
];
const ARC_FILL_ALPHA = 0.2; // transparency 80

/**
 * The box a Gann square spans, in pane px. Fixed: a square 5 × the distance
 * between its points, toward the second; Gann square: first to second point
 * (swapped when reversed).
 */
export function gannBox(type: "gannfixed" | "gannsquare", a: P, b: P, reverse: boolean): { start: P; end: P } | null {
  if (type === "gannsquare") return reverse ? { start: b, end: a } : { start: a, end: b };
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d <= 0) return null;
  const sx = b.x - a.x < 0 ? -1 : 1;
  const sy = b.y - a.y < 0 ? -1 : 1;
  return { start: a, end: { x: a.x + 5 * d * sx, y: a.y + 5 * d * sy } };
}

interface Seg {
  a: P;
  b: P;
  color: string;
}

function gannLines(start: P, end: P): Seg[] {
  const bw = end.x - start.x;
  const ph = end.y - start.y;
  const out: Seg[] = [];
  GANN_LEVELS.forEach((color, i) => {
    const k = i / 5;
    out.push({ a: { x: start.x + k * bw, y: start.y }, b: { x: start.x + k * bw, y: end.y }, color });
    out.push({ a: { x: start.x, y: start.y + k * ph }, b: { x: end.x, y: start.y + k * ph }, color });
  });
  for (const [x, y, color, visible] of GANN_FANLINES) {
    if (!visible) continue;
    const to = x > y ? { x: end.x, y: start.y + (y / x) * ph } : { x: start.x + (x / y) * bw, y: end.y };
    out.push({ a: start, b: to, color });
  }
  return out;
}

/** GannArcRenderer: quarter ellipses in the box's quadrant, banded fills between them. */
function drawGannArc(ctx: CanvasRenderingContext2D, center: P, point: P, prev: P, edge: P, color: string, lw: number): void {
  const e = { x: edge.x - center.x, y: edge.y - center.y };
  if (e.x === 0 || e.y === 0) return;
  const n = e.y / e.x;
  let s = Math.hypot(point.x - center.x, (point.y - center.y) / n);
  let c = Math.hypot(prev.x - center.x, (prev.y - center.y) / n);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.scale(1, n);
  const p = Math.abs(e.x);
  if (Math.abs(s) > p) {
    const side = Math.sign(e.x) * p;
    ctx.beginPath();
    ctx.rect(0, 0, side, side);
    ctx.clip();
  }
  if (point.x < center.x) {
    s = -s;
    c = -c;
  }
  ctx.beginPath();
  ctx.moveTo(c, 0);
  ctx.lineTo(s, 0);
  ctx.arcTo(s, s, 0, s, Math.abs(s));
  ctx.lineTo(0, c);
  ctx.arcTo(c, c, c, 0, Math.abs(c));
  ctx.fillStyle = hexAlpha(color, ARC_FILL_ALPHA);
  ctx.fill();
  ctx.beginPath();
  if (point.x > center.x) ctx.arc(0, 0, Math.abs(s), 0, Math.PI / 2, false);
  else ctx.arc(0, 0, Math.abs(s), -Math.PI / 2, -Math.PI, true);
  // Stroke unscaled, still clipped to the box.
  ctx.scale(1, 1 / n);
  ctx.lineCap = "butt";
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.restore();
}

function hexAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${a})` : hex;
}

function arcPoints(start: P, end: P): { point: P; color: string }[] {
  const bw = end.x - start.x;
  const ph = end.y - start.y;
  return GANN_ARCS.map(([x, y, color]) => ({ point: { x: start.x + (x / 5) * bw, y: start.y + (y / 5) * ph }, color }));
}

/** Draws levels, fans and arcs (media px); line width 2 as the factory levels. */
export function drawGannSquare(ctx: CanvasRenderingContext2D, start: P, end: P, firstPoint: P): void {
  const lw = 2;
  for (const s of gannLines(start, end)) {
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  let prev = firstPoint;
  for (const { point, color } of arcPoints(start, end)) {
    drawGannArc(ctx, start, point, prev, end, color, lw);
    prev = point;
  }
}

function distToSeg(p: P, a: P, b: P): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

/** True when the pointer is on a level / fan line, on an arc, or in an arc band. */
export function hitGannSquare(p: P, start: P, end: P, firstPoint: P, lineTol: number, curveTol: number): boolean {
  for (const s of gannLines(start, end)) if (distToSeg(p, s.a, s.b) <= lineTol) return true;
  const e = { x: end.x - start.x, y: end.y - start.y };
  if (e.x === 0 || e.y === 0) return false;
  const l = { x: p.x - start.x, y: p.y - start.y };
  const inQuadrant = (v: P) => {
    const i = v.x * Math.sign(e.x);
    const r = v.y * Math.sign(e.y);
    return i >= 0 && i <= Math.abs(e.x) && r >= 0 && r <= Math.abs(e.y);
  };
  if (!inQuadrant(l)) return false;
  const n = e.y / e.x;
  const u = Math.hypot(l.x, l.y / n);
  let prev = firstPoint;
  for (const { point } of arcPoints(start, end)) {
    const rad = Math.hypot(point.x - start.x, (point.y - start.y) / n);
    if (Math.abs(u - rad) <= curveTol) return true;
    const prevRad = Math.hypot(prev.x - start.x, (prev.y - start.y) / n);
    if (u >= prevRad && u <= rad) return true;
    prev = point;
  }
  return false;
}
