import { beforeEach, describe, expect, it } from "vitest";
import { ReplayEngine, lastIndexAtOrBefore } from "@/replay/engine";
import { PaperAccount, type ReplayBar } from "@/replay/paper";
import { ProfileStore } from "@/replay/profiles";

const bar = (time: number, open: number, high: number, low: number, close: number): ReplayBar => ({
  time,
  open,
  high,
  low,
  close,
  volume: 1,
});

/** 10 bars, one per minute, drifting up by 1 from 100. */
function series(): ReplayBar[] {
  return Array.from({ length: 10 }, (_, i) => bar(60 * i, 100 + i, 100.5 + i, 99.5 + i, 100 + i));
}

function engineAt(index: number, balance = 10_000): ReplayEngine {
  const e = new ReplayEngine("TEST:X", "1m", series(), new PaperAccount(balance));
  e.begin(index);
  return e;
}

describe("paper account", () => {
  it("fills a market order at the close of the cursor bar", () => {
    const e = engineAt(2);
    const r = e.place({ side: "BUY", volume: 2 });
    expect(r).toEqual({ ok: true, ticket: 1, price: 102 });
    expect(e.account.equity(102)).toBe(10_000);
  });

  it("rejects stops on the wrong side of the entry", () => {
    const e = engineAt(2);
    expect(e.place({ side: "BUY", volume: 1, sl: 103 }).ok).toBe(false);
    expect(e.place({ side: "BUY", volume: 1, tp: 101 }).ok).toBe(false);
    expect(e.place({ side: "SELL", volume: 1, sl: 101 }).ok).toBe(false);
    expect(e.place({ side: "SELL", volume: 1, tp: 103 }).ok).toBe(false);
    expect(e.place({ side: "BUY", volume: 0 }).ok).toBe(false);
  });

  it("closes at the target when a later bar reaches it", () => {
    const e = engineAt(0);
    e.place({ side: "BUY", volume: 1, tp: 103 });
    const moved = e.step(3);
    expect(moved.closed).toHaveLength(1);
    expect(moved.closed[0]).toMatchObject({ reason: "tp", exitPrice: 103, pnl: 3, exitTime: 180 });
    expect(e.account.balance).toBe(10_003);
  });

  it("assumes the stop came first when one bar spans both levels", () => {
    const e = new ReplayEngine(
      "TEST:X",
      "1m",
      [bar(0, 100, 100, 100, 100), bar(60, 100, 110, 90, 100)],
      new PaperAccount(),
    );
    e.begin(0);
    e.place({ side: "BUY", volume: 1, sl: 95, tp: 105 });
    const { closed } = e.step();
    expect(closed[0]).toMatchObject({ reason: "sl", exitPrice: 95, pnl: -5 });
  });

  it("fills at the open when a bar gaps through the stop", () => {
    const e = new ReplayEngine(
      "TEST:X",
      "1m",
      [bar(0, 100, 100, 100, 100), bar(60, 90, 92, 88, 91)],
      new PaperAccount(),
    );
    e.begin(0);
    e.place({ side: "BUY", volume: 1, sl: 95 });
    expect(e.step().closed[0]).toMatchObject({ reason: "sl", exitPrice: 90, pnl: -10 });
  });

  it("checks every bar it jumps over, so a jump gives the result of playing", () => {
    const a = engineAt(0);
    a.place({ side: "SELL", volume: 1, sl: 104 });
    a.seek(9);
    const b = engineAt(0);
    b.place({ side: "SELL", volume: 1, sl: 104 });
    for (let i = 0; i < 9; i++) b.step();
    expect(a.account.closed).toEqual(b.account.closed);
    expect(a.account.closed[0]).toMatchObject({ reason: "sl", exitPrice: 104, exitTime: 240 });
  });

  it("closes open positions where they stand on a rewind and keeps the balance", () => {
    const e = engineAt(2);
    e.place({ side: "BUY", volume: 1 });
    e.step(3); // marked at 105
    const back = e.seek(1);
    expect(back.state.index).toBe(1);
    expect(back.closed[0]).toMatchObject({ reason: "rewind", exitPrice: 105, pnl: 3 });
    expect(e.account.positions.size).toBe(0);
    expect(e.account.balance).toBe(10_003);
  });

  it("modifies and validates stops against the current mark", () => {
    const e = engineAt(2);
    e.place({ side: "BUY", volume: 1 });
    expect(e.account.modify(1, 101, 110).ok).toBe(true);
    expect(e.account.modify(1, 103, undefined).ok).toBe(false);
    expect(e.account.modify(1, null, undefined).ok).toBe(true);
    expect(e.account.positions.get(1)).toMatchObject({ sl: 0, tp: 110 });
  });

  it("tracks drawdown, win rate and profit factor", () => {
    const e = engineAt(0);
    e.place({ side: "BUY", volume: 1 });
    e.step(4); // +4
    e.close(1);
    e.place({ side: "SELL", volume: 1 });
    e.step(2); // -2
    e.close(2);
    const m = e.account.metrics(e.bar!.close);
    expect(m.trades).toBe(2);
    expect(m.winRate).toBe(50);
    expect(m.profitFactor).toBe(2);
    expect(m.realized).toBe(2);
    expect(m.maxDrawdown).toBe(2);
  });

  it("round-trips through JSON", () => {
    const e = engineAt(1);
    e.place({ side: "BUY", volume: 3, tp: 120 });
    e.step(2);
    const copy = PaperAccount.fromJSON(JSON.parse(JSON.stringify(e.account.toJSON())));
    expect(copy.toJSON()).toEqual(e.account.toJSON());
  });
});

