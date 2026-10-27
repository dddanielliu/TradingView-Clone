import { tvDash } from "./geometry";
import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { ResolvedEntry } from "./types";

/**
 * TradingView's geometric shapes beyond rectangle / ellipse / triangle /
 * arrow, ported from line-tool-arrow-marker, -arrow-mark, -rotated-rectangle,
 * -path, -circle, -poly-line, -arc, -bezier-quadro, -bezier-cubic and the
 * Highlighter in -brush. Anchors live in the point list.
 */

export type ShapeToolType =
  | "arrowmarker"
  | "arrowup"
  | "arrowdown"
  | "rotatedrect"
  | "path"
  | "circle"
  | "polyline"
  | "arc"
  | "curve"
  | "doublecurve";

// Factory defaults: colorTvBlue600, colorMintyGreen500, colorRipeRed600,
// colorIguanaGreen500, colorTvBlue500, colorTanOrange500, colorSkyBlue500,
// colorBerryPink500, colorDeepBlue500.
export const SHAPE_TOOLS: Record<ShapeToolType, { points: number; color: string; name: string }> = {
  arrowmarker: { points: 2, color: "#1e53e5", name: "Arrow marker" },
  arrowup: { points: 1, color: "#089981", name: "Arrow mark up" },
  arrowdown: { points: 1, color: "#cc2f3c", name: "Arrow mark down" },
  rotatedrect: { points: 3, color: "#4caf50", name: "Rotated rectangle" },
  path: { points: 0, color: "#2962ff", name: "Path" },
  circle: { points: 2, color: "#ff9800", name: "Circle" },
  polyline: { points: 0, color: "#00bcd4", name: "Polyline" },
  arc: { points: 3, color: "#e91e63", name: "Arc" },
  // Two clicks; the control points are added on commit (see controlPoints).
  curve: { points: 2, color: "#2962ff", name: "Curve" },
  doublecurve: { points: 2, color: "#673ab7", name: "Double curve" },
};

export function isShapeTool(type: string): type is ShapeToolType {
  return type in SHAPE_TOOLS;
}

type P = { x: number; y: number };
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const len = (a: P) => Math.hypot(a.x, a.y);
const norm = (a: P): P => scale(a, 1 / (len(a) || 1));

function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : hex;
}

/** Arrow head length for a given arrow length (TradingView's G()). */
function headSize(t: number): number {
  if (t < 92) return 18;
  return Math.min(Math.max(Math.min(0.25 * t, 106), 18), 0.9 * t);
}

