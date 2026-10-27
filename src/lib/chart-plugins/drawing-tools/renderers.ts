import { tvDash } from "./geometry";
import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawingLineStyle } from "../../../pages/trading/constants";
import { formatQty, positionOutcome, positionSizing, trimNumber } from "./position-math";
import type { DrawCtxInfo, ResolvedEntry, ResolvedFibLevel } from "./types";
import { renderFibTool } from "./fibtools";
import { renderLineTool } from "./linetools";
import { renderMeasureTool } from "./measuretools";
import { renderShapeTool } from "./shapetools";
import { imageCorners, renderAnnotationTool } from "./annotationtools";
import { renderIconTool } from "./icontools";
import { renderPattern } from "./patterns";

const HANDLE_RADIUS = 5;
const LINE_WIDTH = 2;
// TradingView fills fib bands at transparency 80.
const FIB_BAND_ALPHA = 0.2;
const RECT_FILL_ALPHA = 0.14;

interface BPt {
  x: number;
  y: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

function toBitmap(scope: BitmapCoordinatesRenderingScope, x: number, y: number): BPt {
  return {
    x: Math.round(x * scope.horizontalPixelRatio),
    y: Math.round(y * scope.verticalPixelRatio),
  };
}

function showHandles(e: ResolvedEntry): boolean {
  return e.state === "hovered" || e.state === "selected";
}

// Dash pattern (media px) for each drawing line style, scaled by the width as TradingView does.
function dashFor(style: DrawingLineStyle | undefined, width: number = LINE_WIDTH): readonly number[] | undefined {
  const dash = tvDash(style, width);
  return dash.length ? dash : undefined;
}

function applyDash(
  scope: BitmapCoordinatesRenderingScope,
  dash: readonly number[] | undefined,
): void {
  if (!dash) return;
  scope.context.setLineDash(dash.map((v) => v * scope.horizontalPixelRatio));
}

function strokeLine(
  scope: BitmapCoordinatesRenderingScope,
  a: BPt,
  b: BPt,
  color: string,
  widthMedia: number,
  dash?: readonly number[],
): void {
  const ctx = scope.context;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = widthMedia * scope.verticalPixelRatio;
  applyDash(scope, dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawHandle(scope: BitmapCoordinatesRenderingScope, p: BPt, color: string): void {
  const ctx = scope.context;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, HANDLE_RADIUS * scope.horizontalPixelRatio, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5 * scope.horizontalPixelRatio;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

export function renderEntry(
  scope: BitmapCoordinatesRenderingScope,
  e: ResolvedEntry,
  info: DrawCtxInfo,
): void {
  switch (e.d.type) {
    case "trendline":
      renderTrendline(scope, e);
      break;
    case "horizontal":
      renderHorizontal(scope, e);
      break;
    case "rectangle":
      renderRectangle(scope, e);
      break;
    case "fibonacci":
      renderFibonacci(scope, e);
      break;
    case "position":
      renderPosition(scope, e, info);
      break;
    case "vertical":
      renderVertical(scope, e);
      break;
    case "channel":
      renderChannel(scope, e);
      break;
    case "ellipse":
      renderEllipse(scope, e);
      break;
    case "arrow":
      renderArrow(scope, e);
      break;
    case "triangle":
      renderTriangle(scope, e);
      break;
    case "text":
      renderText(scope, e);
      break;
    case "fibextension":
      renderFibonacci(scope, e);
      break;
    case "brush":
    case "highlighter":
      renderBrush(scope, e);
      break;
    case "xabcd":
    case "cypher":
    case "abcd":
    case "headshoulders":
    case "trianglepattern":
    case "threedrives":
    case "elliottimpulse":
    case "elliottcorrection":
    case "elliotttriangle":
    case "elliottdouble":
    case "elliotttriple":
      renderPattern(scope, e, e.state === "preview");
      if (showHandles(e)) for (const p of e.pts ?? []) drawHandle(scope, toBitmap(scope, p.x, p.y), "#2962ff");
      break;
    case "horzray":
    case "crossline":
    case "trendangle":
    case "flatbottom":
    case "disjointchannel":
    case "regression":
    case "pitchfork":
    case "schiffpitchfork":
    case "modschiffpitchfork":
    case "insidepitchfork":
    case "cycliclines":
    case "timecycles":
    case "sineline":
      renderLineTool(scope, e, info);
      if (showHandles(e)) for (const p of e.pts ?? []) drawHandle(scope, toBitmap(scope, p.x, p.y), "#2962ff");
      break;
    case "fibextension3":
    case "fibchannel":
    case "fibtimezone":
    case "fibspeedfan":
    case "fibtime":
    case "fibcircles":
    case "fibspiral":
    case "fibarcs":
    case "fibwedge":
    case "pitchfan":
    case "gannbox":
    case "gannfixed":
    case "gannsquare":
    case "gannfan":
      renderFibTool(scope, e, info);
      if (showHandles(e)) {
        const pts = e.pts ?? [];
        // The Gann box also has handles on its other two corners.
        const handles = e.d.type === "gannbox" && pts.length === 2 ? [...pts, { x: pts[0]!.x, y: pts[1]!.y }, { x: pts[1]!.x, y: pts[0]!.y }] : pts;
        for (const p of handles) drawHandle(scope, toBitmap(scope, p.x, p.y), "#2962ff");
      }
      break;
    case "forecast":
    case "barspattern":
    case "ghostfeed":
    case "sector":
    case "anchoredvwap":
    case "frvp":
    case "avp":
    case "pricerange":
    case "daterange":
    case "datepricerange":
      renderMeasureTool(scope, e, info);
      if (showHandles(e)) for (const p of e.pts ?? []) drawHandle(scope, toBitmap(scope, p.x, p.y), "#2962ff");
      break;
    case "arrowmarker":
    case "arrowup":
    case "arrowdown":
    case "rotatedrect":
    case "path":
    case "circle":
    case "polyline":
    case "arc":
    case "curve":
    case "doublecurve":
      renderShapeTool(scope, e);
      if (showHandles(e)) for (const p of e.pts ?? []) drawHandle(scope, toBitmap(scope, p.x, p.y), "#2962ff");
      break;
    case "textnote":
    case "pricenote":
    case "pin":
    case "table":
    case "callout":
    case "comment":
    case "pricelabel":
    case "signpost":
    case "flagmark":
      renderAnnotationTool(scope, e, info);
      if (showHandles(e)) for (const p of e.pts ?? []) drawHandle(scope, toBitmap(scope, p.x, p.y), "#2962ff");
      break;
    case "image": {
      renderAnnotationTool(scope, e, info);
      const c = e.pts?.[0];
      if (e.state === "selected" && c && e.d.cssWidth && e.d.cssHeight) {
        for (const q of imageCorners(c, e.d.cssWidth, e.d.cssHeight)) drawHandle(scope, toBitmap(scope, q.x, q.y), "#2962ff");
      }
      break;
    }
    case "icon":
    case "emoji":
      for (const p of renderIconTool(scope, e, info)) drawHandle(scope, toBitmap(scope, p.x, p.y), "#2962ff");
      break;
    default:
      break;
  }
}

// ── Parity tools: vertical / channel / shapes / text ─────────────────────────

// Brush: the stroke as a smooth round-jointed line, with handles at both ends
// while hovered or selected.
function renderBrush(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  const pts = e.pts ?? [];
  if (pts.length < 2) return;
  const ctx = scope.context;
  ctx.save();
  ctx.beginPath();
  const first = toBitmap(scope, pts[0]!.x, pts[0]!.y);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const b = toBitmap(scope, pts[i]!.x, pts[i]!.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = e.d.color;
  ctx.lineWidth = (e.d.width ?? 2) * scope.horizontalPixelRatio;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  applyDash(scope, dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH));
  ctx.stroke();
  ctx.restore();
  if (showHandles(e)) {
    drawHandle(scope, first, "#2962ff");
    const last = pts[pts.length - 1]!;
    drawHandle(scope, toBitmap(scope, last.x, last.y), "#2962ff");
  }
}

function renderVertical(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null) return;
  const x = Math.round(e.x1 * scope.horizontalPixelRatio);
  strokeLine(
    scope,
    { x, y: 0 },
    { x, y: scope.bitmapSize.height },
    e.d.color,
    e.d.width ?? 1.5,
    dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH),
  );
  if (showHandles(e)) {
    drawHandle(scope, { x, y: Math.round(scope.bitmapSize.height / 2) }, e.d.color);
  }
}

// Parallel channel: the main anchor line plus a copy offset by (price3 − price1),
// with a translucent fill between them.
function renderChannel(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  if (e.y3 == null) return;
  const dy = e.y3 - e.y1;
  const a1 = toBitmap(scope, e.x1, e.y1);
  const b1 = toBitmap(scope, e.x2, e.y2);
  const a2 = toBitmap(scope, e.x1, e.y3);
  const b2 = toBitmap(scope, e.x2, e.y2 + dy);
  const ctx = scope.context;
  ctx.save();
  ctx.fillStyle = hexToRgba(e.d.fillColor ?? e.d.color, e.d.fillOpacity ?? 0.1);
  ctx.beginPath();
  ctx.moveTo(a1.x, a1.y);
  ctx.lineTo(b1.x, b1.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.lineTo(a2.x, a2.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const dash = dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH);
  strokeLine(scope, a1, b1, e.d.color, e.d.width ?? LINE_WIDTH, dash);
  strokeLine(scope, a2, b2, e.d.color, e.d.width ?? LINE_WIDTH, dash);
  if (showHandles(e)) {
    drawHandle(scope, a1, e.d.color);
    drawHandle(scope, b1, e.d.color);
    drawHandle(scope, a2, e.d.color);
  }
}

function renderEllipse(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const ctx = scope.context;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(e.d.fillColor ?? e.d.color, e.d.fillOpacity ?? RECT_FILL_ALPHA);
  ctx.fill();
  ctx.strokeStyle = e.d.color;
  ctx.lineWidth = (e.d.width ?? 1.5) * scope.verticalPixelRatio;
  applyDash(scope, dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH));
  ctx.stroke();
  ctx.restore();
  if (showHandles(e)) drawRectHandles(scope, a, b, e.d.color);
}

function renderArrow(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  strokeLine(scope, a, b, e.d.color, e.d.width ?? LINE_WIDTH, dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH));
  drawArrowhead(scope, a, b, e.d.color);
  if (showHandles(e)) {
    drawHandle(scope, a, e.d.color);
    drawHandle(scope, b, e.d.color);
  }
}

function drawArrowhead(
  scope: BitmapCoordinatesRenderingScope,
  from: BPt,
  to: BPt,
  color: string,
): void {
  const ctx = scope.context;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const len = 12 * scope.horizontalPixelRatio;
  const spread = Math.PI / 7;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - len * Math.cos(ang - spread), to.y - len * Math.sin(ang - spread));
  ctx.lineTo(to.x - len * Math.cos(ang + spread), to.y - len * Math.sin(ang + spread));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderTriangle(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const ctx = scope.context;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo((a.x + b.x) / 2, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(a.x, b.y);
  ctx.closePath();
  ctx.fillStyle = hexToRgba(e.d.fillColor ?? e.d.color, e.d.fillOpacity ?? RECT_FILL_ALPHA);
  ctx.fill();
  ctx.strokeStyle = e.d.color;
  ctx.lineWidth = (e.d.width ?? 1.5) * scope.verticalPixelRatio;
  applyDash(scope, dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH));
  ctx.stroke();
  ctx.restore();
  if (showHandles(e)) {
    drawHandle(scope, a, e.d.color);
    drawHandle(scope, b, e.d.color);
  }
}

function textFont(d: ResolvedEntry["d"], sizePx: number): string {
  const style = d.italic ? "italic " : "";
  const weight = d.bold ? "bold " : "";
  return `${style}${weight}${Math.round(sizePx)}px sans-serif`;
}

function renderText(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null) return;
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const size = (e.d.fontSize ?? 14) * scope.verticalPixelRatio;
  const lines = (e.d.text ?? "Text").split("\n");
  const at = toBitmap(scope, e.x1, e.y1);
  const lineH = size * 1.3;
  const pad = 4 * hpr;

