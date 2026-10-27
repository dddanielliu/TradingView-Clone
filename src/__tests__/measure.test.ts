import { describe, expect, it } from "vitest";
import { labelCenterY, measureText, tvVolume } from "../lib/chart-plugins/drawing-tools/measure";

describe("Measure", () => {
  it("writes TradingView's three lines", () => {
    const lines = measureText({
      from: { index: 10, price: 79934.3 },
      to: { index: 61, price: 80476.67 },
      seconds: 12 * 3600 + 45 * 60,
      volume: 10070,
      formatPrice: (p) => p.toFixed(2),
      minMove: 0.01,
    });
    expect(lines).toEqual(["542.37 (0.68%) 54,237", "51 bars, 12h 45m", "Vol 10.07 K"]);
  });
  it("signs a fall with the minus sign and drops volume when there is none", () => {
    const lines = measureText({
      from: { index: 5, price: 100 },
      to: { index: 2, price: 99 },
      seconds: -180,
      volume: NaN,
      formatPrice: (p) => (p < 0 ? `−${Math.abs(p).toFixed(2)}` : p.toFixed(2)),
      minMove: 0.01,
    });
    expect(lines).toEqual(["−1.00 (−1.00%) −100", "-3 bars, -3m"]);
  });
  it("formats volume as TradingView's VolumeFormatter", () => {
    expect(tvVolume(999)).toBe("999");
    expect(tvVolume(2230)).toBe("2.23 K");
    expect(tvVolume(1_234_567)).toBe("1.23 M");
  });
  it("puts the label above a rise and below a fall, kept inside the pane", () => {
    expect(labelCenterY(56, 300, 200, 10, 800)).toBe(200 - 10 - 28); // rising: above
    expect(labelCenterY(56, 200, 300, 10, 800)).toBe(300 + 10 + 28); // falling: below
    expect(labelCenterY(56, 300, 20, 10, 800)).toBe(300 + 10 + 28); // no room above: below
  });
});