export function renderShapeTool(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  const d = e.d;
  const pts = e.pts ?? [];
  if (pts.length === 0) return;
  const ctx = scope.context;
  ctx.save();
  ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
  const lw = d.width ?? 2;
  const fill = (alpha: number) => rgba(d.fillColor ?? d.color, d.fillOpacity ?? alpha);
  const stroke = () => {
    ctx.strokeStyle = d.color;
    ctx.lineWidth = lw;
    ctx.setLineDash(tvDash(d.lineStyle, lw));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const type = d.type as ShapeToolType;
  const [a, b, c] = pts;

  switch (type) {
    case "arrowmarker": {
      if (!b) break;
      let start = a!;
      let v = sub(b, start);
      if (len(v) < 22) {
        start = add(b, scale(norm(v), -22));
        v = sub(b, start);
      }
      const t = len(v);
      const g = headSize(t);
      const inset = t >= 35 ? 0.1 : 0;
      const geo: P[] = [{ x: 0, y: 0 }, { x: t - g + g * inset, y: (1.22 * g) / 4 }, { x: t - g, y: (1.22 * g) / 2 }, { x: t, y: 0 }];
      const o = norm(v);
      const n = norm({ x: v.y, y: -v.x });
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (const q of geo) {
        const p = add(add(start, scale(o, q.x)), scale(n, q.y));
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(b.x, b.y);
      for (let k = geo.length - 1; k >= 0; k--) {
        const q = geo[k]!;
        const p = add(add(start, scale(o, q.x)), scale(n, -q.y));
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, Math.min(5, Math.round(0.02 * t)));
      ctx.fillStyle = d.color;
      ctx.strokeStyle = d.color;
      ctx.stroke();
      ctx.fill();
      break;
    }
    case "arrowup":
    case "arrowdown": {
      // The 19.5 × 22px glyph, its tip on the point.
      const s = type === "arrowup" ? 1 : -1;
      const p = a!;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 9.75, p.y + s * 12);
      ctx.lineTo(p.x + 5, p.y + s * 12);
      ctx.lineTo(p.x + 5, p.y + s * 22);
      ctx.lineTo(p.x - 5, p.y + s * 22);
      ctx.lineTo(p.x - 5, p.y + s * 12);
      ctx.lineTo(p.x - 9.75, p.y + s * 12);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      if (d.text) {
        ctx.font = `14px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = s === 1 ? "top" : "bottom";
        ctx.fillText(d.text, p.x, p.y + s * 26);
      }
      break;
    }
    case "rotatedrect": {
      if (!b) break;
      if (!c) {
        ctx.beginPath();
        ctx.moveTo(a!.x, a!.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      // Half width = the third point's distance from the a–b axis.
      const axis = sub(b, a!);
      const off = scale(norm({ x: axis.y, y: -axis.x }), distToLine(c, a!, b));
      const poly = [add(a!, off), add(b, off), sub(b, off), sub(a!, off)];
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = fill(0.5);
      ctx.fill();
      stroke();
      break;
    }
    case "path":
    case "polyline": {
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      if (type === "polyline" && pts.length > 2) {
        ctx.closePath();
        ctx.fillStyle = fill(0.2);
        ctx.fill();
      }
      ctx.lineJoin = "round";
      stroke();
      // Path ends in an arrow (rightEnd: Arrow).
      if (type === "path" && pts.length >= 2) {
        const p1 = pts[pts.length - 2]!;
        const p2 = pts[pts.length - 1]!;
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const h = 4 + lw * 3;
        ctx.beginPath();
        ctx.moveTo(p2.x - h * Math.cos(ang - 0.45), p2.y - h * Math.sin(ang - 0.45));
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p2.x - h * Math.cos(ang + 0.45), p2.y - h * Math.sin(ang + 0.45));
        stroke();
      }
      break;
    }
    case "circle": {
      if (!b) break;
      const r = len(sub(b, a!));
      ctx.beginPath();
      ctx.arc(a!.x, a!.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = fill(0.2);
      ctx.fill();
      stroke();
      break;
    }
    case "arc": {
      if (!b) break;
      if (!c || distToLine(c, a!, b) < 1) {
        ctx.beginPath();
        ctx.moveTo(a!.x, a!.y);
        ctx.lineTo(b.x, b.y);
        stroke();
        break;
      }
      // Half an ellipse on the chord a–b, as deep as the third point is far from it.
      const chord = sub(b, a!);
      const mid = scale(add(a!, b), 0.5);
      const depth = distToLine(c, a!, b);
      const side = Math.sign(cross(chord, sub(c, a!))) || 1;
      const ang = Math.atan2(chord.y, chord.x);
      ctx.beginPath();
      ctx.ellipse(mid.x, mid.y, len(chord) / 2, depth, ang, 0, Math.PI, side < 0);
      ctx.closePath();
      ctx.fillStyle = fill(0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(mid.x, mid.y, len(chord) / 2, depth, ang, 0, Math.PI, side < 0);
      stroke();
      break;
    }
    case "curve":
    case "doublecurve": {
      if (!b) break;
      ctx.beginPath();
      if (!c) {
        // While placing: a straight line until the control points exist.
        ctx.moveTo(a!.x, a!.y);
        ctx.lineTo(b.x, b.y);
      } else {
        traceCurve(ctx, curvePath(type, a!, b, c, pts[3]));
      }
      ctx.lineCap = "round";
      stroke();
      break;
    }
  }
  ctx.restore();
}

function cross(a: P, b: P): number {
  return a.x * b.y - a.y * b.x;
}

function distToLine(p: P, a: P, b: P): number {
  const v = sub(b, a);
  return Math.abs(cross(v, sub(p, a))) / (len(v) || 1);
}

// TradingView's Point.transposed(): (−y, x).
const transposed = (v: P): P => ({ x: -v.y, y: v.x });

/**
 * The on-curve points a new curve gets (TradingView's _calculateControlPoint(s)):
 * Curve, the chord's middle pushed sideways by 0.3 of its half; Double curve,
 * 0.33 and 0.67 × (a + b) (sic) pushed either way.
 */
export function controlPoints(type: string, a: P, b: P): P[] {
  const side = scale(transposed(scale(sub(b, a), 0.5)), 0.3);
  if (type === "curve") return [add(scale(add(a, b), 0.5), side)];
  if (type === "doublecurve") return [add(scale(add(a, b), 0.33), side), sub(scale(add(a, b), 0.67), side)];
  return [];
}

type Seg = { kind: "quad"; c: P; to: P } | { kind: "cubic"; c1: P; c2: P; to: P };

/**
 * The curve as segments through its middle point(s), each with tangent
 * handles a quarter of the chord either side (quadro/cubicBezierControlPoints).
 */
export function curvePath(type: string, a: P, b: P, c: P, d?: P): { from: P; segs: Seg[] } {
  if (type === "doublecurve" && d) {
    const r = sub(d, a);
    const o = sub(b, c);
    const s1 = sub(c, scale(r, 0.25));
    const o1 = add(c, scale(r, 0.25));
    const l1 = sub(d, scale(o, 0.25));
    const a1 = add(d, scale(o, 0.25));
    return { from: a, segs: [{ kind: "quad", c: s1, to: c }, { kind: "cubic", c1: o1, c2: l1, to: d }, { kind: "quad", c: a1, to: b }] };
  }
  const i = sub(b, a);
  return { from: a, segs: [{ kind: "quad", c: sub(c, scale(i, 0.25)), to: c }, { kind: "quad", c: add(c, scale(i, 0.25)), to: b }] };
}

function traceCurve(ctx: CanvasRenderingContext2D, path: { from: P; segs: Seg[] }): void {
  ctx.moveTo(path.from.x, path.from.y);
  for (const s of path.segs) {
    if (s.kind === "quad") ctx.quadraticCurveTo(s.c.x, s.c.y, s.to.x, s.to.y);
    else ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y);
  }
}

/** Samples the curve (as TradingView's hit test does, ~3px steps). */
export function sampleCurve(path: { from: P; segs: Seg[] }): P[] {
  const out: P[] = [path.from];
  let from = path.from;
  for (const s of path.segs) {
    const pts = s.kind === "quad" ? [from, s.c, s.to] : [from, s.c1, s.c2, s.to];
    let lenApprox = 0;
    for (let k = 1; k < pts.length; k++) lenApprox += len(sub(pts[k]!, pts[k - 1]!));
    const step = Math.max(3 / (lenApprox || 1), 0.02);
    for (let t = step; ; t += step) {
      const u = Math.min(1, t);
      out.push(
        s.kind === "quad"
          ? add(add(scale(from, (1 - u) * (1 - u)), scale(s.c, 2 * u * (1 - u))), scale(s.to, u * u))
          : add(
              add(scale(from, (1 - u) ** 3), scale(s.c1, 3 * (1 - u) ** 2 * u)),
              add(scale(s.c2, 3 * (1 - u) * u * u), scale(s.to, u ** 3)),
            ),
      );
      if (u >= 1) break;
    }
    from = s.to;
  }
  return out;
}
