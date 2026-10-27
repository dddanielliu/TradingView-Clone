import { describe, expect, it } from "vitest";
import { forecastStatus, tvTimeSpan } from "../lib/chart-plugins/drawing-tools/forecast";

describe("Position forecast", () => {
  it("formats spans with every non-zero unit, as TradingView's TimeSpanFormatter", () => {
    expect(tvTimeSpan(8 * 3600 + 30 * 60)).toBe("8h 30m");
    expect(tvTimeSpan(86400 + 2 * 3600 + 5 * 60)).toBe("1d 2h 5m");
    expect(tvTimeSpan(-90)).toBe("-1m 30s");
  });
  it("judges success / failure on the target bar only", () => {
    const bars = [
      { time: 0, high: 10, low: 9 },
      { time: 60, high: 12, low: 10 },
      { time: 120, high: 11, low: 10 },
    ];
    expect(forecastStatus(bars, 10, { time: 60, price: 11.5 })).toBe("success");
    expect(forecastStatus(bars, 10, { time: 60, price: 13 })).toBe("failure");
    expect(forecastStatus(bars, 10, { time: 120, price: 13 })).toBe("waiting"); // the live bar
    expect(forecastStatus(bars, 10, { time: 180, price: 13 })).toBe("waiting"); // in the future
    expect(forecastStatus(bars, 10, { time: 60, price: 9.5 })).toBe("failure"); // down, low never reached
  });
});
