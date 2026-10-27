import { firstPatternPrice, lastPatternPrice, modeValue } from "./barspattern";
import { optimalCandlestickWidth } from "./ghostfeed";
import { drawForecast, forecastStatus, tvTimeSpan } from "./forecast";
import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawCtxInfo, ResolvedEntry } from "./types";

/**
 * TradingView's forecasting, volume-based and measuring tools, ported from
 * line-tool-prediction, -bars-pattern, -ghost-feed, -projection,
 * -anchored-vwap, -volume-profile and line-range-tools. Anchors live in the
 * point list; `points: 0` means "click until double-click or Esc".
 */

export type MeasureToolType =
  | "forecast"
  | "barspattern"
  | "ghostfeed"
  | "sector"
  | "anchoredvwap"
  | "frvp"
  | "avp"
  | "pricerange"
  | "daterange"
  | "datepricerange";

export const MEASURE_TOOLS: Record<MeasureToolType, { points: number; color: string; name: string }> = {
  forecast: { points: 2, color: "#2962ff", name: "Position forecast" },
  barspattern: { points: 2, color: "#2962ff", name: "Bars pattern" },
  ghostfeed: { points: 0, color: "#2962ff", name: "Ghost feed" },
  sector: { points: 3, color: "#808080", name: "Sector" },
  anchoredvwap: { points: 1, color: "#2962ff", name: "Anchored VWAP" },
  frvp: { points: 2, color: "#2962ff", name: "Fixed range volume profile" },
  avp: { points: 1, color: "#2962ff", name: "Anchored volume profile" },
  pricerange: { points: 2, color: "#2962ff", name: "Price range" },
  daterange: { points: 2, color: "#2962ff", name: "Date range" },
  datepricerange: { points: 2, color: "#2962ff", name: "Date and price range" },
};

export function isMeasureTool(type: string): type is MeasureToolType {
  return type in MEASURE_TOOLS;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
type P = { x: number; y: number };

function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return String(Math.round(v));
}

/** TradingView's TimeSpanFormatter: "3d 4h", "2h 15m", "45m". */

/** Small seeded generator so a ghost feed keeps its shape between frames. */