  ctx.save();
  ctx.font = textFont(e.d, size);
  ctx.textBaseline = "top";

  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = textW + pad * 2;
  const boxH = lines.length * lineH + pad * 2;
  const bx = at.x - pad;
  const by = at.y - pad;

  if (e.d.textBg) {
    ctx.fillStyle = e.d.textBgColor ?? "#1e222d";
    ctx.fillRect(bx, by, boxW, boxH);
  }
  if (e.d.textBorder) {
    ctx.strokeStyle = e.d.textBorderColor ?? e.d.color;
    ctx.lineWidth = hpr;
    ctx.strokeRect(bx, by, boxW, boxH);
  }

  ctx.fillStyle = e.d.color;
  lines.forEach((l, i) => ctx.fillText(l, at.x, at.y + i * lineH));

  if (showHandles(e)) {
    ctx.strokeStyle = e.d.color;
    ctx.lineWidth = hpr;
    ctx.setLineDash([3 * hpr, 3 * hpr]);
    ctx.strokeRect(bx, by, boxW, boxH);
  }
  ctx.restore();
}

// ── Position tool (long/short risk-reward) ───────────────────────────────────
// TradingView's look: 20 % profit / stop zones without borders, a cold-grey
// entry line, the stretch already played filled once more up to the close,
// a dashed path from entry to close, square level handles and circle entry
// handles on the left edge, and stats labels while hovered or selected.

