/**
 * TradingView's Position forecast (line-tool-prediction): an elliptical arc
 * from the source to the target with an arrowhead, a source balloon (price,
 * date) and a target balloon (change, "in" time span, price, date), plus a
 * SUCCESS / FAILURE badge once the target bar has traded.
 */

type P = { x: number; y: number };

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
const font = (size: number, weight = "normal") => `${weight} ${size}px ${FONT}`;

// Factory defaults: transparency 10 on the balloon / badge colours.
const BLUE = "#2962ff";
const BLUE_90 = "rgba(41, 98, 255, 0.9)";
const SUCCESS_90 = "rgba(76, 175, 80, 0.9)"; // iguana-green-500
const FAILURE_90 = "rgba(242, 54, 69, 0.9)"; // ripe-red-500
const CENTERS = "#202020";

export type ForecastStatus = "waiting" | "success" | "failure";

/** TimeSpanFormatter: every non-zero unit, "1d 2h 5m 3s". */
export function tvTimeSpan(seconds: number): string {
  const neg = seconds < 0;
  let e = Math.abs(seconds);
  const d = Math.floor(e / 86400);
  e -= 86400 * d;
  const h = Math.floor(e / 3600);
  e -= 3600 * h;
  const m = Math.floor(e / 60);
  e -= 60 * m;
  let out = "";
  if (d) out += `${d}d `;
  if (h) out += `${h}h `;
  if (m) out += `${m}m `;
  if (e) out += `${Math.round(e)}s `;
  if (neg) out = `-${out}`;
  return out.trim();
}

/**
 * recalculateStateByData: judged on the target bar only. Up succeeds when its
 * high reaches the target, down when its low does; otherwise it failed unless
 * that bar is still the live one (or still in the future).
 */
export function forecastStatus(
  bars: readonly { time: number; high: number; low: number }[],
  sourcePrice: number,
  target: { time: number; price: number },
): ForecastStatus {
  if (bars.length === 0) return "waiting";
  const last = bars[bars.length - 1]!;
  if (target.time > last.time) return "waiting";
  const bar = bars.find((b) => b.time === target.time) ?? bars.find((b) => b.time > target.time);
  if (!bar) return "waiting";
  const up = target.price > sourcePrice;
  if (up ? bar.high >= target.price : bar.low <= target.price) return "success";
  return bar === last ? "waiting" : "failure";
}

/** The date and time as the forecast's labels show them (yyyy-mm-dd hh:mm, local). */
function stamp(sec: number, withTime: boolean, gap: string): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date}${gap}${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

const CLOCK = 9; // the clock glyph's width

function drawClock(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x + CLOCK / 2, y + CLOCK / 2, CLOCK / 2 - 0.5, 0, 2 * Math.PI);
  ctx.moveTo(x + CLOCK / 2, y + 2);
  ctx.lineTo(x + CLOCK / 2, y + CLOCK / 2);
  ctx.lineTo(x + CLOCK / 2 + 2, y + CLOCK / 2);
  ctx.stroke();
  ctx.restore();
}

