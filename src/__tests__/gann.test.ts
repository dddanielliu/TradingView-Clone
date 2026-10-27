import { describe, expect, it } from "vitest";
import { alignGannIndex, alignGannPrice } from "../lib/chart-plugins/drawing-tools/gann";

describe("Gann box Shift snapping", () => {
  it("rounds the price distance up to the next Gann step at its power of ten", () => {
    expect(alignGannPrice(105, 100)).toBeCloseTo(109); // 5 → 9
    expect(alignGannPrice(110, 100)).toBeCloseTo(111.25); // 10 → 11.25
    expect(alignGannPrice(160, 100)).toBeCloseTo(190); // 60 → 90
    expect(alignGannPrice(95, 100)).toBeCloseTo(91); // −5 → −9
  });
  it("rounds bar distances up to whole-bar Gann steps", () => {
    expect(alignGannIndex(10, 0)).toBe(11);
    expect(alignGannIndex(-10, 0)).toBe(-11);
    expect(alignGannIndex(5, 0)).toBe(5);
    expect(alignGannIndex(9, 0)).toBe(9);
  });
});

import { regressionFit } from "../lib/chart-plugins/drawing-tools/linetools";

describe("Regression trend", () => {
  it("fits the closes, ±2 residual stdevs (n − 1), Pearson's R against the fit", () => {
    const bars = [10, 12, 11, 15, 14].map((close, i) => ({ time: i * 60, close }));
    const fit = regressionFit(bars, 0, 240)!;
    expect(fit.start).toBeCloseTo(10.2);
    expect(fit.end).toBeCloseTo(14.6);
    // residuals: -0.2, 0.7, -1.4, 1.5, -0.6 → sum sq 5.1, /4
    expect(fit.dev).toBeCloseTo(2 * Math.sqrt(5.1 / 4));
    expect(fit.pearson).toBeGreaterThan(0);
    const down = regressionFit(bars.map((b) => ({ ...b, close: -b.close })), 0, 240)!;
    expect(down.pearson).toBeCloseTo(fit.pearson); // R is never negative: price vs the fitted line
  });
});
