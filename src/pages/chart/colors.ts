/** Colour strings as the drawing toolbar stores them: "#rrggbb", or "#rrggbbaa" below full opacity. */

/** "#rrggbb" (any "#rrggbbaa" alpha dropped), lower case. */
export function baseHex(c: string): string {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(c.trim());
  return m ? `#${m[1]!.toLowerCase()}` : c;
}

/** The alpha of "#rrggbbaa" (1 for "#rrggbb"). */
export function hexAlpha(c: string): number {
  const m = /^#?[0-9a-f]{6}([0-9a-f]{2})$/i.exec(c.trim());
  return m ? parseInt(m[1]!, 16) / 255 : 1;
}

/** The colour at an opacity: "#rrggbb" when opaque, else "#rrggbbaa". */
export function withOpacity(c: string, opacity: number): string {
  const base = baseHex(c);
  if (opacity >= 1) return base;
  return base + Math.round(Math.max(0, opacity) * 255).toString(16).padStart(2, "0");
}
