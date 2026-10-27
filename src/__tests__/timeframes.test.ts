import { describe, expect, it } from "vitest";
import {
  aggregateTimeframe,
  futureBarTimes,
  baseTimeframe,
  liveBucket,
  parseTimeframe,
  sessionOpenOffset,
  timeframeSeconds,
} from "../market/timeframes.ts";
import { intervalToTimeframe, timeframeToInterval } from "../routing.ts";
import type { Candle } from "../services/schemas.ts";

const bar = (time: number, close: number, volume = 1): Candle => ({ time, open: close, high: close, low: close, close, volume });

describe("timeframes", () => {
  it("parses any count of minutes, hours, days, weeks and months", () => {
    expect(parseTimeframe("45m")).toEqual({ n: 45, unit: "m" });
    expect(parseTimeframe("12M")).toEqual({ n: 12, unit: "M" });
    expect(parseTimeframe("0m")).toBeNull();
    expect(parseTimeframe("5s")).toBeNull();
    expect(timeframeSeconds("3h")).toBe(10_800);
  });

  it("builds from the coarsest native interval that divides the target", () => {
    const binance = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"];
    expect(baseTimeframe("45m", binance)).toBe("15m");
    expect(baseTimeframe("10m", binance)).toBe("5m");
    expect(baseTimeframe("3h", binance)).toBe("1h");
    expect(baseTimeframe("12M", binance)).toBe("1M");
    expect(baseTimeframe("4h", binance)).toBe("4h");
    expect(baseTimeframe("6M", ["1m", "1d"])).toBe("1d");
    expect(baseTimeframe("7m", ["5m"])).toBeNull();
    expect(baseTimeframe("45m", undefined)).toBe("45m");
  });

  it("starts intraday buckets at each day's session open, as TradingView does", () => {
    const day = 86_400;
    const open = 13.5 * 3600; // 09:30 New York in UTC
    const rows = [0, 1, 2, 3, 4].flatMap((d) => [0, 15, 30, 45, 60, 75].map((m) => bar(d * day + open + m * 60, m)));
    expect(sessionOpenOffset(rows)).toBe(open);
    const out = aggregateTimeframe(rows, "45m");
    expect(out.slice(0, 2).map((c) => [c.time - open, c.close, c.volume])).toEqual([
      [0, 30, 3],
      [45 * 60, 75, 3],
    ]);
    expect(out[2]!.time).toBe(day + open);
    expect(liveBucket(day * 7 + open + 50 * 60, "45m", open)).toBe(day * 7 + open + 45 * 60);
  });

  it("groups months by calendar month", () => {
    const months = [0, 1, 2, 3, 4, 5].map((m) => bar(Date.UTC(2024, m, 1) / 1000, m));
    expect(aggregateTimeframe(months, "3M").map((c) => [new Date(c.time * 1000).getUTCMonth(), c.close])).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });
});

describe("chart URL intervals", () => {
  it("reads TradingView's interval spellings", () => {
    expect(intervalToTimeframe("45")).toBe("45m");
    expect(intervalToTimeframe("120")).toBe("2h");
    expect(intervalToTimeframe("D")).toBe("1d");
    expect(intervalToTimeframe("1W")).toBe("1w");
    expect(intervalToTimeframe("3M")).toBe("3M");
    expect(intervalToTimeframe("5S")).toBeNull();
  });

  it("writes them back", () => {
    expect(timeframeToInterval("45m")).toBe("45");
    expect(timeframeToInterval("4h")).toBe("240");
    expect(timeframeToInterval("1d")).toBe("D");
    expect(timeframeToInterval("12M")).toBe("12M");
  });
});

describe("future bar times", () => {
  it("continues a stock's session on trading weekdays only", () => {
    const day = 86_400;
    const monday = Date.UTC(2026, 9, 19) / 1000; // Mon 19 Oct 2026
    const open = 13.5 * 3600;
    const times = [0, 1, 2, 3, 4].flatMap((d) => [0, 1, 2].map((k) => monday + d * day + open + k * 3600));
    const next = futureBarTimes(times, "1h", 4);
    // Friday's last bar is followed by Monday's session, not Saturday's.
    expect(next.map((t) => new Date(t * 1000).toISOString())).toEqual([
      "2026-10-26T13:30:00.000Z",
      "2026-10-26T14:30:00.000Z",
      "2026-10-26T15:30:00.000Z",
      "2026-10-27T13:30:00.000Z",
    ]);
  });

  it("steps months by the calendar", () => {
    const next = futureBarTimes([Date.UTC(2026, 10, 1) / 1000], "3M", 2);
    expect(next.map((t) => new Date(t * 1000).toISOString().slice(0, 10))).toEqual(["2027-02-01", "2027-05-01"]);
  });
});
