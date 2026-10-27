import type { DrawingLine } from "../../../pages/trading/constants";

/**
 * TradingView's Bars pattern (line-tool-bars-pattern): a frozen copy of the
 * bars between its points, drawn from the first point and stretched to the
 * second (bar spacing by their distance, price scale by their height).
 */

export type Bar4 = [number, number, number, number]; // open, high, low, close
const O = 0;
const H = 1;
const L = 2;
const C = 3;

type Mode = NonNullable<DrawingLine["barsMode"]>;

// The pattern price each mode anchors at the first / last bar (non-flipped).
const FIRST: Record<Mode, number> = { bars: H, line: C, openclose: O, lineopen: O, linehigh: H, linelow: L, linehl2: -1 };
const LAST: Record<Mode, number> = { bars: L, line: C, openclose: C, lineopen: O, linehigh: H, linelow: L, linehl2: -1 };

const priceOf = (b: Bar4, k: number) => (k < 0 ? (b[H] + b[L]) / 2 : b[k]!);

export function firstPatternPrice(pattern: Bar4[], mode: Mode, flipped: boolean): number {
  const b = pattern[0]!;
  return priceOf(b, flipped ? LAST[mode] : FIRST[mode]);
}

export function lastPatternPrice(pattern: Bar4[], mode: Mode, flipped: boolean): number {
  const b = pattern[pattern.length - 1]!;
  return priceOf(b, flipped ? FIRST[mode] : LAST[mode]);
}

/** What each mode plots per bar: a high–low or open–close bar, or one price. */
export function modeValue(b: Bar4, mode: Mode): [number, number] | number {
  switch (mode) {
    case "bars":
      return [b[H], b[L]];
    case "openclose":
      return [b[O], b[C]];
    case "line":
      return b[C];
    case "lineopen":
      return b[O];
    case "linehigh":
      return b[H];
    case "linelow":
      return b[L];
    case "linehl2":
      return (b[H] + b[L]) / 2;
  }
}

/** Mirror: every price reflected about the pattern's middle. */
export function mirrorPattern(pattern: Bar4[]): Bar4[] {
  let lo = Math.min(pattern[0]![L], pattern[0]![H]);
  let hi = Math.max(pattern[0]![L], pattern[0]![H]);
  for (const b of pattern.slice(1)) {
    lo = Math.min(lo, b[L]);
    hi = Math.max(hi, b[H]);
  }
  if (!(lo < hi)) return pattern;
  const mid = (lo + hi) / 2;
  const r = (v: number) => mid - (v - mid);
  return pattern.map((b) => [r(b[O]), r(b[H]), r(b[L]), r(b[C])]);
}

/** Flip: the bars in reverse order. */
export function flipPattern(pattern: Bar4[]): Bar4[] {
  return [...pattern].reverse();
}
