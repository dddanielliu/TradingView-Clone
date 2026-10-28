import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawCtxInfo, Hit, ResolvedEntry } from "./types";

/**
 * TradingView's Icon and Emoji tools (LineToolSvgIconBase / SvgIconPaneView):
 * one point at the glyph's centre, a size (72px by default) and an angle
 * (π/2 is upright). Selected or hovered, the glyph sits in a box padded by
 * 4 × max(1, size / 72), filled with the pane background at 60% transparency
 * and outlined in blue; its four corners resize, and just outside them
 * (within 20px) the glyph rotates.
 */

export type IconToolType = "icon" | "emoji";

export const ICON_TOOLS: Record<IconToolType, { points: number; color: string; name: string }> = {
  icon: { points: 1, color: "#2962ff", name: "Icon" },
  emoji: { points: 1, color: "#000000", name: "Emoji" },
};

export const DEFAULT_ICON = 0xf118; // smile-o
export const DEFAULT_EMOJI = "😀";

/**
 * The glyph the Icon / Emoji tools place next: TradingView's global
 * iconTool / emojiTool values, picked in the toolbar's Icons flyout.
 */
export const iconSelection: { icon: number; emoji: string } = { icon: DEFAULT_ICON, emoji: DEFAULT_EMOJI };
export function selectIcon(icon: number): void {
  iconSelection.icon = icon;
}
export function selectEmoji(emoji: string): void {
  iconSelection.emoji = emoji;
}
export const DEFAULT_ICON_SIZE = 72;
const BORDER_SELECTED = "#2962ff";
const BORDER_HOVERED = "rgba(41, 98, 255, 0.4)";

type P = { x: number; y: number };

// Font Awesome 4.7 (SIL OFL 1.1), the icon set TradingView's glyphs come from.
const FA_FAMILY = "FontAwesome";
const FA_URL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/fonts/fontawesome-webfont.woff2";
let faState: "idle" | "loading" | "ready" = "idle";
const loadListeners = new Set<() => void>();
/** Repaint when a font or picture this module waits on arrives. */
export function onIconAssetLoaded(fn: () => void): () => void {
  loadListeners.add(fn);
  return () => loadListeners.delete(fn);
}
const notify = () => loadListeners.forEach((fn) => fn());

export function ensureIconFont(): boolean {
  if (faState === "ready") return true;
  if (faState === "idle" && typeof FontFace !== "undefined") {
    faState = "loading";
    const face = new FontFace(FA_FAMILY, `url(${FA_URL}) format("woff2")`);
    face
      .load()
      .then((f) => {
        document.fonts.add(f);
        faState = "ready";
        notify();
      })
      .catch(() => {
        faState = "idle";
      });
  }
  return false;
}

/** Twemoji 13.0.1 file name for an emoji (its code points; U+FE0F dropped unless joined). */
export function twemojiCode(emoji: string): string {
  const s = emoji.includes("‍") ? emoji : emoji.replace(/️/g, "");
  return [...s].map((c) => c.codePointAt(0)!.toString(16)).join("-");
}
export function twemojiUrl(emoji: string, kind: "svg" | "png" = "svg"): string {
  const base = "https://cdnjs.cloudflare.com/ajax/libs/twemoji/13.0.1/";
  return kind === "svg" ? `${base}svg/${twemojiCode(emoji)}.svg` : `${base}72x72/${twemojiCode(emoji)}.png`;
}

const emojiImages = new Map<string, HTMLImageElement>();
function emojiImage(emoji: string): HTMLImageElement | null {
  let img = emojiImages.get(emoji);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = notify;
    img.src = twemojiUrl(emoji);
    emojiImages.set(emoji, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export const padding = (size: number) => 4 * Math.max(1, size / 72);

/** The box corners (pane px): top-right, top-left, bottom-left, bottom-right, as TradingView orders them. */
export function iconCorners(center: P, size: number, angle: number): P[] {
  const half = (size + 2 * padding(size)) / 2;
  const r = Math.SQRT2 * half;
  const m = -angle + Math.PI / 2;
  const c = r * Math.cos(m + Math.PI / 4);
  const s = r * Math.sin(m + Math.PI / 4);
  const c2 = r * Math.cos(m + (3 * Math.PI) / 4);
  const s2 = r * Math.sin(m + (3 * Math.PI) / 4);
  return [
    { x: center.x + c, y: center.y - s },
    { x: center.x + c2, y: center.y - s2 },
    { x: center.x - c, y: center.y + s },
    { x: center.x - c2, y: center.y + s2 },
  ];
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(hex.trim());
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : hex;
}

export function renderIconTool(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry, info: DrawCtxInfo): P[] {
  const d = e.d;
  const center = e.pts?.[0];
  if (!center) return [];
  const size = d.iconSize ?? DEFAULT_ICON_SIZE;
  const angle = d.angle ?? Math.PI / 2;
  const box = size + 2 * padding(size);
  const ctx = scope.context;
  const selected = e.state === "selected";
  const hovered = e.state === "hovered" && !d.locked;
  ctx.save();
  ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
  ctx.translate(center.x, center.y);
  ctx.rotate(angle - Math.PI / 2);
  if (selected || hovered) {
    ctx.fillStyle = hexToRgba(info.background ?? "#ffffff", 0.4);
    ctx.fillRect(-box / 2, -box / 2, box, box);
    ctx.strokeStyle = selected ? BORDER_SELECTED : BORDER_HOVERED;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-box / 2 - 0.75, -box / 2 - 0.75, box + 1.5, box + 1.5);
  }
  if (d.type === "emoji") {
    const img = emojiImage(d.emoji ?? DEFAULT_EMOJI);
    if (img) ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else if (ensureIconFont()) {
    // Font Awesome glyphs sit on a 1792-unit em; fit the glyph's box into size × size.
    ctx.font = `${size}px ${FA_FAMILY}`;
    const ch = String.fromCodePoint(d.icon ?? DEFAULT_ICON);
    const w = ctx.measureText(ch).width;
    const k = w > size ? size / w : 1;
    ctx.scale(k, k);
    ctx.fillStyle = d.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ch, 0, size * 0.07);
  }
  ctx.restore();
  return selected ? iconCorners(center, size, angle) : [];
}

/** Corners (resize), the box (move), then just outside the corners (rotate). */
export function hitIconTool(e: ResolvedEntry, p: P, handleTol: number): Hit | null {
  const center = e.pts?.[0];
  if (!center) return null;
  const d = e.d;
  const size = d.iconSize ?? DEFAULT_ICON_SIZE;
  const angle = d.angle ?? Math.PI / 2;
  const corners = iconCorners(center, size, angle);
  const selected = e.state === "selected";
  if (selected) {
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y) <= handleTol) {
        return { id: d.id, region: { kind: "iconCorner", index: i } };
      }
    }
  }
  // Into the glyph's frame: rotate back by the drawing angle.
  const r = -(angle - Math.PI / 2);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  const half = (size + 2 * padding(size)) / 2;
  if (Math.abs(lx) <= half && Math.abs(ly) <= half) return { id: d.id, region: { kind: "body" } };
  if (selected && !d.locked) {
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y) <= 20) {
        return { id: d.id, region: { kind: "iconRotate", index: i } };
      }
    }
  }
  return null;
}
