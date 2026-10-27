/**
 * TradingView's Ghost feed (line-tool-ghost-feed): random candles along each
 * leg between the clicked points, generated once and kept with the drawing.
 * Each bar is a price offset from the leg's line at that bar.
 */

export type GhostBar = [number, number, number, number]; // open, high, low, close offsets

/** GhostFeedSegment._createBar: average high−low `avg` (price), variance in percent. */
export function createGhostBar(avg: number, variancePct: number, rand: () => number = Math.random): GhostBar {
  const t = variancePct / 100;
  const shift = avg * (1 - 2 * rand()) * t;
  const range = avg * (1 + (0.5 - rand()) * t);
  const low = shift - range / 2;
  const high = low + range;
  return [low + rand() * range, high, low, low + rand() * range];
}

/** Bars per leg: the first spans its whole bar distance, later ones one fewer (the joint is shared). */
export function ghostSegmentSizes(indexes: number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k + 1 < indexes.length; k++) {
    const n = Math.abs(indexes[k + 1]! - indexes[k]!);
    out.push(n === 0 ? 0 : k ? n - 1 : n);
  }
  return out;
}

export function generateGhostBars(sizes: number[], avg: number, variancePct: number): GhostBar[][] {
  return sizes.map((n) => Array.from({ length: n }, () => createGhostBar(avg, variancePct)));
}

/** lightweight-charts' / TradingView's candle body width for a bar spacing (bitmap px). */
export function optimalCandlestickWidth(barSpacing: number, pixelRatio: number): number {
  if (barSpacing >= 2.5 && barSpacing <= 4) return Math.floor(3 * pixelRatio);
  const coeff = 1 - (0.2 * Math.atan(Math.max(4, barSpacing) - 4)) / (0.5 * Math.PI);
  const res = Math.floor(barSpacing * coeff * pixelRatio);
  return Math.max(Math.floor(pixelRatio), Math.min(res, Math.floor(barSpacing * pixelRatio)));
}
