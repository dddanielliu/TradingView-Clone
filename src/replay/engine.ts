import {
  type ClosedTrade,
  type OrderRequest,
  type OrderResult,
  PaperAccount,
  type ReplayBar,
} from "./paper.ts";

/**
 * Bar replay engine.
 *
 * A port of CheapTrader's ReplayEngine (backend/app/replay/engine.py, MIT).
 * It holds a fixed bar series and a cursor that can be stepped, sought and
 * rewound. The engine never fetches anything after it is built, so a replay is
 * deterministic and works offline; the browser sets the pace.
 */

export interface ReplayState {
  symbol: string;
  timeframe: string;
  index: number;
  total: number;
  cursorTime: number;
  firstTime: number;
  lastTime: number;
}

/** What a cursor move revealed and did. */
export interface Advance {
  state: ReplayState;
  /** Bars the cursor moved over, oldest first. */
  bars: ReplayBar[];
  /** Trades closed by a stop or target on the way (or by a rewind). */
  closed: ClosedTrade[];
}

export class ReplayEngine {
  index = 0;

  constructor(
    readonly symbol: string,
    readonly timeframe: string,
    public bars: ReplayBar[],
    public account: PaperAccount,
    public contractSize = 1,
  ) {}

  get total(): number {
    return this.bars.length;
  }

  get bar(): ReplayBar | undefined {
    return this.bars[Math.min(this.index, this.total - 1)];
  }

  get atEnd(): boolean {
    return this.index >= this.total - 1;
  }

  state(): ReplayState {
    return {
      symbol: this.symbol,
      timeframe: this.timeframe,
      index: this.index,
      total: this.total,
      cursorTime: this.bar?.time ?? 0,
      firstTime: this.bars[0]?.time ?? 0,
      lastTime: this.bars[this.total - 1]?.time ?? 0,
    };
  }

  /** Bars up to and including the cursor: what the chart shows. */
  visibleBars(): ReplayBar[] {
    return this.bars.slice(0, this.index + 1);
  }

  /**
   * Put the cursor on a bar and start a session of the paper account there.
   * The account keeps its balance and history; open positions are closed.
   */
  begin(index: number, reason: "session" | "rewind" = "session"): Advance {
    this.index = clamp(index, 0, this.total - 1);
    const bar = this.bar;
    const closed = bar ? this.account.beginSession(bar, this.contractSize, reason) : [];
    return { state: this.state(), bars: [], closed };
  }

  /**
   * Move the cursor anywhere. Forward is the same as playing: every bar on the
   * way is checked against the stops and targets, so jumping to the end gives
   * the result of having played it. Backward cannot undo trades, so positions
   * still open are closed where they stand and the curve starts again.
   */
  seek(target: number): Advance {
    if (this.total === 0) return { state: this.state(), bars: [], closed: [] };
    const to = clamp(target, 0, this.total - 1);
    if (to < this.index) return this.begin(to, "rewind");
    const bars = this.bars.slice(this.index + 1, to + 1);
    const closed: ClosedTrade[] = [];
    for (const bar of bars) closed.push(...this.account.onBar(bar));
    this.index = to;
    return { state: this.state(), bars, closed };
  }

  step(delta = 1): Advance {
    return this.seek(this.index + delta);
  }

  /** The replay is over: close what is still open at the price under the cursor. */
  end(): ClosedTrade[] {
    const bar = this.bar;
    return bar ? this.account.settleAll(bar, "session") : [];
  }

  /**
   * Swap in another series of the same instrument (another timeframe, or more
   * history) without touching the account: the cursor stays on the same
   * moment and nothing is replayed or settled.
   */
  rebase(bars: ReplayBar[], timeframe: string): ReplayEngine {
    const cursor = this.bar?.time ?? 0;
    const next = new ReplayEngine(this.symbol, timeframe, bars, this.account, this.contractSize);
    next.index = lastIndexAtOrBefore(bars, cursor);
    return next;
  }

  /** Trade on another account from here on; the old one is settled at the cursor. */
  useAccount(account: PaperAccount): ClosedTrade[] {
    if (account === this.account) return [];
    const settled = this.end();
    this.account = account;
    const bar = this.bar;
    if (bar) account.beginSession(bar, this.contractSize);
    return settled;
  }

  place(req: Omit<OrderRequest, "symbol">): OrderResult {
    const bar = this.bar;
    if (!bar) return { ok: false, error: "The replay has no bars" };
    return this.account.place({ ...req, symbol: this.symbol }, bar);
  }

  close(ticket: number): OrderResult {
    const bar = this.bar;
    if (!bar) return { ok: false, error: "The replay has no bars" };
    return this.account.close(ticket, bar);
  }

  /** Index of the bar whose time is closest to `time` (the earlier one on a tie). */
  nearestIndex(time: number): number {
    if (this.total === 0) return 0;
    const i = lowerBound(this.bars, time);
    if (i <= 0) return 0;
    if (i >= this.total) return this.total - 1;
    return time - this.bars[i - 1]!.time <= this.bars[i]!.time - time ? i - 1 : i;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** First index whose bar time is >= `time`. */
function lowerBound(bars: ReplayBar[], time: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Last index whose bar opened at or before `time` (0 when none did). */
export function lastIndexAtOrBefore(bars: ReplayBar[], time: number): number {
  const i = lowerBound(bars, time);
  if (i < bars.length && bars[i]!.time === time) return i;
  return Math.max(0, i - 1);
}