const POS_PROFIT = "#089981";
const POS_STOP = "#f23645";
const POS_LINE = "#787b86";
const POS_FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

function renderPosition(
  scope: BitmapCoordinatesRenderingScope,
  e: ResolvedEntry,
  info: DrawCtxInfo,
): void {
  const { x1, x2, y1, yStop, yTarget, d } = e;
  if (x1 === null || x2 === null || y1 === null || yStop == null || yTarget == null) return;
  if (d.stopPrice == null || d.targetPrice == null) return;
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  posFill(scope, xa, xb, y1, yTarget, hexToRgba(POS_PROFIT, 0.2));
  posFill(scope, xa, xb, y1, yStop, hexToRgba(POS_STOP, 0.2));

  const input = {
    side: d.side === "short" ? ("short" as const) : ("long" as const),
    entry: d.price,
    stop: d.stopPrice,
    target: d.targetPrice,
    accountSize: d.accountSize,
    lotSize: d.lotSize,
    riskPct: d.riskPct,
    leverage: d.leverage,
  };
  const bars = info.bars();
  const t1 = Math.min(d.time ?? 0, d.time2 ?? 0);
  const t2 = Math.max(d.time ?? 0, d.time2 ?? 0);
  const outcome = positionOutcome(input, t1, t2, bars, bars[bars.length - 1]?.close ?? null);
  // Price → y by interpolating the entry and target rows (linear price scale).
  const yOf = (price: number) =>
    d.targetPrice === d.price ? y1 : y1 + ((price - d.price) * (yTarget - y1)) / (d.targetPrice! - d.price);

  if (outcome.entryBar) {
    const xe = info.timeToX(outcome.entryBar.time);
    const xc = info.timeToX(outcome.closeTime);
    if (xe !== null && xc !== null) {
      const yc = yOf(outcome.closePrice);
      posFill(scope, Math.max(xa, xe), Math.min(xb, xc), y1, yc, hexToRgba(outcome.pnl >= 0 ? POS_PROFIT : POS_STOP, 0.2));
      // Entry → close path: dashed, ending in an arrow (TradingView's rightend Arrow).
      const pa = toBitmap(scope, xe, y1);
      const pb = toBitmap(scope, xc, yc);
      strokeLine(scope, pa, pb, POS_LINE, 1, [4, 4]);
      if (pa.x !== pb.x || pa.y !== pb.y) drawArrowhead(scope, pa, pb, POS_LINE);
    }
  }
  // Level edges in the zone colours, then the entry line.
  strokeLine(scope, toBitmap(scope, xa, yTarget), toBitmap(scope, xb, yTarget), hexToRgba(POS_PROFIT, 0.2), 1);
  strokeLine(scope, toBitmap(scope, xa, yStop), toBitmap(scope, xb, yStop), hexToRgba(POS_STOP, 0.2), 1);
  strokeLine(scope, toBitmap(scope, xa, y1), toBitmap(scope, xb, y1), POS_LINE, 1);

  // Drawn in TradingView's order: lines, then the labels over them, then the
  // drag handles on top of everything.
  if (e.state !== "normal") renderPositionLabels(scope, e, info, input, outcome, { xa, xb, y1, yTarget, yStop });
  if (showHandles(e)) {
    drawSquareHandle(scope, toBitmap(scope, xa, yTarget), "#2962ff");
    drawSquareHandle(scope, toBitmap(scope, xa, yStop), "#2962ff");
    drawHandle(scope, toBitmap(scope, xa, y1), "#2962ff");
    drawHandle(scope, toBitmap(scope, xb, y1), "#2962ff");
  }
}