export function renderMeasureTool(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry, info: DrawCtxInfo): void {
  const d = e.d;
  const pts = e.pts ?? [];
  if (pts.length === 0) return;
  const ctx = scope.context;
  ctx.save();
  ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
  const lw = d.width ?? 2;
  const type = d.type as MeasureToolType;
  const prices = (d.points ?? []).map((p) => p.price);
  const times = (d.points ?? []).map((p) => p.time);
  const bars = info.bars();
  const yOf = (p: number) => info.priceToY?.(p) ?? null;
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
  const arrowHead = (a: P, b: P, color: string) => {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 8 * Math.cos(ang - 0.5), b.y - 8 * Math.sin(ang - 0.5));
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 8 * Math.cos(ang + 0.5), b.y - 8 * Math.sin(ang + 0.5));
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  const box = (lines: string[], at: P, bg: string, fg: string, shadow = false) => {
    ctx.font = `12px ${FONT}`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const h = lines.length * 16 + 10;
    const x = at.x - w / 2;
    const y = at.y - h / 2;
    ctx.save();
    if (shadow) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, at.x, y + 5 + 16 * i + 8));
    return { w, h };
  };
  const inRange = (from: number, to: number) => bars.filter((b) => b.time >= Math.min(from, to) && b.time <= Math.max(from, to));

  switch (type) {
    case "pricerange":
    case "daterange":
    case "datepricerange": {
      const [a, b] = pts;
      if (!a || !b) break;
      ctx.fillStyle = "rgba(41, 98, 255, 0.2)";
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      const midY = Math.round((a.y + b.y) / 2);
      const midX = Math.round((a.x + b.x) / 2);
      // The arrows across the middle, with heads once the span is 25 × the line width.
      if (type !== "pricerange") {
        line({ x: a.x, y: midY }, { x: b.x, y: midY }, d.color);
        if (Math.abs(b.x - a.x) >= 25 * lw) arrowHead({ x: a.x, y: midY }, { x: b.x, y: midY }, d.color);
      }
      if (type !== "daterange") {
        line({ x: midX, y: a.y }, { x: midX, y: b.y }, d.color);
        if (Math.abs(b.y - a.y) >= 25 * lw) arrowHead({ x: midX, y: a.y }, { x: midX, y: b.y }, d.color);
      }
      const lines: string[] = [];
      if (type !== "daterange") {
        const dp = prices[1]! - prices[0]!;
        const ticks = info.tickSize > 0 ? Math.round(dp / info.tickSize) : 0;
        lines.push(`${dp < 0 ? "−" : ""}${info.priceFormat(Math.abs(dp))} (${((100 * dp) / Math.abs(prices[0]!)).toFixed(2)}%) ${ticks}`);
      }
      if (type !== "pricerange") {
        const range = inRange(times[0]!, times[1]!);
        const count = Math.max(0, range.length - 1) * Math.sign(times[1]! - times[0]! || 1);
        lines.push(`${count} bars, ${tvTimeSpan(times[1]! - times[0]!)}`);
        const vol = range.reduce((s, x) => s + (x.volume ?? 0), 0);
        if (vol > 0) lines.push(`Vol ${compact(vol)}`);
      }
      // Above the box when the price rose, else below.
      const up = prices[1]! > prices[0]!;
      const top = Math.min(a.y, b.y);
      const bottom = Math.max(a.y, b.y);
      const h = lines.length * 16 + 10;
      box(lines, { x: midX, y: up ? top - 8 - h / 2 : bottom + 8 + h / 2 }, "#ffffff", "#000000", true);
      break;
    }
    case "forecast": {
      const [a, b] = pts;
      if (!a || !b) break;
      const step = bars.length > 1 ? bars[bars.length - 1]!.time - bars[bars.length - 2]!.time : 60;
      drawForecast(ctx, {
        id: d.id,
        source: a,
        target: b,
        sourcePrice: prices[0]!,
        targetPrice: prices[1]!,
        sourceTime: times[0]!,
        targetTime: times[1]!,
        intraday: step < 86400,
        priceFormat: info.priceFormat,
        status: e.state === "preview" ? "waiting" : forecastStatus(bars, prices[0]!, { time: times[1]!, price: prices[1]! }),
        lineWidth: d.width ?? 2,
        paneWidth: scope.mediaSize.width,
      });
      break;
    }
    case "barspattern": {
      const [a, b] = pts;
      if (!a || !b) break;
      const pattern = d.pattern;
      if (!pattern || pattern.length === 0) {
        // No bars copied yet: TradingView's two verticals and the line between.
        line({ x: a.x, y: 0 }, { x: a.x, y: scope.mediaSize.height }, "#808080", 1);
        line({ x: b.x, y: 0 }, { x: b.x, y: scope.mediaSize.height }, "#808080", 1);
        line(a, b, "#808080", 1);
        break;
      }
      const mode = d.barsMode ?? "bars";
      const flipped = d.flipped === true;
      const n = pattern.length;
      const step = n > 1 ? Math.abs(a.x - b.x) / (n - 1) : 0;
      const yF = yOf(firstPatternPrice(pattern, mode, flipped));
      const yL = yOf(lastPatternPrice(pattern, mode, flipped));
      if (yF === null || yL === null) break;
      const patternDiff = yL - yF;
      const scaleY = patternDiff ? +((b.y - a.y) / patternDiff).toFixed(8) : 1;
      const yAt = (price: number) => {
        const y = yOf(price);
        return y === null ? null : y * scaleY + (a.y - yF * scaleY);
      };
      const col = rgba(d.color, 0.9); // transparency 10
      if (mode === "bars" || mode === "openclose") {
        pattern.forEach((bar, i) => {
          const [v0, v1] = modeValue(bar, mode) as [number, number];
          const y0 = yAt(v0);
          const y1 = yAt(v1);
          if (y0 === null || y1 === null) return;
          const x = Math.round(a.x + i * step + 0.5);
          const top = Math.min(Math.round(y0), Math.round(y1));
          const h = Math.abs(Math.round(y1) - Math.round(y0));
          ctx.fillStyle = col;
          ctx.fillRect(x - 1, top, 2, h);
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 1 + 0.5, top + 0.5, 1, Math.max(0, h - 1));
        });
      } else {
        ctx.beginPath();
        pattern.forEach((bar, i) => {
          const y = yAt(modeValue(bar, mode) as number);
          if (y === null) return;
          const x = Math.round(a.x + i * step + 0.5);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      break;
    }
    case "ghostfeed": {
      // The legs in cold gray, then each leg's stored bars on the bar grid,
      // offset from the leg's line, at 50% opacity.
      for (let k = 1; k < pts.length; k++) line(pts[k - 1]!, pts[k]!, "#808080", 1);
      const segs = d.ghostBars;
      if (!segs) break;
      const index = barIndexer(info);
      const idx = times.map(index.of);
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const spacing = Math.abs((index.x(1) ?? 0) - (index.x(0) ?? 0)) || 6;
      const body = optimalCandlestickWidth(spacing, hpr);
      const wick = Math.max(1, Math.floor(hpr));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.5;
      segs.forEach((seg, k) => {
        const pa = pts[k];
        const pb = pts[k + 1];
        if (!pa || !pb || seg.length === 0) return;
        const [lp, rp] = pa.x > pb.x ? [prices[k + 1]!, prices[k]!] : [prices[k]!, prices[k + 1]!];
        const from = Math.min(idx[k]!, idx[k + 1]!);
        const y0 = yOf(lp);
        const y1 = yOf(rp);
        if (y0 === null || y1 === null) return;
        const stepY = seg.length > 1 ? (y1 - y0) / (seg.length - 1) : 0;
        seg.forEach(([o, h, l, c], e) => {
          const x = index.x(from + e);
          const base = info.yToPrice?.(y0 + e * stepY) ?? null;
          if (x === null || base === null) return;
          const Y = (v: number) => yOf(base + v);
          const [yo, yh, yl, yc] = [Y(o), Y(h), Y(l), Y(c)];
          if (yo === null || yh === null || yl === null || yc === null) return;
          const up = c >= o;
          const cx = Math.round(x * hpr);
          const top = Math.round(Math.min(yo, yc) * vpr);
          const bottom = Math.round(Math.max(yo, yc) * vpr);
          ctx.fillStyle = "#808080"; // wick: cold-gray-500
          ctx.fillRect(cx - Math.floor(wick / 2), Math.round(Math.min(yh, yl) * vpr), wick, Math.round(Math.abs(yl - yh) * vpr));
          const left = cx - Math.floor(body / 2);
          ctx.fillStyle = up ? "#089981" : "#f23645"; // borders: minty-green-500 / ripe-red-500
          ctx.fillRect(left, top, body, Math.max(1, bottom - top + 1));
          if (body > 2 && bottom - top > 1) {
            ctx.fillStyle = up ? "#ace5dc" : "#faa1a4"; // bodies: minty-green-100 / ripe-red-200
            ctx.fillRect(left + 1, top + 1, body - 2, bottom - top - 1);
          }
        });
      });
      ctx.restore();
      break;
    }
    case "sector": {
      // line-tool-projection ("Sector"): the third point sits on the circle
      // through the second (resolve puts it there); lines from the centre to
      // both, an arc between them, filled with a radial blue → purple gradient.
      const [a, b, c] = pts;
      if (!a || !b) break;
      const EDGE = "#9c9c9c"; // cold-gray-400
      line(a, b, EDGE, lw);
      if (!c) break;
      line(a, c, EDGE, lw);
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      const [from, to] = wedgeAngles(a, b, c);
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, from, to);
      ctx.strokeStyle = "#808080";
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.arc(a.x, a.y, 0, to, from, true);
      const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
      g.addColorStop(0, "rgba(41, 98, 255, 0.2)");
      g.addColorStop(1, "rgba(156, 39, 176, 0.2)");
      ctx.fillStyle = g;
      ctx.fill();
      break;
    }
    case "anchoredvwap": {
      // TradingView's Anchored VWAP defaults: hlc3 from the anchor bar, the
      // VWAP #1e88e5 1px, one band at ±1 standard deviation #4caf50 1px with
      // the area between filled #4caf50 at transparency 95.
      const from = bars.findIndex((x) => x.time >= times[0]!);
      if (from < 0) break;
      const mid: P[] = [];
      const upper: P[] = [];
      const lower: P[] = [];
      let pv = 0;
      let p2v = 0;
      let vv = 0;
      for (let i = from; i < bars.length; i++) {
        const bar = bars[i]!;
        const v = bar.volume ?? 0;
        const src = (bar.high + bar.low + bar.close) / 3;
        pv += src * v;
        p2v += src * src * v;
        vv += v;
        if (vv <= 0) continue;
        const vwap = pv / vv;
        const dev = Math.sqrt(Math.max(0, p2v / vv - vwap * vwap));
        const x = info.timeToX(bar.time);
        const [ym, yu, yl] = [yOf(vwap), yOf(vwap + dev), yOf(vwap - dev)];
        if (x === null || ym === null || yu === null || yl === null) continue;
        mid.push({ x, y: ym });
        upper.push({ x, y: yu });
        lower.push({ x, y: yl });
      }
      if (mid.length === 0) break;
      ctx.beginPath();
      upper.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i]!.x, lower[i]!.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(76, 175, 80, 0.05)";
      ctx.fill();
      const stroke = (pts: P[], color: string) => {
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
      };
      stroke(upper, "#4caf50");
      stroke(lower, "#4caf50");
      stroke(mid, "#1e88e5");
      break;
    }
    case "frvp":
    case "avp": {
      // Fixed range / Anchored volume profile with TradingView's defaults:
      // 24 rows, Up/Down volume, value area 70%, histogram left to right at
      // 30% of the box, POC black 2px, VAH / VAL off, box tinted #37a6ef at 94.
      const start = times[0]!;
      const end = type === "frvp" ? times[1] ?? start : bars[bars.length - 1]?.time ?? start;
      const vp = volumeProfile(inRange(Math.min(start, end), Math.max(start, end)));
      if (!vp) break;
      const xa = info.timeToX(start);
      const xb = info.timeToX(end);
      if (xa === null || xb === null) break;
      const left = Math.min(xa, xb);
      const right = Math.max(xa, xb);
      const yh = yOf(vp.hi);
      const yl = yOf(vp.lo);
      if (yh === null || yl === null) break;
      ctx.fillStyle = "rgba(55, 166, 239, 0.06)";
      ctx.fillRect(left, yh, right - left, yl - yh);
      const width = (right - left) * 0.3;
      const max = Math.max(...vp.up.map((u, i) => u + vp.down[i]!)) || 1;
      for (let r = 0; r < vp.up.length; r++) {
        const yTop = yOf(vp.lo + (r + 1) * vp.rowH);
        const yBot = yOf(vp.lo + r * vp.rowH);
        if (yTop === null || yBot === null) continue;
        const inVa = r >= vp.vaLow && r <= vp.vaHigh;
        const wu = (vp.up[r]! / max) * width;
        const wd = (vp.down[r]! / max) * width;
        const h = Math.max(1, yBot - yTop - 1);
        ctx.fillStyle = inVa ? "rgba(38, 198, 218, 0.75)" : "rgba(38, 198, 218, 0.5)";
        ctx.fillRect(left, yTop, wu, h);
        ctx.fillStyle = inVa ? "rgba(236, 64, 122, 0.75)" : "rgba(236, 64, 122, 0.5)";
        ctx.fillRect(left + wu, yTop, wd, h);
      }
      const yPoc = yOf(vp.pocPrice);
      if (yPoc !== null) line({ x: left, y: yPoc }, { x: right, y: yPoc }, "#000000", 2);
      break;
    }
  }
  ctx.restore();
}

