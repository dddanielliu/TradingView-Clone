import { tvDash } from "./geometry";
import { drawGannSquare, gannBox } from "./gann";
import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawCtxInfo, ResolvedEntry } from "./types";

/**
 * TradingView's Gann and Fibonacci tools, ported from their modules
 * (line-tool-trend-based-fib-extension, -fib-channel, -fib-timezone,
 * -fib-speed-resistance-fan, -trend-based-fib-time, -fib-circles,
 * -fib-spiral, -fib-speed-resistance-arcs, -fib-wedge, -pitchfork
 * (Pitchfan), -gann-square, -gann-fixed, -gann-complex, -gann-fan) with their
 * factory default levels and colours. Anchors live in the point list.
 */

export type FibToolType =
  | "fibextension3"
  | "fibchannel"
  | "fibtimezone"
  | "fibspeedfan"
  | "fibtime"
  | "fibcircles"
  | "fibspiral"
  | "fibarcs"
  | "fibwedge"
  | "pitchfan"
  | "gannbox"
  | "gannfixed"
  | "gannsquare"
  | "gannfan";

export const FIB_TOOLS: Record<FibToolType, { points: number; color: string; name: string }> = {
  fibextension3: { points: 3, color: "#808080", name: "Trend-based fib extension" },
  fibchannel: { points: 3, color: "#808080", name: "Fib channel" },
  fibtimezone: { points: 2, color: "#2962ff", name: "Fib time zone" },
  fibspeedfan: { points: 2, color: "#2962ff", name: "Fib speed resistance fan" },
  fibtime: { points: 3, color: "#808080", name: "Trend-based fib time" },
  fibcircles: { points: 2, color: "#808080", name: "Fib circles" },
  fibspiral: { points: 2, color: "#00bcd4", name: "Fib spiral" },
  fibarcs: { points: 2, color: "#808080", name: "Fib speed resistance arcs" },
  fibwedge: { points: 3, color: "#808080", name: "Fib wedge" },
  pitchfan: { points: 3, color: "#f23645", name: "Pitchfan" },
  gannbox: { points: 2, color: "#808080", name: "Gann box" },
  gannfixed: { points: 2, color: "#808080", name: "Gann square fixed" },
  gannsquare: { points: 2, color: "#808080", name: "Gann square" },
  gannfan: { points: 2, color: "#2962ff", name: "Gann fan" },
};

export function isFibTool(type: string): type is FibToolType {
  return type in FIB_TOOLS;
}

// TradingView palette names used by these defaults.
const GRAY = "#808080";
const RED = "#f23645";
const ORANGE = "#ff9800";
const IGUANA = "#4caf50";
const IGUANA300 = "#81c784";
const MINTY = "#089981";
const SKY = "#00bcd4";
const BLUE = "#2962ff";
const PURPLE = "#9c27b0";
const PINK = "#e91e63";
const DEEP = "#673ab7";
const DEEP200 = "#b39ddb";
const DEEP300 = "#9575cd";

/** [coeff, visible, colour] — the fib retracement / extension / channel table. */
export const FIB_LEVELS_TV: [number, boolean, string][] = [
  [0, true, GRAY],
  [0.236, true, RED],
  [0.382, true, ORANGE],
  [0.5, true, IGUANA],
  [0.618, true, MINTY],
  [0.786, true, SKY],
  [1, true, GRAY],
  [1.618, true, BLUE],
  [2.618, true, RED],
  [3.618, true, PURPLE],
  [4.236, true, PINK],
  [1.272, false, ORANGE],
  [1.414, false, RED],
  [2.272, false, ORANGE],
  [2.414, false, IGUANA],
  [2, false, MINTY],
  [3, false, SKY],
  [3.272, false, GRAY],
  [3.414, false, BLUE],
  [4, false, RED],
  [4.272, false, PURPLE],
  [4.414, false, PINK],
  [4.618, false, ORANGE],
  [4.764, false, MINTY],
];
const FIB_VISIBLE = FIB_LEVELS_TV.filter((l) => l[1]);