function renderPositionLabels(
  scope: BitmapCoordinatesRenderingScope,
  e: ResolvedEntry,
  info: DrawCtxInfo,
  input: Parameters<typeof positionSizing>[0],
  outcome: ReturnType<typeof positionOutcome>,
  g: { xa: number; xb: number; y1: number; yTarget: number; yStop: number },
): void {
  const d = e.d;
  const { xa, xb, y1, yTarget, yStop } = g;

  const sizing = positionSizing(input);
  const xm = (xa + xb) / 2;
  const levelText = (name: string, level: number, amount: number) => {
    const off = Math.abs(level - d.price);
    const pct = d.price ? (off / d.price) * 100 : 0;
    const ticks = info.tickSize > 0 ? Math.round(off / info.tickSize) : 0;
    return `${name}: ${info.priceFormat(off)} (${pct.toFixed(3)}%) ${ticks}, Amount: ${trimNumber(amount)}`;
  };
  const pnl = outcome.pnl;
  const pnlText = `${pnl < 0 ? "-" : ""}${info.priceFormat(Math.abs(pnl))}`;
  const target = [levelText("Target", input.target, sizing.amountTarget)];
  const stop = [levelText("Stop", input.stop, sizing.amountStop)];
  const middle = [
    `${outcome.kind === "open" ? "Open" : "Closed"} PnL: ${pnlText}, Qty: ${formatQty(sizing.qty)}`,
    `Risk/reward ratio: ${trimNumber(sizing.rr)}`,
  ];
  // TradingView's _createLabelsRenderers: when the widest label leaves no
  // more than 8px beside the anchor in the box, the level labels move out by
  // anchor radius + 8 and the middle label leaves the entry line by half its
  // height + anchor radius + 8, toward the smaller zone (stop on a tie).
  const widest = Math.max(...[target, stop, middle].map((l) => posLabelSize(scope, l).w));
  const crowded = xb - xa - widest - POS_ANCHOR_RADIUS <= 8;
  const levelGap = crowded ? POS_ANCHOR_RADIUS + 8 : 0;
  let yMid = y1;
  if (crowded) {
    const side = Math.abs(input.target - input.entry) > Math.abs(input.stop - input.entry) ? -1 : 1;
    const dir = yTarget < yStop ? 1 : -1;
    yMid = y1 + dir * side * (posLabelSize(scope, middle).h / 2 + POS_ANCHOR_RADIUS + 8);
  }
  const targetAbove = yTarget < yStop;
  posLabel(scope, xm, yTarget, targetAbove ? "above" : "below", target, POS_PROFIT, undefined, levelGap);
  posLabel(scope, xm, yStop, targetAbove ? "below" : "above", stop, POS_STOP, undefined, levelGap);
  // Grey at zero, else green / red, with a white border.
  posLabel(scope, xm, Math.round(yMid), "center", middle, pnl > 0 ? POS_PROFIT : pnl < 0 ? POS_STOP : POS_LINE, "#ffffff");
}

