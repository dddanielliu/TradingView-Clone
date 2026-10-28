import { describe, expect, it } from "vitest";
import {
  countdownText,
  daySegments,
  marketStatusAt,
  nextSessionEdge,
  remainingTimeText,
  timezoneLabel,
  type SymbolSessions,
} from "../market/session.ts";

// NASDAQ:AAPL as TradingView describes it.
const AAPL: SymbolSessions = {
  timezone: "America/New_York",
  session: "0930-1600",
  preMarket: "0400-0930",
  postMarket: "1600-2000",
  night: "2000-0400",
  holidays: "20261126,20261225",
};
const BTC: SymbolSessions = { timezone: "Etc/UTC", session: "24x7" };
const EURUSD: SymbolSessions = { timezone: "America/New_York", session: "1700-1700" };
const DXY: SymbolSessions = { timezone: "America/New_York", session: "1900-1900:3456|1700F-1900:2" };

const at = (iso: string) => Date.parse(iso);
const countdown = (s: SymbolSessions, ms: number) => countdownText(marketStatusAt(s, ms), nextSessionEdge(s, ms)!);

describe("market status", () => {
  it("is overnight on a weekday night, with pre-market next (as on TradingView)", () => {
    const t = at("2026-10-28T03:35:00Z"); // Tue 23:35 New York
    expect(marketStatusAt(AAPL, t)).toBe("overnight");
    expect(countdown(AAPL, t)).toBe("Pre-market will start in 4 hours and 25 minutes.");
  });

  it("goes pre-market, open, then post-market through the day", () => {
    expect(marketStatusAt(AAPL, at("2026-10-28T09:00:00Z"))).toBe("pre"); // 05:00
    expect(countdown(AAPL, at("2026-10-28T09:00:00Z"))).toBe("It’ll open fully in 4 hours and 30 minutes.");
    expect(marketStatusAt(AAPL, at("2026-10-28T14:00:00Z"))).toBe("open"); // 10:00
    // The close meets post-market's start: TradingView tags the edge post-market.
    expect(countdown(AAPL, at("2026-10-28T14:00:00Z"))).toBe("It'll go to post-market trading in 6 hours and 0 minutes.");
    expect(marketStatusAt(AAPL, at("2026-10-28T21:00:00Z"))).toBe("post"); // 17:00
    expect(countdown(AAPL, at("2026-10-28T21:00:00Z"))).toBe("It'll close in 3 hours and 0 minutes.");
  });

  it("is closed at the weekend and counts across the DST change", () => {
    const t = at("2026-10-31T16:00:00Z"); // Sat 12:00 EDT; clocks go back on Sun 1 Nov
    expect(marketStatusAt(AAPL, t)).toBe("close");
    // Monday 04:00 EST = 09:00Z: 1 day 17 hours away.
    expect(countdown(AAPL, t)).toBe("It'll open for pre-market trading in 1 day and 17 hours.");
  });

  it("is on holiday on a session holiday", () => {
    expect(marketStatusAt(AAPL, at("2026-11-26T17:00:00Z"))).toBe("holiday"); // Thanksgiving, 12:00 EST
  });

  it("is always open around the clock, closing at the end of the UTC day", () => {
    const t = at("2026-10-28T03:34:30Z");
    expect(marketStatusAt(BTC, t)).toBe("open");
    expect(countdown(BTC, t)).toBe("It'll close in 20 hours and 25 minutes.");
  });

  it("runs forex from Sunday 17:00 to Friday 17:00 New York", () => {
    expect(marketStatusAt(EURUSD, at("2026-10-31T16:00:00Z"))).toBe("close"); // Saturday
    expect(marketStatusAt(EURUSD, at("2026-11-01T23:00:00Z"))).toBe("open"); // Sun 18:00 EST
    expect(marketStatusAt(EURUSD, at("2026-10-30T22:00:00Z"))).toBe("close"); // Fri 18:00 EDT
  });

  it("reads alternatives and the F (previous day) flag", () => {
    expect(marketStatusAt(DXY, at("2026-11-01T23:00:00Z"))).toBe("open"); // Sun 18:00: Monday's 1700F
    expect(marketStatusAt(DXY, at("2026-11-02T23:30:00Z"))).toBe("open"); // Mon 18:30: still Monday's
    expect(marketStatusAt(DXY, at("2026-11-03T00:30:00Z"))).toBe("open"); // Mon 19:30: Tuesday's session
    expect(marketStatusAt(DXY, at("2026-11-07T00:30:00Z"))).toBe("close"); // Fri 19:30: after Friday's
  });
});

describe("texts and the day bar", () => {
  it("words the remaining time as TradingView does", () => {
    expect(remainingTimeText(30)).toBe("less than 1 minute");
    expect(remainingTimeText(60)).toBe("1 minute");
    expect(remainingTimeText(3600 + 60)).toBe("1 hour and 1 minute");
    expect(remainingTimeText(86400 * 2 + 3600 * 3)).toBe("2 days and 3 hours");
  });

  it("lays out the exchange day's sessions", () => {
    const { weekday, segments } = daySegments(AAPL, at("2026-10-28T03:35:00Z")); // Tue 23:35
    expect(weekday).toBe("TUE");
    expect(segments.map((s) => [s.status, s.from, s.to])).toEqual([
      ["overnight", 0, 240],
      ["pre", 240, 570],
      ["open", 570, 960],
      ["post", 960, 1200],
      ["overnight", 1200, 1440],
    ]);
  });

  it("labels the time zone", () => {
    expect(timezoneLabel("America/New_York", at("2026-10-28T03:35:00Z"))).toBe("New York (UTC-4)");
    expect(timezoneLabel("Etc/UTC", at("2026-10-28T03:35:00Z"))).toBe("UTC");
  });
});