// Circles / speed arcs: 11 levels, all shown.
const CIRCLE_LEVELS: [number, string][] = [
  [0.236, RED], [0.382, ORANGE], [0.5, MINTY], [0.618, IGUANA], [0.786, SKY], [1, GRAY],
  [1.618, BLUE], [2.618, PINK], [3.618, BLUE], [4.236, PINK], [4.618, RED],
];
// Wedge: the first six shown.
const WEDGE_LEVELS: [number, boolean, string][] = [
  [0.236, true, RED], [0.382, true, ORANGE], [0.5, true, IGUANA], [0.618, true, MINTY], [0.786, true, SKY],
  [1, true, GRAY], [1.618, false, BLUE], [2.618, false, RED], [3.618, false, DEEP], [4.236, false, PINK], [4.618, false, PINK],
];
// Trend-based fib time: coeff, visible, colour.
const TIME_LEVELS: [number, boolean, string][] = [
  [0, true, GRAY], [0.382, true, RED], [0.5, false, IGUANA300], [0.618, true, IGUANA], [1, true, MINTY], [1.382, true, SKY],
  [1.618, true, GRAY], [2, true, BLUE], [2.382, true, PINK], [2.618, true, PURPLE], [3, true, DEEP],
];
const TIMEZONE_COEFFS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
// Speed resistance fan / Gann box: 7 levels each way.
const SPEED_LEVELS: [number, string][] = [[0, GRAY], [0.25, ORANGE], [0.382, SKY], [0.5, IGUANA], [0.618, MINTY], [0.75, BLUE], [1, GRAY]];
const GANN_BOX_LEVELS: [number, string][] = [[0, GRAY], [0.25, ORANGE], [0.382, SKY], [0.5, IGUANA], [0.618, MINTY], [0.75, BLUE], [1, GRAY]];
// Gann fan: coeff1 / coeff2 and colour.
const GANN_FAN: [number, number, string][] = [
  [1, 8, ORANGE], [1, 4, MINTY], [1, 3, IGUANA], [1, 2, MINTY], [1, 1, SKY], [2, 1, BLUE], [3, 1, PURPLE], [4, 1, PINK], [8, 1, RED],
];
void DEEP200;
void DEEP300;

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const FAR = 100_000;
type P = { x: number; y: number };
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const len = (a: P) => Math.hypot(a.x, a.y);

function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : hex;
}
/** Every TradingView fib fill: transparency 80. */
const FILL = 0.2;
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