function posFill(
  scope: BitmapCoordinatesRenderingScope,
  xa: number,
  xb: number,
  yFrom: number,
  yTo: number,
  fill: string,
): void {
  if (xb <= xa) return;
  const a = toBitmap(scope, xa, Math.min(yFrom, yTo));
  const b = toBitmap(scope, xb, Math.max(yFrom, yTo));
  const ctx = scope.context;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}

function drawSquareHandle(scope: BitmapCoordinatesRenderingScope, p: BPt, color: string): void {
  const ctx = scope.context;
  const r = HANDLE_RADIUS * scope.horizontalPixelRatio;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(p.x - r, p.y - r, r * 2, r * 2, 2 * scope.horizontalPixelRatio);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5 * scope.horizontalPixelRatio;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

// TradingView's text box metrics for these labels: 12px lines with no extra
// spacing, vertical padding of a third of the line, 4px horizontal padding
// and an even total width. Anchors are 6px in radius for the mouse.
const POS_LINE_H = 12;
const POS_PAD_Y = 4;
const POS_PAD_X = 4;
const POS_ANCHOR_RADIUS = 6;

/** Label box size in CSS pixels. */
function posLabelSize(scope: BitmapCoordinatesRenderingScope, lines: string[]): { w: number; h: number } {
  const ctx = scope.context;
  ctx.save();
  ctx.font = `12px ${POS_FONT}`;
  const text = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.restore();
  const w = Math.round(text + POS_PAD_X * 2);
  return { w: w % 2 ? w + 1 : w, h: lines.length * POS_LINE_H + POS_PAD_Y * 2 };
}

/** Solid rounded label with white 12px text, centred on x. */
function posLabel(
  scope: BitmapCoordinatesRenderingScope,
  x: number,
  y: number,
  place: "above" | "below" | "center",
  lines: string[],
  bg: string,
  border?: string,
  offsetY = 0,
): void {
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  const size = posLabelSize(scope, lines);
  const w = size.w * hpr;
  const h = size.h * vpr;
  const lineH = POS_LINE_H * vpr;
  const padY = POS_PAD_Y * vpr;
  const cx = x * hpr;
  const gap = offsetY * vpr;
  const top = place === "above" ? y * vpr - gap - h : place === "below" ? y * vpr + gap : y * vpr - h / 2;
  ctx.save();
  ctx.font = `${Math.round(12 * vpr)}px ${POS_FONT}`;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, top, w, h, 4 * hpr);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = hpr;
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, cx, top + padY + lineH * (i + 0.5)));
  ctx.restore();
}