/** FibWedgePaneView's arc angles: each direction in [0, 2π), the short way round. */
export function wedgeAngles(a: P, b: P, c: P): [number, number] {
  const ang = (q: P) => {
    const l = Math.hypot(q.x - a.x, q.y - a.y) || 1;
    const x = (q.x - a.x) / l;
    const y = (q.y - a.y) / l;
    let t = Math.acos(Math.max(-1, Math.min(1, x)));
    if (y < 0) t = 2 * Math.PI - t;
    return t;
  };
  let from = ang(b);
  let to = ang(c);
  if (to < from) [from, to] = [to, from];
  if (Math.abs(from - to) > Math.PI) {
    const lo = Math.min(from, to);
    from = Math.max(from, to);
    to = lo + 2 * Math.PI;
  }
  return [from, to];
}

/** The sector's hit test (ArcWedgeRenderer): on the arc, or inside the wedge. */
export function hitSector(a: P, b: P, c: P, p: P): boolean {
  const r = Math.hypot(b.x - a.x, b.y - a.y);
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  if (Math.abs(d - r) <= 4) {
    const chord = Math.hypot(b.x - c.x, b.y - c.y);
    if (Math.max(Math.hypot(p.x - b.x, p.y - b.y), Math.hypot(p.x - c.x, p.y - c.y)) <= chord) return true;
  }
  if (d > r || d === 0) return false;
  const u = { x: (b.x - a.x) / r, y: (b.y - a.y) / r };
  const v = { x: (c.x - a.x) / r, y: (c.y - a.y) / r };
  const w = { x: (p.x - a.x) / d, y: (p.y - a.y) / d };
  const uv = u.x * v.x + u.y * v.y;
  return w.x * u.x + w.y * u.y >= uv && w.x * v.x + w.y * v.y >= uv;
}