export function renderFibTool(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry, info: DrawCtxInfo): void {
  const d = e.d;
  const pts = e.pts ?? [];
  if (pts.length === 0) return;
  const ctx = scope.context;
  ctx.save();
  ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
  const W = scope.mediaSize.width;
  const H = scope.mediaSize.height;
  const lw = d.width ?? 2;
  const line = (a: P, b: P, color: string, w = lw, dash: number[] = []) => {
    ctx.beginPath();
    ctx.setLineDash(dash);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const poly = (ps: P[], color: string) => {
    ctx.beginPath();
    ctx.moveTo(ps[0]!.x, ps[0]!.y);
    for (const p of ps.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  const text = (p: P, s: string, color: string, align: CanvasTextAlign, base: CanvasTextBaseline) => {
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = base;
    ctx.fillText(s, p.x, p.y);
  };
  const ray = (a: P, b: P): P => {
    const v = sub(b, a);
    const l = len(v) || 1;
    return add(a, scale(v, FAR / l));
  };
  const dashed = [6, 4];
  const prices = (d.points ?? []).map((p) => p.price);
  const times = (d.points ?? []).map((p) => p.time);
  const yOf = (price: number) => info.priceToY?.(price) ?? null;
  const type = d.type as FibToolType;
  const [p0, p1, p2] = pts;

  // Bar index ↔ x, extrapolating past the loaded bars on the bar spacing.
  const bars = info.bars();
  const idxOf = (t: number) => {
    let lo = 0;
    let hi = bars.length - 1;
    if (bars.length === 0) return 0;
    if (t >= bars[hi]!.time) return hi + Math.round((t - bars[hi]!.time) / step());
    if (t <= bars[0]!.time) return Math.round((t - bars[0]!.time) / step());
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (bars[m]!.time < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const step = () => (bars.length > 1 ? bars[bars.length - 1]!.time - bars[bars.length - 2]!.time : 60);
  const xOfIdx = (i: number) => {
    if (bars.length === 0) return null;
    const last = bars.length - 1;
    const t = i <= last && i >= 0 ? bars[i]!.time : i > last ? bars[last]!.time + (i - last) * step() : bars[0]!.time + i * step();
    return info.timeToX(t);
  };

  switch (type) {
    case "fibextension3": {
      if (p1) line(p0!, p1, GRAY, lw, dashed);
      if (!p1 || !p2) break;
      line(p1, p2, GRAY, lw, dashed);
      const range = prices[1]! - prices[0]!;
      const left = Math.min(p1.x, p2.x);
      const right = Math.max(p1.x, p2.x);
      horizontalLevels(FIB_VISIBLE.map(([c, , col]) => ({ c, col, y: yOf(prices[2]! + range * c) })), left, right);
      break;
    }
    case "fibchannel": {
      if (!p1) break;
      if (!p2) {
        line(p0!, p1, GRAY);
        break;
      }
      const norm = sub(p2, p0!);
      let prev: { a: P; b: P } | null = null;
      for (const [c, , col] of FIB_VISIBLE) {
        const a = add(p0!, scale(norm, c));
        const b = add(p1, scale(norm, c));
        if (prev) poly([prev.a, prev.b, b, a], rgba(col, FILL));
        line(a, b, col);
        const price = prices[0]! + (prices[2]! - prices[0]!) * c;
        text({ x: Math.min(a.x, b.x) - 4, y: a.x < b.x ? a.y : b.y }, `${fmt(c)}(${info.priceFormat(price)})`, col, "right", "middle");
        prev = { a, b };
      }
      break;
    }
    case "fibtimezone": {
      const i0 = idxOf(times[0]!);
      const span = times[1] != null ? idxOf(times[1]) - i0 : 1;
      TIMEZONE_COEFFS.forEach((c, k) => {
        const x = xOfIdx(Math.round(i0 + c * span));
        if (x === null) return;
        const col = k === 0 ? GRAY : BLUE;
        line({ x, y: 0 }, { x, y: H }, col);
        text({ x: x + 2, y: H - 2 }, String(c), col, "left", "bottom");
      });
      if (p1) line(p0!, p1, GRAY, 1, dashed);
      break;
    }
    case "fibtime": {
      if (p1) line(p0!, p1, GRAY, lw, dashed);
      if (!p1 || !p2) break;
      line(p1, p2, GRAY, lw, dashed);
      const span = idxOf(times[1]!) - idxOf(times[0]!);
      const base = idxOf(times[2]!);
      let prevX: number | null = null;
      for (const [c, vis, col] of TIME_LEVELS) {
        if (!vis) continue;
        const x = xOfIdx(Math.round(base + c * span));
        if (x === null) continue;
        if (prevX !== null) poly([{ x: prevX, y: 0 }, { x, y: 0 }, { x, y: H }, { x: prevX, y: H }], rgba(col, FILL));
        line({ x, y: 0 }, { x, y: H }, col);
        text({ x: x + 2, y: H - 2 }, fmt(c), col, "left", "bottom");
        prevX = x;
      }
      break;
    }
    case "gannbox": {
      if (!p1) break;
      // line-tool-gann-square ("Gann box"): 7 + 7 levels measured from the
      // first point (the second with Reverse), vertical ones on whole bars.
      const rev = d.reverse === true;
      const span = rev ? prices[0]! - prices[1]! : prices[1]! - prices[0]!;
      const base = rev ? prices[1]! : prices[0]!;
      const i0 = idxOf(times[0]!);
      const i1 = idxOf(times[1]!);
      const ispan = rev ? i0 - i1 : i1 - i0;
      const ibase = rev ? i1 : i0;
      const hl = GANN_BOX_LEVELS.map(([c, col]) => ({ c, col, y: yOf(base + c * span) }));
      const vl = GANN_BOX_LEVELS.map(([c, col]) => ({ c, col, x: xOfIdx(Math.round(ibase + c * ispan)) }));
      const l = Math.min(p0!.x, p1.x);
      const r = Math.max(p0!.x, p1.x);
      const t = Math.min(p0!.y, p1.y);
      const b = Math.max(p0!.y, p1.y);
      const gfill = 1 - 80 / 100;
      hl.forEach((h, k) => {
        if (h.y === null) return;
        const prevY = k > 0 ? hl[k - 1]!.y : null;
        if (prevY !== null) poly([{ x: l, y: h.y }, { x: r, y: h.y }, { x: r, y: prevY }, { x: l, y: prevY }], rgba(h.col, gfill));
        line({ x: l, y: h.y }, { x: r, y: h.y }, h.col, lw, tvDash(d.lineStyle, lw));
        text({ x: l - 5, y: h.y }, fmt(h.c), h.col, "right", "middle");
        text({ x: r + 5, y: h.y }, fmt(h.c), h.col, "left", "middle");
      });
      vl.forEach((v, k) => {
        if (v.x === null) return;
        const prevX = k > 0 ? vl[k - 1]!.x : null;
        if (prevX !== null) poly([{ x: prevX, y: t }, { x: v.x, y: t }, { x: v.x, y: b }, { x: prevX, y: b }], rgba(v.col, gfill));
        line({ x: v.x, y: t }, { x: v.x, y: b }, v.col, lw, tvDash(d.lineStyle, lw));
        text({ x: v.x, y: t - 3 }, fmt(v.c), v.col, "center", "bottom");
        text({ x: v.x, y: b + 5 }, fmt(v.c), v.col, "center", "top");
      });
      break;
    }
    case "fibspeedfan": {
      if (!p1) break;
      // line-tool-fib-speed-resistance-fan: 7 price and 7 bar levels between
      // the points (1 at the first, 0 at the second; swapped by Reverse), a
      // 1px grid over the box, and rays from the first point through each
      // level on the second point's edges, the wedges between them filled.
      const fan = speedFanLevels(d.reverse === true);
      const i0 = idxOf(times[0]!);
      const i1 = idxOf(times[1]!);
      const hs = fan.map(({ c, col }) => ({ c, col, y: yOf(fan.priceAt(prices[0]!, prices[1]!, c)) }));
      const vs = fan.map(({ c, col }) => ({ c, col, x: xOfIdx(Math.round(fan.priceAt(i0, i1, c))) }));
      const l = Math.min(p0!.x, p1.x);
      const r = Math.max(p0!.x, p1.x);
      const t = Math.min(p0!.y, p1.y);
      const b = Math.max(p0!.y, p1.y);
      const GRID = "rgba(21, 56, 153, 0.8)";
      for (const h of hs) {
        if (h.y === null) continue;
        line({ x: l, y: h.y }, { x: r, y: h.y }, GRID, 1);
        text({ x: l - 5, y: h.y }, fmt(h.c), h.col, "right", "middle");
        text({ x: r + 5, y: h.y }, fmt(h.c), h.col, "left", "middle");
      }
      for (const v of vs) {
        if (v.x === null) continue;
        line({ x: v.x, y: t }, { x: v.x, y: b }, GRID, 1);
        text({ x: v.x, y: t - 5 }, fmt(v.c), v.col, "center", "bottom");
        text({ x: v.x, y: b + 5 }, fmt(v.c), v.col, "center", "top");
      }
      const style = tvDash(d.lineStyle, lw);
      let prev: P | null = null;
      for (const h of hs) {
        if (h.y === null) continue;
        const end: P = { x: p1.x, y: h.y };
        if (prev) poly([p0!, ray(p0!, prev), ray(p0!, end)], rgba(h.col, FILL));
        line(p0!, ray(p0!, end), h.col, lw, style);
        prev = end;
      }
      prev = null;
      for (const v of vs) {
        if (v.x === null) continue;
        const end: P = { x: v.x, y: p1.y };
        if (prev) poly([p0!, ray(p0!, prev), ray(p0!, end)], rgba(v.col, FILL));
        line(p0!, ray(p0!, end), v.col, lw, style);
        prev = end;
      }
      break;
    }
    case "fibcircles": {
      if (!p1) break;
      // line-tool-fib-circles: ellipses about the points' midpoint, each the
      // points' box scaled by its level; rings filled between them.
      const c = scale(add(p0!, p1), 0.5);
      const w = Math.abs(p1.x - p0!.x);
      const h = Math.abs(p1.y - p0!.y);
      let prev: { rx: number; ry: number } | null = null;
      for (const [k, col] of CIRCLE_LEVELS) {
        const rx = 0.5 * w * k;
        const ry = 0.5 * h * k;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rx, ry, 0, 0, 2 * Math.PI);
        if (prev) ctx.ellipse(c.x, c.y, prev.rx, prev.ry, 0, 2 * Math.PI, 0, true);
        ctx.fillStyle = rgba(col, FILL);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rx, ry, 0, 0, 2 * Math.PI);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.stroke();
        text({ x: c.x + 4, y: c.y + ry }, fmt(k), col, "left", "middle");
        prev = { rx, ry };
      }
      line(p0!, p1, GRAY, lw, tvDash("dashed", lw));
      break;
    }
    case "fibarcs": {
      if (!p1) break;
      // line-tool-fib-speed-resistance-arcs: half circles about the first
      // point, on the side (up / down) of the second.
      const rad = len(sub(p1, p0!));
      const dir = Math.sign(p1.y - p0!.y);
      let prevR: number | null = null;
      for (const [k, col] of CIRCLE_LEVELS) {
        const r = Math.abs(rad * k);
        ctx.beginPath();
        if (dir > 0) ctx.arc(p0!.x, p0!.y, r, 0, Math.PI, false);
        else ctx.arc(p0!.x, p0!.y, r, Math.PI, 0, false);
        ctx.lineCap = "round";
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.stroke();
        if (prevR !== null) {
          if (dir > 0) ctx.arc(p0!.x, p0!.y, prevR, Math.PI, 0, true);
          else ctx.arc(p0!.x, p0!.y, prevR, 0, Math.PI, true);
        }
        ctx.fillStyle = rgba(col, FILL);
        ctx.fill();
        text({ x: p0!.x + 4, y: p0!.y + dir * rad * Math.abs(k) }, fmt(k), col, "left", "middle");
        prevR = r;
      }
      line(p0!, p1, GRAY, lw, tvDash("dashed", lw));
      break;
    }
    case "fibspiral": {
      if (!p1) break;
      // line-tool-fib-spiral: a ray through both points, and the spiral out of
      // the first, aligned to the second, scaled so its radius 5 reaches it.
      const v = sub(p1, p0!);
      const far = { x: p1.x + v.x * 1e4, y: p1.y + v.y * 1e4 };
      const style = tvDash(d.lineStyle, lw);
      line(p0!, len(v) > 0 ? far : p1, d.color, lw, style);
      ctx.beginPath();
      for (const q of spiralPath(p0!, p1, d.counterclockwise === true)) ctx.lineTo(q.x, q.y);
      ctx.lineCap = "round";
      ctx.strokeStyle = d.color;
      ctx.lineWidth = lw;
      ctx.setLineDash(style);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "fibwedge": {
      if (!p1) break;
      line(p0!, p1, GRAY);
      if (!p2) break;
      line(p0!, p2, GRAY);
      const r1 = len(sub(p1, p0!));
      const a1 = Math.atan2(p1.y - p0!.y, p1.x - p0!.x);
      const a2 = Math.atan2(p2.y - p0!.y, p2.x - p0!.x);
      let sweep = a2 - a1;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      let prevR = 0;
      for (const [c, vis, col] of WEDGE_LEVELS) {
        if (!vis) continue;
        const r = r1 * c;
        ctx.beginPath();
        ctx.arc(p0!.x, p0!.y, r, a1, a1 + sweep, sweep < 0);
        ctx.arc(p0!.x, p0!.y, prevR, a1 + sweep, a1, sweep >= 0);
        ctx.closePath();
        ctx.fillStyle = rgba(col, FILL);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p0!.x, p0!.y, r, a1, a1 + sweep, sweep < 0);
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.stroke();
        text({ x: p0!.x + r * Math.cos(a1), y: p0!.y + r * Math.sin(a1) }, fmt(c), col, "left", "middle");
        prevR = r;
      }
      break;
    }
    case "pitchfan": {
      if (!p1) break;
      const m = p2 ? scale(add(p1, p2), 0.5) : p1;
      line(p0!, ray(p0!, m), RED);
      if (!p2) break;
      line(p1, p2, RED);
      const half = scale(sub(p2, p1), 0.5);
      let prev = 0;
      // Pitchfan level colours: 0.5 sky, 1 blue (the visible defaults).
      for (const [c, col] of [[0.5, SKY], [1, BLUE]] as [number, string][]) {
        for (const s of [1, -1]) {
          const a = add(m, scale(half, s * c));
          const pa = add(m, scale(half, s * prev));
          poly([p0!, ray(p0!, pa), ray(p0!, a)], rgba(col, FILL));
          line(p0!, ray(p0!, a), col);
        }
        prev = c;
      }
      break;
    }
    case "gannfixed":
    case "gannsquare": {
      if (!p1) break;
      const box = gannBox(type, p0!, p1, d.reverse === true);
      if (!box) break;
      drawGannSquare(ctx, box.start, box.end, box.start);
      if (type === "gannsquare" && d.points && d.points.length >= 2) {
        // Labels: price change, bar count and the price-per-bar ratio, in the last level's colour.
        let dp = d.points[1]!.price - d.points[0]!.price;
        let di = idxOf(d.points[1]!.time) - idxOf(d.points[0]!.time);
        if (d.reverse) {
          dp = -dp;
          di = -di;
        }
        const [a, b] = d.reverse ? [p1, p0!] : [p0!, p1];
        const label = (pt: P, s: string, h: "left" | "right", v: "top" | "bottom", oy: number) =>
          text({ x: pt.x + (h === "left" ? 10 : -10), y: pt.y + (v === "top" ? oy : -oy) }, s, GRAY, h, v);
        label({ x: a.x, y: b.y }, info.priceFormat(dp), di > 0 ? "right" : "left", dp > 0 ? "bottom" : "top", dp > 0 ? 8 : 10);
        label({ x: b.x, y: a.y }, String(di), di > 0 ? "left" : "right", dp > 0 ? "top" : "bottom", dp > 0 ? 10 : 8);
        if (di !== 0) {
          const ratio = Math.abs(dp / di);
          label(b, String(Number(ratio.toFixed(7))), di > 0 ? "left" : "right", dp > 0 ? "bottom" : "top", dp > 0 ? 8 : 10);
        }
      }
      break;
    }
    case "gannfan": {
      if (!p1) break;
      const dx = p1.x - p0!.x;
      const dy = p1.y - p0!.y;
      let prev: P | null = null;
      for (const [c1, c2, col] of GANN_FAN) {
        const end: P = { x: p0!.x + dx, y: p0!.y + (dy * c1) / c2 };
        if (prev) poly([p0!, ray(p0!, prev), ray(p0!, end)], rgba(col, FILL));
        line(p0!, ray(p0!, end), col);
        text(end, `${c1}/${c2}`, col, "left", "bottom");
        prev = end;
      }
      break;
    }
  }
  ctx.restore();

  function horizontalLevels(levels: { c: number; col: string; y: number | null }[], left: number, right: number) {
    let prevY: number | null = null;
    for (const { col, y } of levels) {
      if (y === null) continue;
      if (prevY !== null) poly([{ x: left, y: prevY }, { x: right, y: prevY }, { x: right, y }, { x: left, y }], rgba(col, FILL));
      prevY = y;
    }
    for (const { c, col, y } of levels) {
      if (y === null) continue;
      line({ x: left, y }, { x: right, y }, col);
      const price = info.priceFormat(prices[2]! + (prices[1]! - prices[0]!) * c);
      text({ x: left - 4, y }, `${fmt(c)}(${price})`, col, "right", "middle");
    }
  }
  void W;
}

const SPIRAL_FIB = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/** TradingView's _continiusFib: the Fibonacci series, eased between terms. */
function continuousFib(x: number): number | null {
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  if (hi >= SPIRAL_FIB.length) return null;
  const f = Math.pow(x - lo, 1.15);
  return SPIRAL_FIB[lo]! + (SPIRAL_FIB[hi]! - SPIRAL_FIB[lo]!) * f;
}

/** The spiral's polyline: 50 steps per term, π/100 a step. */
function spiralPath(a: P, b: P, ccw: boolean): P[] {
  const v = sub(b, a);
  const s = len(v);
  if (s === 0) return [];
  const rot = Math.atan2(v.y, v.x);
  const k = s / 5;
  const dir = ccw ? -1 : 1;
  const out: P[] = [{ x: a.x, y: a.y }];
  for (let e = 0; e < 50 * (SPIRAL_FIB.length - 1); e++) {
    const r = continuousFib(e / 50);
    if (r === null) break;
    const t = (dir * e * Math.PI) / 100;
    const x = Math.cos(t) * r * k;
    const y = Math.sin(t) * r * k;
    out.push({ x: a.x + x * Math.cos(rot) - y * Math.sin(rot), y: a.y + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  return out;
}

/** The spiral's own hit test: the radius at the pointer's angle, on each of 4 turns. */
export function hitSpiral(a: P, b: P, ccw: boolean, p: P, tol: number): boolean {
  const v = sub(b, a);
  const n = sub(p, a);
  const vl = len(v);
  const nl = len(n);
  if (vl === 0 || nl === 0) return false;
  const r = { x: v.x / vl, y: v.y / vl };
  const l = { x: n.x / nl, y: n.y / nl };
  let o = Math.acos(Math.max(-1, Math.min(1, r.x * l.x + r.y * l.y)));
  // transposed (−y, x) · l
  if (Math.asin(Math.max(-1, Math.min(1, -r.y * l.x + r.x * l.y))) < 0) o = 2 * Math.PI - o;
  const dir = ccw ? -1 : 1;
  for (let k = 0; k < 4; k++) {
    const t = (dir * o) / (0.5 * Math.PI);
    let rad = continuousFib(t + 4 * k);
    if (rad === null) continue;
    rad = (rad * vl) / 5;
    if (Math.abs(rad - nl) < tol) return true;
  }
  return false;
}

/** Fib speed resistance arcs' hit test: on an arc (its half), or inside the outermost. */
export function hitFibArcs(a: P, b: P, p: P, curveTol: number): "line" | "back" | null {
  const dir = Math.sign(b.y - a.y);
  if (Math.sign(p.y - a.y) !== dir) return null;
  const rad = len(sub(b, a));
  const dist = len(sub(p, a));
  let back = false;
  for (const [k] of CIRCLE_LEVELS) {
    const r = Math.abs(rad * k);
    if (Math.abs(dist - r) < curveTol) return "line";
    if (dist <= r + curveTol) back = true;
  }
  return back ? "back" : null;
}

/** Fib circles' hit test: on an ellipse, or inside the outermost (filled). */
export function hitFibCircles(a: P, b: P, p: P, curveTol: number): boolean {
  const c = scale(add(a, b), 0.5);
  const w = Math.abs(b.x - a.x) / 2;
  const h = Math.abs(b.y - a.y) / 2;
  if (w === 0 || h === 0) return false;
  const outer = CIRCLE_LEVELS[CIRCLE_LEVELS.length - 1]![0];
  const u = Math.hypot((p.x - c.x) / w, (p.y - c.y) / h);
  return u <= outer + curveTol / Math.min(w, h);
}

/** The speed fan's levels; priceAt maps a coefficient between the two values (index or price). */
function speedFanLevels(reverse: boolean) {
  const levels = SPEED_LEVELS.map(([c, col]) => ({ c, col }));
  return Object.assign(levels, {
    priceAt: (first: number, second: number, c: number) => (reverse ? first + c * (second - first) : second + c * (first - second)),
  });
}

/** The speed fan's hit test: a ray, or inside the fan of rays (its wedges are filled). */
export function hitSpeedFan(a: P, b: P, p: P, lineTol: number): boolean {
  const toward = (q: P) => Math.atan2(q.y - a.y, q.x - a.x);
  const rays: P[] = [];
  for (const [c] of SPEED_LEVELS) {
    rays.push({ x: b.x, y: b.y + c * (a.y - b.y) });
    rays.push({ x: b.x + c * (a.x - b.x), y: b.y });
  }
  for (const q of rays) {
    const v = sub(q, a);
    const l = len(v);
    if (l === 0) continue;
    // Distance to the ray from a through q.
    const t = Math.max(0, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / (l * l));
    if (Math.hypot(p.x - a.x - t * v.x, p.y - a.y - t * v.y) <= lineTol) return true;
  }
  // Inside: between the extreme rays, on the second point's side.
  const angles = rays.filter((q) => len(sub(q, a)) > 0).map(toward);
  const ap = toward(p);
  const ref = toward(b);
  const rel = (x: number) => Math.atan2(Math.sin(x - ref), Math.cos(x - ref));
  const lo = Math.min(...angles.map(rel));
  const hi = Math.max(...angles.map(rel));
  return rel(ap) >= lo && rel(ap) <= hi && Math.abs(rel(ap)) < Math.PI / 2 + 0.01;
}

/**
 * Rays from `a` through each target (a fan): hit on a ray, or between the
 * outermost rays ahead of `a` when the wedges are filled.
 */
export function hitRayFan(a: P, targets: P[], p: P, lineTol: number, filled: boolean): boolean {
  const dirs = targets.map((q) => sub(q, a)).filter((v) => len(v) > 0);
  for (const v of dirs) {
    const l = len(v);
    const t = Math.max(0, ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / (l * l));
    if (Math.hypot(p.x - a.x - t * v.x, p.y - a.y - t * v.y) <= lineTol) return true;
  }
  if (!filled || dirs.length < 2) return false;
  const ref = Math.atan2(dirs.reduce((s, v) => s + v.y / len(v), 0), dirs.reduce((s, v) => s + v.x / len(v), 0));
  const rel = (v: P) => Math.atan2(Math.sin(Math.atan2(v.y, v.x) - ref), Math.cos(Math.atan2(v.y, v.x) - ref));
  const angles = dirs.map(rel);
  const ap = rel(sub(p, a));
  return ap >= Math.min(...angles) && ap <= Math.max(...angles);
}

/** Pitchfan's rays: the median and each visible level both ways. */
export function pitchfanTargets(p1: P, p2: P): P[] {
  const m = scale(add(p1, p2), 0.5);
  const half = scale(sub(p2, p1), 0.5);
  const out = [m];
  for (const c of [0.5, 1]) out.push(add(m, scale(half, c)), add(m, scale(half, -c)));
  return out;
}