describe("replay engine", () => {
  it("reveals the bars it moves over", () => {
    const e = engineAt(3);
    expect(e.visibleBars()).toHaveLength(4);
    const moved = e.step(2);
    expect(moved.bars.map((b) => b.time)).toEqual([240, 300]);
    expect(e.step(100).state.index).toBe(9);
    expect(e.atEnd).toBe(true);
  });

  it("finds the nearest bar to a time", () => {
    const e = engineAt(0);
    expect(e.nearestIndex(-50)).toBe(0);
    expect(e.nearestIndex(89)).toBe(1);
    expect(e.nearestIndex(90)).toBe(1);
    expect(e.nearestIndex(91)).toBe(2);
    expect(e.nearestIndex(10_000)).toBe(9);
  });

  it("rebases onto another timeframe at the same moment without settling", () => {
    const e = engineAt(5);
    e.place({ side: "BUY", volume: 1 });
    const fiveMin = [bar(0, 100, 106, 99, 104), bar(300, 104, 110, 103, 109)];
    const next = e.rebase(fiveMin, "5m");
    expect(next.index).toBe(1);
    expect(next.account.positions.size).toBe(1);
    expect(lastIndexAtOrBefore(fiveMin, 299)).toBe(0);
  });
});

describe("profiles", () => {
  beforeEach(() => localStorage.clear());

  it("always has a default profile and persists accounts", () => {
    const store = new ProfileStore();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ name: "Paper account", balance: 10_000 });
    store.active().balance = 12_345;
    store.save();
    expect(new ProfileStore().active().balance).toBe(12_345);
  });

  it("creates, selects, resets and deletes", () => {
    const store = new ProfileStore();
    const id = store.create("  Swing   trades ", 50_000);
    expect(store.activeName()).toBe("Swing trades");
    store.active().balance = 1;
    store.reset(id, 25_000);
    expect(store.active()).toMatchObject({ balance: 25_000, initialBalance: 25_000 });
    store.remove(id);
    expect(store.list()).toHaveLength(1);
    expect(() => store.create("", 100)).toThrow();
    expect(() => store.create("x", -5)).toThrow();
  });
});
