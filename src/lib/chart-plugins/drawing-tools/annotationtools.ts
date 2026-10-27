import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawCtxInfo, ResolvedEntry } from "./types";

/**
 * TradingView's text and note tools, ported from line-tool-text-note (Note),
 * -price-note, -note (Pin), -callout, -comment (Comment), -price-label,
 * -signpost, -flag-mark and -table with their renderers' exact geometry and
 * factory defaults. Each text box's rectangle is recorded so the in-place
 * editor can sit exactly over it.
 */

export type AnnotationToolType =
  | "textnote"
  | "pricenote"
  | "pin"
  | "table"
  | "callout"
  | "comment"
  | "pricelabel"
  | "signpost"
  | "flagmark"
  | "image";

export const ANNOTATION_TOOLS: Record<AnnotationToolType, { points: number; color: string; name: string; editsText: boolean }> = {
  textnote: { points: 2, color: "#000000", name: "Note", editsText: true },
  pricenote: { points: 2, color: "#2962ff", name: "Price note", editsText: false },
  pin: { points: 1, color: "#2962ff", name: "Pin", editsText: true },
  table: { points: 1, color: "#000000", name: "Table", editsText: true },
  callout: { points: 2, color: "#0097a7", name: "Callout", editsText: true },
  comment: { points: 1, color: "#2962ff", name: "Comment", editsText: true },
  pricelabel: { points: 1, color: "#2962ff", name: "Price label", editsText: false },
  signpost: { points: 1, color: "#808080", name: "Signpost", editsText: true },
  flagmark: { points: 1, color: "#2962ff", name: "Flag mark", editsText: false },
  image: { points: 1, color: "#000000", name: "Image", editsText: false },
};

const images = new Map<string, HTMLImageElement>();
/** A decoded picture for a data URL (drawn once it has loaded). */
function imageFor(url: string, onLoad: () => void): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** TradingView's first size for an image: fit a quarter of the pane, never enlarged. */
export function initialImageSize(natural: { w: number; h: number }, pane: { w: number; h: number }): { w: number; h: number } {
  const k = Math.min(1, pane.w / 4 / natural.w, pane.h / 4 / natural.h);
  return { w: Math.round(k * natural.w), h: Math.round(k * natural.h) };
}

/** Called when a picture finishes loading, to repaint. */
export let onImageLoaded: () => void = () => undefined;
export function setOnImageLoaded(fn: () => void): void {
  onImageLoaded = fn;
}

export function isAnnotationTool(type: string): type is AnnotationToolType {
  return type in ANNOTATION_TOOLS;
}

/** Drawings whose text is being edited in place: their text is left to the editor. */
export const editingText = new Set<string>();

/** The table cell being edited, per table. */
export const tableEdit = new Map<string, [number, number]>();

/** Where each drawing's editable text box was last drawn (pane media px). */
export const textBoxes = new Map<string, { x: number; y: number; w: number; h: number; fontSize: number }>();

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
type P = { x: number; y: number };

/** TradingView's alignByAngle: where a label sits relative to its point for a line's angle. */
function alignByAngle(deg: number): { h: "left" | "center" | "right"; v: "top" | "middle" | "bottom" } {
  if (deg >= -135 && deg <= -45) return { h: "center", v: "bottom" };
  if (deg > -45 && deg < 45) return { h: "left", v: "middle" };
  if (deg >= 45 && deg <= 135) return { h: "center", v: "top" };
  return { h: "right", v: "middle" };
}

function measureLines(ctx: CanvasRenderingContext2D, text: string): { lines: string[]; width: number } {
  const lines = (text || " ").split("\n");
  return { lines, width: Math.max(...lines.map((l) => ctx.measureText(l).width)) };
}

