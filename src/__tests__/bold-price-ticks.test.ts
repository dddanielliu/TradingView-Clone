import { describe, expect, it } from "vitest";
import { boldTicks, priceTicks } from "../lib/chart-plugins/bold-price-ticks.ts";

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let v = from; v >= to; v -= step) out.push(v);
  return out;
};

describe("bold price-scale labels (TradingView's rule)", () => {
  it("bolds the fives among whole-dollar ticks", () => {
    // AAPL 15m on TradingView: 353 … 338 with 350, 345 and 340 bold.
    expect(boldTicks(range(353, 338, 1), 100)).toEqual([350, 345, 340]);
  });

  it("bolds the hundreds among twenties", () => {
    // BTC 1m: 80,240 … 79,800 with 80,200 / 80,100 / 80,000 / 79,900 / 79,800 bold.
    expect(boldTicks(range(80_240, 79_800, 20), 100)).toEqual([80_200, 80_100, 80_000, 79_900, 79_800]);
  });

  it("bolds nothing with a single tick", () => {
    expect(boldTicks([3], 100)).toEqual([]);
  });

  it("rebuilds lightweight-charts' tick spacing", () => {
    // 30px per label: a 750px scale over 15 dollars gets a tick every dollar.
    const ticks = priceTicks(353.4, 337.6, 750, 100);
    expect(ticks[0]).toBeCloseTo(353);
    expect(ticks[1]! - ticks[2]!).toBeCloseTo(1);
  });
});
