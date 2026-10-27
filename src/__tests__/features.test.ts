import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { __resetBus } from "@/services/demo/bus";
import * as engine from "@/services/demo/engine";
import { safeStorage } from "@/lib/safe-storage";

const ACCOUNT = "demo-account";

beforeEach(() => {
  engine.__resetForTests();
  __resetBus();
  safeStorage.removeItem("oc_journal_entries");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trade journal persistence", () => {
  it("starts empty", async () => {
    await expect(api.getJournalEntries(ACCOUNT)).resolves.toEqual({ entries: [], total: 0 });
  });

  it("round-trips an entry", async () => {
    const created = await api.createJournalEntry({
      accountId: ACCOUNT,
      symbolName: "BTCUSD",
      notes: "Took the breakout",
      tags: ["breakout"],
      rating: 4,
    });
    expect(created.id).toBeTruthy();

    const { entries, total } = await api.getJournalEntries(ACCOUNT);
    expect(total).toBe(1);
    expect(entries[0]).toMatchObject({
      symbolName: "BTCUSD",
      notes: "Took the breakout",
      tags: ["breakout"],
      rating: 4,
    });
  });

  it("survives a reload — entries live in storage, not memory", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "persisted" });
    const raw = safeStorage.getItem("oc_journal_entries");
    expect(raw).toContain("persisted");
  });

  it("keeps entries newest-first", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "first" });
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "second" });
    const { entries } = await api.getJournalEntries(ACCOUNT);
    expect(entries[0]?.notes).toBe("second");
  });

  it("updates an entry in place", async () => {
    const created = await api.createJournalEntry({ accountId: ACCOUNT, notes: "before" });
    const updated = await api.updateJournalEntry(created.id, { notes: "after", rating: 5 });
    expect(updated).toMatchObject({ notes: "after", rating: 5 });

    const { entries } = await api.getJournalEntries(ACCOUNT);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.notes).toBe("after");
  });

  it("returns null when updating an unknown entry", async () => {
    await expect(api.updateJournalEntry("nope", { notes: "x" })).resolves.toBeNull();
  });

  it("deletes an entry", async () => {
    const created = await api.createJournalEntry({ accountId: ACCOUNT, notes: "bye" });
    await api.deleteJournalEntry(created.id);
    await expect(api.getJournalEntries(ACCOUNT)).resolves.toEqual({ entries: [], total: 0 });
  });

  it("scopes entries to their account", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, notes: "mine" });
    await api.createJournalEntry({ accountId: "other", notes: "theirs" });
    const { entries, total } = await api.getJournalEntries(ACCOUNT);
    expect(total).toBe(1);
    expect(entries[0]?.notes).toBe("mine");
  });

  it("filters by symbol", async () => {
    await api.createJournalEntry({ accountId: ACCOUNT, symbolName: "BTCUSD", notes: "btc" });
    await api.createJournalEntry({ accountId: ACCOUNT, symbolName: "ETHUSD", notes: "eth" });
    const { entries } = await api.getJournalEntries(ACCOUNT, { symbol: "ETHUSD" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.notes).toBe("eth");
  });
});