function renderTrendline(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const seg = e.seg ?? { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };
  const sa = toBitmap(scope, seg.x1, seg.y1);
  const sb = toBitmap(scope, seg.x2, seg.y2);
  strokeLine(scope, sa, sb, e.d.color, e.d.width ?? LINE_WIDTH, dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH));
  if (e.d.arrowEnd) drawArrowhead(scope, sa, sb, e.d.color);
  if (e.d.arrowStart) drawArrowhead(scope, sb, sa, e.d.color);
  if (showHandles(e)) {
    drawHandle(scope, a, e.d.color);
    drawHandle(scope, b, e.d.color);
  }
  if (e.d.alertEnabled) {
    const right = a.x >= b.x ? a : b;
    drawAlertBadge(scope, right.x, right.y);
  }
  if (e.stats && e.stats.length > 0) drawStatsBox(scope, b, e.stats, e.d, a);
}

// Δprice / % / bars / angle readout near the second anchor (TV-style).
function drawStatsBox(
  scope: BitmapCoordinatesRenderingScope,
  at: BPt,
  stats: string[],
  d: { color: string },
  from: BPt,
): void {
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  const angleDeg = Math.round((Math.atan2(from.y - at.y, at.x - from.x) * 180) / Math.PI);
  const lines = [...stats, `${angleDeg}°`];
  ctx.save();
  ctx.font = `${Math.round(10 * vpr)}px monospace`;
  const lineH = 13 * vpr;
  const pad = 6 * hpr;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const height = lines.length * lineH + pad;
  const x = Math.min(at.x + 10 * hpr, scope.bitmapSize.width - width);
  const y = Math.min(at.y + 10 * vpr, scope.bitmapSize.height - height);
  ctx.fillStyle = "rgba(20, 24, 35, 0.92)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 4 * hpr);
  ctx.fill();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#e0e3ea";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, x + pad, y + pad / 2 + i * lineH);
  });
  ctx.restore();
}