/** A padded, rounded text label placed by alignment around `at`. */
function textLabel(
  ctx: CanvasRenderingContext2D,
  at: P,
  text: string,
  o: {
    size: number;
    color: string;
    bg?: string;
    border?: string;
    padX: number;
    padY: number;
    radius: number;
    h: "left" | "center" | "right";
    v: "top" | "middle" | "bottom";
    shadow?: string;
    bold?: boolean;
    italic?: boolean;
    lineSpacing?: number;
    hideText?: boolean;
  },
): { x: number; y: number; w: number; h: number } {
  ctx.font = `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}${o.size}px ${FONT}`;
  const { lines, width } = measureLines(ctx, text);
  const gap = o.lineSpacing ?? 0;
  const w = Math.ceil(width) + o.padX * 2;
  const h = lines.length * o.size + (lines.length - 1) * gap + o.padY * 2;
  const x = o.h === "left" ? at.x : o.h === "right" ? at.x - w : at.x - w / 2;
  const y = o.v === "top" ? at.y : o.v === "bottom" ? at.y - h : at.y - h / 2;
  if (o.bg || o.border) {
    ctx.save();
    if (o.shadow) {
      ctx.shadowColor = o.shadow;
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, o.radius);
    if (o.bg) {
      ctx.fillStyle = o.bg;
      ctx.fill();
    }
    ctx.restore();
    if (o.border) {
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, o.radius);
      ctx.strokeStyle = o.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (!o.hideText) {
    ctx.fillStyle = o.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, x + o.padX, y + o.padY + i * (o.size + gap) + o.size / 2));
  }
  return { x, y, w, h };
}

