import { safeStorage } from "../lib/safe-storage.ts";
import { uid } from "../lib/uid.ts";
import { PaperAccount, type PaperAccountState } from "./paper.ts";

/**
 * Paper-trading profiles: named paper accounts that outlive a replay and a
 * reload (after CheapTrader's backend/app/replay/profiles.py, MIT).
 *
 * There is always at least one profile. The first time the replay is used a
 * "Paper account" with 10,000 is made, and deleting the last one makes a
 * fresh one. Everything lives in this browser's localStorage.
 */

export const DEFAULT_PROFILE_NAME = "Paper account";
export const DEFAULT_BALANCE = 10_000;
export const NAME_MAX = 40;
const BALANCE_MIN = 1;
const BALANCE_MAX = 1_000_000_000;

const PROFILES_KEY = "replay_profiles_v1";
const ACTIVE_KEY = "replay_profile_active";

export interface ProfileSummary {
  id: string;
  name: string;
  createdAt: number;
  initialBalance: number;
  balance: number;
  trades: number;
}

interface StoredProfile {
  id: string;
  name: string;
  createdAt: number;
  account: PaperAccountState;
}

export class ProfileError extends Error {}

export function cleanName(name: string): string {
  const tidy = name.split(/\s+/).filter(Boolean).join(" ");
  if (!tidy) throw new ProfileError("Give the profile a name.");
  if (tidy.length > NAME_MAX) throw new ProfileError(`A profile name can have up to ${NAME_MAX} characters.`);
  return tidy;
}

export function checkBalance(balance: number): number {
  if (!Number.isFinite(balance)) throw new ProfileError("The starting balance must be a number.");
  if (balance < BALANCE_MIN || balance > BALANCE_MAX) {
    throw new ProfileError(`The starting balance must be between ${BALANCE_MIN} and ${BALANCE_MAX.toLocaleString()}.`);
  }
  return Math.round(balance * 100) / 100;
}

/**
 * The profile store. Accounts handed out are live objects: call `save()`
 * after changing one (the replay hook does so after every move and order).
 */
export class ProfileStore {
  private profiles: StoredProfile[] = [];
  private accounts = new Map<string, PaperAccount>();
  activeId = "";

  constructor() {
    this.load();
    if (this.profiles.length === 0) this.create(DEFAULT_PROFILE_NAME, DEFAULT_BALANCE);
    if (!this.profiles.some((p) => p.id === this.activeId)) this.activeId = this.profiles[0]!.id;
  }

  list(): ProfileSummary[] {
    return this.profiles.map((p) => {
      const a = this.account(p.id);
      return {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        initialBalance: a.initialBalance,
        balance: a.balance,
        trades: a.closed.length,
      };
    });
  }

  active(): PaperAccount {
    return this.account(this.activeId);
  }

  activeName(): string {
    return this.profiles.find((p) => p.id === this.activeId)?.name ?? DEFAULT_PROFILE_NAME;
  }

  account(id: string): PaperAccount {
    let a = this.accounts.get(id);
    if (!a) {
      const p = this.profiles.find((x) => x.id === id);
      if (!p) throw new ProfileError("No such profile.");
      a = PaperAccount.fromJSON(p.account);
      this.accounts.set(id, a);
    }
    return a;
  }

  create(name: string, balance: number): string {
    const id = uid();
    const account = new PaperAccount(checkBalance(balance));
    this.profiles.push({ id, name: cleanName(name), createdAt: Date.now(), account: account.toJSON() });
    this.accounts.set(id, account);
    this.activeId = id;
    this.save();
    return id;
  }

  select(id: string): void {
    if (!this.profiles.some((p) => p.id === id)) throw new ProfileError("No such profile.");
    this.activeId = id;
    this.save();
  }

  rename(id: string, name: string): void {
    const p = this.profiles.find((x) => x.id === id);
    if (!p) throw new ProfileError("No such profile.");
    p.name = cleanName(name);
    this.save();
  }

  /** Start a profile over, optionally with a new starting balance. */
  reset(id: string, balance?: number): void {
    this.account(id).reset(balance != null ? checkBalance(balance) : undefined);
    this.save();
  }

  remove(id: string): void {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    this.accounts.delete(id);
    if (this.profiles.length === 0) {
      this.create(DEFAULT_PROFILE_NAME, DEFAULT_BALANCE);
      return;
    }
    if (this.activeId === id) this.activeId = this.profiles[0]!.id;
    this.save();
  }

  save(): void {
    for (const p of this.profiles) {
      const live = this.accounts.get(p.id);
      if (live) p.account = live.toJSON();
    }
    try {
      safeStorage.setItem(PROFILES_KEY, JSON.stringify(this.profiles));
      safeStorage.setItem(ACTIVE_KEY, this.activeId);
    } catch {
      // A full or blocked storage must not stop the replay.
    }
  }

  private load(): void {
    try {
      const raw = safeStorage.getItem(PROFILES_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        this.profiles = parsed.filter(
          (p): p is StoredProfile =>
            typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.account === "object",
        );
      }
      this.activeId = safeStorage.getItem(ACTIVE_KEY) ?? "";
    } catch {
      this.profiles = [];
    }
  }
}
