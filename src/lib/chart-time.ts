/**
 * The chart shows times in the viewer's own timezone, as TradingView does by
 * default. lightweight-charts has no timezone option and reads every time as
 * UTC, so intraday bar times are shifted by the local UTC offset on the way
 * into the chart ("chart time") and back on the way out. Daily and longer
 * bars are dates and are never shifted.
 *
 * Everything outside the chart (data, drawings, orders, replay) stays in real
 * UTC seconds; only the chart boundary converts.
 */

let shifting = true;

/** Turn the shift on for intraday intervals, off for daily and longer. */
export function setChartTimeShift(intraday: boolean): void {
  shifting = intraday;
}

/** The viewer's UTC offset in seconds at a UTC instant (DST-aware). */
export function localOffsetSec(utcSec: number): number {
  return -new Date(utcSec * 1000).getTimezoneOffset() * 60;
}

/** Real UTC seconds → the time handed to lightweight-charts. */
export function toChartTime(utcSec: number): number {
  return shifting ? utcSec + localOffsetSec(utcSec) : utcSec;
}

/** A time from lightweight-charts → real UTC seconds. */
export function fromChartTime(chartSec: number): number {
  if (!shifting) return chartSec;
  const guess = chartSec - localOffsetSec(chartSec);
  return chartSec - localOffsetSec(guess);
}

/** The viewer's offset as TradingView writes it: "UTC+8", "UTC−5:30", "UTC". */
export function utcOffsetLabel(at = Date.now() / 1000): string {
  const off = localOffsetSec(at) / 60;
  if (off === 0) return "UTC";
  const sign = off > 0 ? "+" : "−";
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}