/** _drawBalloon: a rounded box with a 5px tail toward the point; returns its top-left. */
function balloon(ctx: CanvasRenderingContext2D, e: P, w: number, h: number, down: boolean, n: number): P {
  ctx.beginPath();
  if (down) {
    const o = { x: e.x - n, y: e.y - 6 - 5 - h };
    ctx.moveTo(o.x + 3, o.y);
    ctx.lineTo(o.x + w - 3, o.y);
    ctx.arcTo(o.x + w, o.y, o.x + w, o.y + 3, 3);
    ctx.lineTo(o.x + w, o.y + h - 3);
    ctx.arcTo(o.x + w, o.y + h, o.x + w - 3, o.y + h, 3);
    ctx.lineTo(o.x + n + 5, o.y + h);
    ctx.lineTo(o.x + n, o.y + h + 5);
    ctx.lineTo(o.x + n - 5, o.y + h);
    ctx.lineTo(o.x + 3, o.y + h);
    ctx.arcTo(o.x, o.y + h, o.x, o.y + h - 3, 3);
    ctx.lineTo(o.x, o.y + 3);
    ctx.arcTo(o.x, o.y, o.x + 3, o.y, 3);
    return o;
  }
  const o = { x: e.x - n, y: e.y + 6 + 5 + h };
  ctx.moveTo(o.x + 3, o.y);
  ctx.lineTo(o.x + w - 3, o.y);
  ctx.arcTo(o.x + w, o.y, o.x + w, o.y - 3, 3);
  ctx.lineTo(o.x + w, o.y - h + 3);
  ctx.arcTo(o.x + w, o.y - h, o.x + w - 3, o.y - h, 3);
  ctx.lineTo(o.x + n + 5, o.y - h);
  ctx.lineTo(o.x + n, o.y - h - 5);
  ctx.lineTo(o.x + n - 5, o.y - h);
  ctx.lineTo(o.x + 3, o.y - h);
  ctx.arcTo(o.x, o.y - h, o.x, o.y - h + 3, 3);
  ctx.lineTo(o.x, o.y - 3);
  ctx.arcTo(o.x, o.y, o.x + 3, o.y, 3);
  return { x: o.x, y: o.y - h };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Where each forecast's balloons were last drawn (for hit testing). */
export const forecastBoxes = new Map<string, { x: number; y: number; w: number; h: number }[]>();

export interface ForecastData {
  id: string;
  source: P;
  target: P;
  sourcePrice: number;
  targetPrice: number;
  sourceTime: number;
  targetTime: number;
  intraday: boolean;
  priceFormat: (p: number) => string;
  status: ForecastStatus;
  lineWidth: number;
  paneWidth: number;
}

/** Media-coordinate drawing of the whole forecast (st._drawImpl). */
export function drawForecast(ctx: CanvasRenderingContext2D, f: ForecastData): void {
  const { source: i, target: r } = f;
  const o = { x: r.x - i.x, y: r.y - i.y };
  const n = Math.abs(o.x);
  const a = Math.abs(o.y);
  // Up when the target is above the source (and the price scale not inverted).
  const up = f.targetPrice > f.sourcePrice;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = f.lineWidth;
  let s: number;
  let l: number;
  let c: number;
  if (o.y < 0) {
    s = Math.PI / 2;
    l = o.x > 0 ? 0 : Math.PI;
    c = 1;
  } else {
    s = -Math.PI / 2;
    l = o.x > 0 ? 0 : -Math.PI;
    c = -1;
  }
  ctx.beginPath();
  ctx.ellipse(i.x, r.y, n, a, 0, s, l, s > l);
  ctx.stroke();

  const change = f.targetPrice - f.sourcePrice;
  const pct = (change / Math.abs(f.sourcePrice)) * 100;
  const t1 = `${f.priceFormat(change)} (${Number(pct.toFixed(2))}%)`;
  const t2 = `in ${tvTimeSpan(f.targetTime - f.sourceTime)}`;
  const t3 = f.priceFormat(f.targetPrice);
  const t4 = stamp(f.targetTime, f.intraday, "  ");
  drawTarget(ctx, f, up, [t1, t2, t3, t4]);
  drawSource(ctx, f, up, [f.priceFormat(f.sourcePrice), stamp(f.sourceTime, f.intraday, " ")]);

  // The arrowhead, tangent to the arc a head-length back from the target.
  const h = Math.max(8, 4 * f.lineWidth);
  let d: number;
  if (Math.abs(o.x) < 1 || Math.abs(o.y) < 1) d = Math.atan(o.x / o.y);
  else {
    let lo = 0;
    let hi = Math.PI / 2;
    let mid = (lo + hi) / 2;
    let px = 0;
    let py = 0;
    if (Math.hypot(o.x, o.y) > h) {
      for (let k = 0; k !== 10; k++) {
        px = n * Math.sin(mid);
        py = a * (1 - Math.cos(mid));
        const dist = Math.sqrt((px - n) * (px - n) + (py - a) * (py - a));
        if (Math.abs(dist - h) < 1) break;
        if (dist > h) lo = mid;
        else hi = mid;
        mid = (lo + hi) / 2;
      }
    }
    d = Math.atan((n - px) / (a - py));
    if (o.x * o.y < 0) d = -d;
  }
  ctx.fillStyle = BLUE;
  ctx.save();
  ctx.beginPath();
  ctx.translate(r.x, r.y);
  ctx.rotate(-d);
  ctx.moveTo(0, 0);
  ctx.lineTo(-h / 2, c * h);
  ctx.lineTo(h / 2, c * h);
  ctx.lineTo(0, 0);
  ctx.restore();
  ctx.fill();
  ctx.restore();
}

function drawTarget(ctx: CanvasRenderingContext2D, f: ForecastData, up: boolean, [r, o, a, s]: string[]): void {
  ctx.save();
  ctx.font = font(14);
  const l = ctx.measureText(r!).width;
  const c = ctx.measureText(o!).width;
  const h = ctx.measureText(" ").width;
  ctx.font = font(11);
  const d = ctx.measureText(a!).width;
  const u = ctx.measureText(s!).width;
  const g = ctx.measureText(" ").width;
  const width = Math.max(l + c + h, d + u + CLOCK + 2 * g) + 8 + 4;
  const height = 38;
  const p = f.target.x + width - f.paneWidth + 5;
  const offset = Math.max(20, Math.min(width - 15, p));
  // The target balloon points the other way from the move.
  const x = balloon(ctx, f.target, width, height, up, offset);
  forecastBoxes.set(f.id, [{ x: x.x, y: x.y, w: width, h: height }]);
  ctx.fillStyle = BLUE_90;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = BLUE_90;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(f.target.x, f.target.y, 3, 0, 2 * Math.PI);
  ctx.fillStyle = CENTERS;
  ctx.fill();
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  const m = 2 + x.x + 4;
  const y = 2 + x.y + 3;
  ctx.font = font(14);
  ctx.fillText(r!, m, y);
  ctx.fillText(o!, m + l + h, y);
  ctx.font = font(11);
  const w = y + 14 + 3;
  ctx.fillText(a!, m, w);
  drawClock(ctx, m + d + g, w + 1);
  ctx.fillText(s!, m + d + CLOCK + 2 * g, w);
  if (f.status !== "waiting") {
    const label = f.status === "success" ? "SUCCESS" : "FAILURE";
    ctx.font = font(14, "bold");
    const tw = ctx.measureText(label).width;
    const A = Math.round((width - tw) / 2);
    const I = 18;
    ctx.fillStyle = f.status === "success" ? SUCCESS_90 : FAILURE_90;
    const by = up ? x.y - I - 2 : x.y + height + 2;
    roundRect(ctx, x.x - 1, by, width + 2, I, 5);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x.x + A, up ? x.y - I + 1 : x.y + height + 5);
    // Our own tick / cross mark in place of TradingView's icon images.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    const ix = x.x + A - 10;
    const iy = by + I / 2;
    ctx.beginPath();
    if (f.status === "success") {
      ctx.moveTo(ix - 3, iy);
      ctx.lineTo(ix - 1, iy + 2.5);
      ctx.lineTo(ix + 3, iy - 2.5);
    } else {
      ctx.moveTo(ix - 2.5, iy - 2.5);
      ctx.lineTo(ix + 2.5, iy + 2.5);
      ctx.moveTo(ix + 2.5, iy - 2.5);
      ctx.lineTo(ix - 2.5, iy + 2.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSource(ctx: CanvasRenderingContext2D, f: ForecastData, up: boolean, [l1, l2]: string[]): void {
  ctx.save();
  ctx.font = font(12);
  const i = ctx.measureText(l1!).width;
  ctx.font = font(10);
  const r = ctx.measureText(l2!).width;
  const width = Math.max(i, r) + 6 + 4;
  const height = 32;
  const n = f.source.x + width - f.paneWidth + 5;
  const offset = Math.max(20, Math.min(width - 15, n));
  const a = balloon(ctx, f.source, width, height, !up, offset);
  forecastBoxes.get(f.id)?.push({ x: a.x, y: a.y, w: width, h: height });
  ctx.fillStyle = BLUE_90;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = BLUE_90;
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  const x = 2 + a.x + 3;
  const y = 2 + a.y + 2;
  ctx.font = font(12);
  ctx.fillText(l1!, x, y);
  ctx.font = font(10);
  ctx.fillText(l2!, x, y + 12 + 2);
  ctx.beginPath();
  ctx.arc(f.source.x, f.source.y, 3, 0, 2 * Math.PI);
  ctx.fillStyle = CENTERS;
  ctx.fill();
  ctx.restore();
}

/** st.hitTest: on the arc (within 3px), or on either balloon. */
export function hitForecast(id: string, f: { source: P; target: P }, p: P): boolean {
  const e = f.source;
  const i = { x: f.target.x - e.x, y: f.target.y - e.y };
  const r = { x: p.x - e.x, y: p.y - e.y };
  const o = Math.abs(i.x);
  const n = Math.abs(i.y);
  if (o > 0 && Math.abs(r.x) <= o) {
    const a = Math.sign(i.y) * (n - n * Math.sqrt(1 - (r.x * r.x) / (o * o)));
    if (Math.abs(a - r.y) < 3) return true;
  }
  return (forecastBoxes.get(id) ?? []).some((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y - 3 && p.y <= b.y + b.h + 8);
}