/** The anchor dot with its 1px ring in the chart background (Note, Price note). */
function anchorDot(ctx: CanvasRenderingContext2D, p: P, color: string, ring: string): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.5, 0, 2 * Math.PI);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function renderAnnotationTool(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry, info: DrawCtxInfo): void {
  const d = e.d;
  const pts = e.pts ?? [];
  if (pts.length === 0) return;
  const ctx = scope.context;
  ctx.save();
  ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
  const type = d.type as AnnotationToolType;
  const [a, b] = pts;
  const record = (r: { x: number; y: number; w: number; h: number }, fontSize: number) => textBoxes.set(d.id, { ...r, fontSize });
  const selected = e.state === "hovered" || e.state === "selected" || e.state === "preview";
  const hideText = editingText.has(d.id);

  switch (type) {
    case "textnote": {
      if (!b) break;
      // Line in colorColdGray900, the anchor dot, and the label at the far
      // end aligned by the line's angle: white, 6 / 8px padding, 4px corners,
      // shadow black 80 % transparent.
      ctx.beginPath();
      ctx.moveTo(a!.x, a!.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      anchorDot(ctx, a!, d.color, "#ffffff");
      const al = alignByAngle(Math.round((180 * Math.atan2(b.y - a!.y, b.x - a!.x)) / Math.PI));
      record(
        textLabel(ctx, b, d.text ?? "", {
          size: d.fontSize ?? 14, color: d.textColor ?? "#000000", bg: "#ffffff", border: d.textBg ? "#ebebeb" : undefined,
          padX: 8, padY: 6, radius: 4, h: al.h, v: al.v, shadow: "rgba(0, 0, 0, 0.2)", bold: d.bold, italic: d.italic, hideText,
        }),
        d.fontSize ?? 14,
      );
      break;
    }
    case "pricenote": {
      if (!b) break;
      ctx.beginPath();
      ctx.moveTo(a!.x, a!.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      ctx.stroke();
      // The price of the first point in a 12px label at the far end.
      const al = alignByAngle(Math.round((180 * Math.atan2(b.y - a!.y, b.x - a!.x)) / Math.PI));
      textLabel(ctx, b, info.priceFormat(d.points![0]!.price), {
        size: 12, color: "#ffffff", bg: d.color, border: d.color, padX: 8, padY: 6, radius: 4, h: al.h, v: al.v,
      });
      anchorDot(ctx, a!, d.color, "#ffffff");
      // Optional text above the line's middle, along its slope.
      if (d.text) {
        const left = a!.x < b.x ? a! : b;
        const right = left === a ? b : a!;
        ctx.save();
        ctx.translate((a!.x + b.x) / 2, (a!.y + b.y) / 2);
        ctx.rotate(Math.atan((right.y - left.y) / (right.x - left.x || 1)));
        ctx.font = `${d.fontSize ?? 14}px ${FONT}`;
        ctx.fillStyle = d.textColor ?? d.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(d.text, 0, -2);
        ctx.restore();
      }
      break;
    }
    case "pin": {
      // The 24 × 30 marker standing on the point; the note as a tooltip
      // (12px padding, 4px corners, caret) while hovered or selected.
      const p = a!;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(p.x - 4, p.y - 8, p.x - 12, p.y - 14, p.x - 12, p.y - 19);
      ctx.arc(p.x, p.y - 19, 12, Math.PI, 0);
      ctx.bezierCurveTo(p.x + 12, p.y - 14, p.x + 4, p.y - 8, p.x, p.y);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y - 19, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      // The tooltip shows while hovered / selected, and always while being typed in.
      if ((selected && (d.text ?? "") !== "") || hideText) {
        ctx.font = `14px ${FONT}`;
        const { lines, width } = measureLines(ctx, d.text ?? "");
        const w = Math.max(236, Math.ceil(width) + 24);
        const h = lines.length * 14 + (lines.length - 1) * 5 + 24;
        const x = p.x - w / 2;
        const y = p.y - 30 - 13 - h;
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4);
        ctx.moveTo(p.x - 6, y + h);
        ctx.lineTo(p.x, y + h + 10);
        ctx.lineTo(p.x + 6, y + h);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#000000";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        if (!hideText) lines.forEach((l, i) => ctx.fillText(l, x + 12, y + 12 + i * 19 + 7));
        record({ x, y, w, h }, 14);
      } else if (selected) {
        record({ x: p.x - 118, y: p.y - 30 - 13 - 38, w: 236, h: 38 }, 14);
      }
      break;
    }
    case "callout": {
      if (!b) break;
      // Box centred on the second point, its border bending out to the first
      // (TradingView's RoundRadius 8, TextMargins 2), 2px border, fill at 50 %.
      const size = d.fontSize ?? 14;
      ctx.font = `${d.italic ? "italic " : ""}${d.bold ? "bold " : ""}${size}px ${FONT}`;
      const { lines, width } = measureLines(ctx, d.text ?? "");
      const r = 8;
      const m = 2;
      const tw = Math.ceil(width);
      const th = size * lines.length;
      const W = tw + 2 * m + 2 * r;
      const H = th + 2 * m + 2 * r;
      const left = b.x - W / 2;
      const top = b.y - H / 2;
      const pa = { x: a!.x - left, y: a!.y - top };
      const pb = { x: b.x - left, y: b.y - top };
      const wide = tw + 2 * m > 2 * r;
      const tall = th + 2 * m > 2 * r;
      let zone = 0;
      if (a!.x > left + W) zone = 20;
      else if (a!.x > left) zone = 10;
      if (a!.y > top + H) zone += 2;
      else if (a!.y > top) zone += 1;
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.moveTo(r, 0);
      if (zone === 10) {
        if (wide) {
          ctx.lineTo(pb.x - r, 0);
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(pb.x + r, 0);
          ctx.lineTo(W - r, 0);
        } else {
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(W - r, 0);
        }
      } else ctx.lineTo(W - r, 0);
      if (zone === 20) {
        ctx.lineTo(pa.x, pa.y);
        ctx.lineTo(W, r);
      } else ctx.arcTo(W, 0, W, r, r);
      if (zone === 21) {
        if (tall) {
          ctx.lineTo(W, pb.y - r);
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(W, pb.y + r);
          ctx.lineTo(W, H - r);
        } else {
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(W, H - r);
        }
      } else ctx.lineTo(W, H - r);
      if (zone === 22) {
        ctx.lineTo(pa.x, pa.y);
        ctx.lineTo(W - r, H);
      } else ctx.arcTo(W, H, W - r, H, r);
      if (zone === 12) {
        if (wide) {
          ctx.lineTo(pb.x + r, H);
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(pb.x - r, H);
          ctx.lineTo(r, H);
        } else {
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(r, H);
        }
      } else ctx.lineTo(r, H);
      if (zone === 2) {
        ctx.lineTo(pa.x, pa.y);
        ctx.lineTo(0, H - r);
      } else ctx.arcTo(0, H, 0, H - r, r);
      if (zone === 1) {
        if (tall) {
          ctx.lineTo(0, pb.y + r);
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(0, pb.y - r);
          ctx.lineTo(0, r);
        } else {
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(0, r);
        }
      } else ctx.lineTo(0, r);
      if (zone === 0) {
        ctx.lineTo(pa.x, pa.y);
        ctx.lineTo(r, 0);
      } else ctx.arcTo(0, 0, r, 0, r);
      ctx.lineCap = "round";
      ctx.strokeStyle = d.color;
      ctx.lineWidth = d.width ?? 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(0, 151, 167, 0.5)";
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = d.textColor ?? "#ffffff";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      if (!hideText) lines.forEach((l, i) => ctx.fillText(l, left + r + m, top + r + m + size * (i + 1)));
      record({ x: left + r + m, y: top + r + m, w: tw, h: th }, size);
      break;
    }
    case "comment": {
      // Blue bubble growing up-right from the point, its corner at the point
      // rounded only 2px; 16px white text, 12px horizontal padding.
      const size = d.fontSize ?? 16;
      const padV = Math.round(size / 1.3);
      ctx.font = `${size}px ${FONT}`;
      const { lines, width } = measureLines(ctx, d.text ?? "");
      const w = Math.ceil(width) + 24;
      const h = lines.length * size * 1.15 + padV * 2;
      const radius = Math.min(w, size * 1.15 + 2 * padV) / 2;
      const x = a!.x;
      const y = a!.y - h;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, [radius, radius, radius, 2]);
      ctx.fillStyle = d.fillColor ?? d.color;
      ctx.fill();
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = d.textColor ?? "#ffffff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      if (!hideText) lines.forEach((l, i) => ctx.fillText(l, x + 12, y + padV + size * 1.15 * (i + 0.5)));
      record({ x: x + 12, y: y + padV, w: w - 24, h: h - 2 * padV }, size);
      break;
    }
    case "pricelabel": {
      // Rounded box above-right of the point with its tail to it; bold 14px
      // white price, 10 / 5px padding, 2px border, dot at the tail's tip.
      const size = d.fontSize ?? 14;
      ctx.font = `bold ${size}px ${FONT}`;
      const label = info.priceFormat(d.points![0]!.price);
      const s = ctx.measureText(label).width + 20;
      const h = size + 10;
      ctx.save();
      ctx.translate(a!.x + 9, a!.y - (h + 15));
      ctx.beginPath();
      ctx.moveTo(12, h);
      ctx.lineTo(-9, h + 15);
      ctx.lineTo(5, h);
      ctx.lineTo(3, h);
      ctx.arcTo(0, h, 0, 0, 3);
      ctx.lineTo(0, 3);
      ctx.arcTo(0, 0, s, 0, 3);
      ctx.lineTo(s - 3, 0);
      ctx.arcTo(s, 0, s, h, 3);
      ctx.lineTo(s, h - 3);
      ctx.arcTo(s, h, 0, h, 3);
      ctx.lineTo(12, h);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillText(label, 10, h / 2 + Math.floor(0.35 * size));
      ctx.beginPath();
      ctx.arc(-9, h + 15, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "signpost": {
      // Pole from 3px off the bar to the label; the label's height in the
      // pane is the signpost's position (percent of the way to the edge).
      const bar = info.bars().find((x) => x.time >= d.points![0]!.time);
      const x = a!.x;
      const pos = d.signpostPos ?? 50;
      const dir = pos >= 0 ? 1 : -1;
      const price = bar ? (dir === 1 ? bar.high : bar.low) : d.points![0]!.price;
      const py = info.priceToY?.(price) ?? a!.y;
      const H = scope.mediaSize.height;
      const room = Math.min(H, Math.max(0, dir === 1 ? py : H - py));
      let labelY = py - dir * Math.abs((room * pos) / 100);
      labelY = Math.min(H - 2, Math.max(2, labelY));
      const poleStart = py - dir * 3;
      const size = d.fontSize ?? 12;
      ctx.font = `${d.italic ? "italic " : ""}${d.bold ? "bold " : ""}${size}px ${FONT}`;
      const { lines } = measureLines(ctx, d.text ?? "");
      const h = lines.length * size + (lines.length - 1) * 3 + 12;
      const labelEnd = dir === 1 ? labelY + h : labelY - h;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, poleStart);
      ctx.lineTo(Math.round(x) + 0.5, labelEnd);
      ctx.strokeStyle = "#808080";
      ctx.lineWidth = 1;
      ctx.stroke();
      record(
        textLabel(ctx, { x, y: labelY }, d.text ?? "", {
          size, color: d.textColor ?? "#000000", bg: "#ffffff", border: "#ebebeb", padX: 8, padY: 6, radius: 4,
          h: "center", v: dir === 1 ? "top" : "bottom", lineSpacing: 3, bold: d.bold, italic: d.italic, hideText,
        }),
        size,
      );
      break;
    }
    case "flagmark": {
      // A 1 × 20 grey pole and the flag 2px to its right, standing on the point.
      const x = Math.round(a!.x);
      const y = Math.round(a!.y - 20);
      ctx.fillStyle = "#808080";
      ctx.beginPath();
      ctx.roundRect(x, y, 1, 20, 1);
      ctx.fill();
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x + 16, y + 1);
      ctx.lineTo(x + 13, y + 5.5);
      ctx.lineTo(x + 16, y + 10);
      ctx.lineTo(x + 2, y + 10);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "image": {
      // Centred on its point at its own size (TradingView's default origin).
      if (!d.imageUrl || !d.cssWidth || !d.cssHeight) break;
      const img = imageFor(d.imageUrl, () => onImageLoaded());
      if (!img) break;
      ctx.drawImage(img, a!.x - d.cssWidth / 2, a!.y - d.cssHeight / 2, d.cssWidth, d.cssHeight);
      textBoxes.set(d.id, { x: a!.x - d.cssWidth / 2, y: a!.y - d.cssHeight / 2, w: d.cssWidth, h: d.cssHeight, fontSize: 0 });
      if (selected) {
        ctx.strokeStyle = "#2962ff";
        ctx.lineWidth = 1;
        ctx.strokeRect(a!.x - d.cssWidth / 2 + 0.5, a!.y - d.cssHeight / 2 + 0.5, d.cssWidth - 1, d.cssHeight - 1);
      }
      break;
    }
    case "table": {
      // 3 × 3 cells of 120px, rows of 14px × 1.3 + 2 × 8px padding, 1px
      // colorColdGray200 borders on white, black 14px text.
      const cells = d.cells ?? [["", "", ""], ["", "", ""], ["", "", ""]];
      const size = d.fontSize ?? 14;
      const colW = 120;
      const rowH = Math.ceil(size * 1.3) + 16;
      const x0 = a!.x;
      const y0 = a!.y;
      const cols = Math.max(...cells.map((r) => r.length));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x0, y0, cols * colW, cells.length * rowH);
      ctx.strokeStyle = "#dbdbdb";
      ctx.lineWidth = 1;
      for (let r = 0; r <= cells.length; r++) {
        ctx.beginPath();
        ctx.moveTo(x0, y0 + r * rowH + 0.5);
        ctx.lineTo(x0 + cols * colW, y0 + r * rowH + 0.5);
        ctx.stroke();
      }
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath();
        ctx.moveTo(x0 + c * colW + 0.5, y0);
        ctx.lineTo(x0 + c * colW + 0.5, y0 + cells.length * rowH);
        ctx.stroke();
      }
      ctx.font = `${size}px ${FONT}`;
      ctx.fillStyle = d.textColor ?? "#000000";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const [er, ec] = tableEdit.get(d.id) ?? [-1, -1];
      cells.forEach((row, r) =>
        row.forEach((t, c) => {
          if (!(hideText && r === er && c === ec)) ctx.fillText(t, x0 + c * colW + 9, y0 + r * rowH + rowH / 2);
        }),
      );
      const [rr, cc] = er >= 0 ? [er, ec] : [0, 0];
      record({ x: x0 + cc * colW + 9, y: y0 + rr * rowH + 8, w: colW - 18, h: rowH - 16 }, size);
      break;
    }
  }
  ctx.restore();
}

/** An image's corners (pane px), inset 1px as TradingView's anchors: TL, TR, BL, BR. */
export function imageCorners(center: { x: number; y: number }, w: number, h: number): { x: number; y: number }[] {
  const l = center.x - w / 2;
  const t = center.y - h / 2;
  return [
    { x: l + 1, y: t + 1 },
    { x: l + w - 1, y: t + 1 },
    { x: l + 1, y: t + h - 1 },
    { x: l + w - 1, y: t + h - 1 },
  ];
}