function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : hex;
}

/** Bar index ↔ pane x for drawing tools, extrapolating past the loaded bars on the bar step. */
function barIndexer(info: DrawCtxInfo) {
  const bars = info.bars();
  const step = () => (bars.length > 1 ? bars[bars.length - 1]!.time - bars[bars.length - 2]!.time : 60);
  const of = (t: number) => {
    if (bars.length === 0) return 0;
    const hi = bars.length - 1;
    if (t >= bars[hi]!.time) return hi + Math.round((t - bars[hi]!.time) / step());
    if (t <= bars[0]!.time) return Math.round((t - bars[0]!.time) / step());
    let lo = 0;
    let h = hi;
    while (lo < h) {
      const m = (lo + h) >> 1;
      if (bars[m]!.time < t) lo = m + 1;
      else h = m;
    }
    return lo;
  };
  const x = (i: number) => {
    if (bars.length === 0) return null;
    const last = bars.length - 1;
    const t = i <= last && i >= 0 ? bars[i]!.time : i > last ? bars[last]!.time + (i - last) * step() : bars[0]!.time + i * step();
    return info.timeToX(t);
  };
  return { of, x };
}

/**
 * A volume profile over bars: `rows` equal price rows between their low and
 * high, each bar's volume spread over the rows it spans (up when it closed
 * at or above its open), the POC row, and the value area grown from it.
 */
