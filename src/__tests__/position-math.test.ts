import { describe, expect, it } from "vitest";
import {
  defaultLevelOffset,
  defaultWidthBars,
  formatQty,
  positionOutcome,
  positionSizing,
  trimNumber,
} from "@/lib/chart-plugins/drawing-tools/position-math";

const bar = (time: number, open: number, high: number, low: number, close: number) => ({ time, open, high, low, close });

describe("position tool sizing (TradingView's documented example)", () => {
  // Help-center example: entry 268.06, stop 259.36, target 276.76, account
  // 1000, risk 25 %, leverage 10 000 → Qty 28, Amount 1250 / 750, RR 1.
  const s = positionSizing({ side: "long", entry: 268.06, stop: 259.36, target: 276.76, leverage: 10_000 });

  it("sizes the position by risk", () => {
    expect(formatQty(s.qty)).toBe("28");
    expect(s.riskSize).toBe(250);
  });

  it("computes the closing balances and the ratio", () => {
    expect(trimNumber(s.amountTarget)).toBe("1250");
    expect(trimNumber(s.amountStop)).toBe("750");
    expect(trimNumber(s.rr)).toBe("1");
  });

  it("caps the quantity by leverage", () => {
    const capped = positionSizing({ side: "long", entry: 100, stop: 99.99, target: 100.01, leverage: 1 });
    expect(capped.qty).toBe(10);
  });

  it("mirrors the amounts for a short", () => {
    const short = positionSizing({ side: "short", entry: 100, stop: 110, target: 80 });
    expect(short.amountTarget).toBe(1500);
    expect(short.amountStop).toBe(750);
    expect(short.rr).toBe(2);
  });
});

describe("position tool placement defaults", () => {
  it("puts each level 20% of the visible range away, on whole ticks", () => {
    expect(defaultLevelOffset(10, 0.01)).toBe(2);
    expect(defaultLevelOffset(3.333, 0.01)).toBe(0.67);
  });

  it("spans max(3, 15% of the visible bars)", () => {
    expect(defaultWidthBars(10)).toBe(3);
    expect(defaultWidthBars(200)).toBe(30);
  });
});

describe("position tool outcome", () => {
  const long = { side: "long" as const, entry: 100, stop: 95, target: 110 };

  it("waits for price to reach the entry, then closes at the target", () => {
    const o = positionOutcome(long, 0, 1000, [bar(0, 102, 104, 101, 103), bar(60, 103, 103, 99, 100), bar(120, 100, 111, 100, 109)], null);
    expect(o.entryBar?.time).toBe(60);
    expect(o).toMatchObject({ kind: "target", closeTime: 120, closePrice: 110, pnl: 10 });
  });

  it("checks the stop before the target on the same bar", () => {
    const o = positionOutcome(long, 0, 1000, [bar(0, 100, 111, 94, 100)], null);
    expect(o).toMatchObject({ kind: "stop", pnl: -5 });
  });

  it("marks an open trade at the last bar inside the box", () => {
    const o = positionOutcome(long, 0, 60, [bar(0, 100, 101, 99, 100), bar(60, 100, 104, 100, 103), bar(120, 103, 120, 103, 119)], null);
    expect(o).toMatchObject({ kind: "open", closeTime: 60, pnl: 3 });
  });

  it("marks a box in the future at the last price", () => {
    const o = positionOutcome(long, 5000, 6000, [bar(0, 100, 101, 99, 100)], 104);
    expect(o).toMatchObject({ kind: "open", entryBar: null, pnl: 4 });
  });
});