function renderHorizontal(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.y1 === null) return;
  const y = Math.round(e.y1 * scope.verticalPixelRatio);
  strokeLine(
    scope,
    { x: 0, y },
    { x: scope.bitmapSize.width, y },
    e.d.color,
    e.d.width ?? 1.5,
    dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH),
  );
  if (showHandles(e))
    drawHandle(scope, { x: Math.round(scope.bitmapSize.width / 2), y }, e.d.color);
  if (e.d.alertEnabled) {
    drawAlertBadge(scope, scope.bitmapSize.width - 14 * scope.horizontalPixelRatio, y);
  }
}

// Amber bell dot marking a line that fires an alert when price crosses it.
function drawAlertBadge(scope: BitmapCoordinatesRenderingScope, x: number, y: number): void {
  const ctx = scope.context;
  const r = 4 * scope.horizontalPixelRatio;
  ctx.save();
  ctx.fillStyle = "#f0b90b";
  ctx.strokeStyle = "#1b1f2a";
  ctx.lineWidth = scope.horizontalPixelRatio;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function renderRectangle(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  const ctx = scope.context;
  ctx.save();
  ctx.fillStyle = hexToRgba(e.d.color, RECT_FILL_ALPHA);
  ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.strokeStyle = e.d.color;
  ctx.lineWidth = (e.d.width ?? 1.5) * scope.verticalPixelRatio;
  applyDash(scope, dashFor(e.d.lineStyle, e.d.width ?? LINE_WIDTH));
  ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.restore();
  if (showHandles(e)) drawRectHandles(scope, a, b, e.d.color);
}

function drawRectHandles(
  scope: BitmapCoordinatesRenderingScope,
  a: BPt,
  b: BPt,
  color: string,
): void {
  drawHandle(scope, a, color);
  drawHandle(scope, b, color);
  drawHandle(scope, { x: a.x, y: b.y }, color);
  drawHandle(scope, { x: b.x, y: a.y }, color);
}

function renderFibonacci(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.x2 === null || !e.fibLevels || e.fibLevels.length === 0) return;
  const xA = Math.round(Math.min(e.x1, e.x2) * scope.horizontalPixelRatio);
  const xB = Math.round(Math.max(e.x1, e.x2) * scope.horizontalPixelRatio);
  renderFibBands(scope, e.fibLevels, xA, xB);
  for (const lvl of e.fibLevels) renderFibLevel(scope, lvl, xA, xB);
  renderFibConnector(scope, e);
}

function renderFibBands(
  scope: BitmapCoordinatesRenderingScope,
  levels: ResolvedFibLevel[],
  xA: number,
  xB: number,
): void {
  const ctx = scope.context;
  for (let i = 0; i < levels.length - 1; i++) {
    const top = levels[i]!;
    const bottom = levels[i + 1]!;
    if (top.y === null || bottom.y === null) continue;
    const yA = Math.round(top.y * scope.verticalPixelRatio);
    const yB = Math.round(bottom.y * scope.verticalPixelRatio);
    ctx.fillStyle = hexToRgba(bottom.color, FIB_BAND_ALPHA);
    ctx.fillRect(xA, Math.min(yA, yB), xB - xA, Math.abs(yB - yA));
  }
}

function renderFibLevel(
  scope: BitmapCoordinatesRenderingScope,
  lvl: ResolvedFibLevel,
  xA: number,
  xB: number,
): void {
  if (lvl.y === null) return;
  const y = Math.round(lvl.y * scope.verticalPixelRatio);
  // TradingView: 2px level lines, 12px labels left of the levels.
  strokeLine(scope, { x: xA, y }, { x: xB, y }, lvl.color, 2);
  const ctx = scope.context;
  ctx.save();
  ctx.font = `${Math.round(12 * scope.verticalPixelRatio)}px ${POS_FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = lvl.color;
  ctx.fillText(lvl.label, xA - 6 * scope.horizontalPixelRatio, y);
  ctx.restore();
}

// Dashed diagonal between the two anchors, like TradingView's fib trend
// connector — also where the drag handles live.
function renderFibConnector(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return;
  const a = toBitmap(scope, e.x1, e.y1);
  const b = toBitmap(scope, e.x2, e.y2);
  // The trend line: cold grey, 2px, dashed.
  strokeLine(scope, a, b, "#808080", 2, [6, 4]);
  if (showHandles(e)) {
    drawHandle(scope, a, "#2962ff");
    drawHandle(scope, b, "#2962ff");
  }
}