export function volumeProfile(
  bars: readonly { high: number; low: number; open: number; close: number; volume?: number }[],
  rows = 24,
  vaPercent = 70,
): { hi: number; lo: number; rowH: number; up: number[]; down: number[]; poc: number; pocPrice: number; vaLow: number; vaHigh: number } | null {
  if (bars.length === 0) return null;
  const hi = Math.max(...bars.map((x) => x.high));
  const lo = Math.min(...bars.map((x) => x.low));
  const up = new Array<number>(rows).fill(0);
  const down = new Array<number>(rows).fill(0);
  const rowH = (hi - lo) / rows || 1;
  for (const bar of bars) {
    const r0 = Math.min(rows - 1, Math.floor((bar.low - lo) / rowH));
    const r1 = Math.min(rows - 1, Math.floor((bar.high - lo) / rowH));
    const share = (bar.volume ?? 0) / (r1 - r0 + 1);
    for (let r = r0; r <= r1; r++) (bar.close >= bar.open ? up : down)[r]! += share;
  }
  const total = up.map((u, i) => u + down[i]!);
  const max = Math.max(...total);
  const poc = total.indexOf(max);
  const sum = total.reduce((acc, v) => acc + v, 0);
  let va = total[poc]!;
  let vaLow = poc;
  let vaHigh = poc;
  while (va < (sum * vaPercent) / 100 && (vaLow > 0 || vaHigh < rows - 1)) {
    const below = vaLow > 0 ? total[vaLow - 1]! : -1;
    const above = vaHigh < rows - 1 ? total[vaHigh + 1]! : -1;
    if (above >= below) va += total[++vaHigh]!;
    else va += total[--vaLow]!;
  }
  return { hi, lo, rowH, up, down, poc, pocPrice: lo + (poc + 0.5) * rowH, vaLow, vaHigh };
}
