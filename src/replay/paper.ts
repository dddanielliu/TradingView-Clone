/**
 * Paper account for bar replay.
 *
 * A port of CheapTrader's replay paper engine (backend/app/replay/paper.py,
 * MIT) to the browser. Orders fill at the close of the bar under the replay
 * cursor; every bar the cursor then moves over is checked against the open
 * positions' stops and targets using that bar's high and low.
 *
 * The account outlives a replay: it is a *profile* (see profiles.ts) with a
 * balance, the history of every closed trade and a few running figures that
 * carry on from one replay to the next. Only the equity curve belongs to one
 * session. Positions still open when a session ends are closed where the
 * cursor stood — a position opened at one date has no meaning at another.
 */

export interface ReplayBar {
  /** Bar open time, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ReplaySide = "BUY" | "SELL";

/** Why a trade was closed. "session"/"rewind" are closes forced by the replay itself. */
export type CloseReason = "sl" | "tp" | "manual" | "session" | "rewind";

export interface PaperPosition {
  ticket: number;
  symbol: string;
  side: ReplaySide;
  volume: number;
  priceOpen: number;
  contractSize: number;
  /** 0 = not set. */
  sl: number;
  tp: number;
  /** Entry bar time, unix seconds. */
  time: number;
  /** Price and time the position was last marked at. */
  markPrice: number;
  markTime: number;
}

export interface ClosedTrade {
  ticket: number;
  symbol: string;
  side: ReplaySide;
  volume: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  reason: CloseReason;
}

export interface EquityPoint {
  time: number;
  value: number;
}

export interface OrderRequest {
  symbol: string;
  side: ReplaySide;
  volume: number;
  sl?: number | null;
  tp?: number | null;
}

export type OrderResult = { ok: true; ticket: number; price: number } | { ok: false; error: string };

export interface PaperMetrics {
  initialBalance: number;
  balance: number;
  equity: number;
  realized: number;
  unrealized: number;
  totalReturnPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  /** Sharpe of the per-bar equity returns, not annualised. */
  sharpe: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgTrade: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
}

/** Everything that survives a reload, as plain JSON. */
export interface PaperAccountState {
  initialBalance: number;
  balance: number;
  nextTicket: number;
  positions: PaperPosition[];
  closed: ClosedTrade[];
  peak: number;
  maxDdValue: number;
  maxDdPct: number;
  retN: number;
  retMean: number;
  retM2: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function positionPnl(pos: PaperPosition, price: number): number {
  const dir = pos.side === "BUY" ? 1 : -1;
  return (price - pos.priceOpen) * dir * pos.volume * pos.contractSize;
}

export class PaperAccount {
  initialBalance: number;
  balance: number;
  positions = new Map<number, PaperPosition>();
  closed: ClosedTrade[] = [];
  /** This session's equity curve: it starts where the replay starts. */
  equityCurve: EquityPoint[] = [];
  contractSize = 1;
  private nextTicket = 1;
  // Running figures over every session's curve, kept with the profile.
  private peak: number;
  private maxDdValue = 0;
  private maxDdPct = 0;
  private retN = 0;
  private retMean = 0;
  private retM2 = 0;

  constructor(initialBalance = 10_000) {
    this.initialBalance = initialBalance;
    this.balance = initialBalance;
    this.peak = initialBalance;
  }

  // ── keeping it ────────────────────────────────────────────

  toJSON(): PaperAccountState {
    return {
      initialBalance: this.initialBalance,
      balance: this.balance,
      nextTicket: this.nextTicket,
      positions: [...this.positions.values()],
      closed: this.closed,
      peak: this.peak,
      maxDdValue: this.maxDdValue,
      maxDdPct: this.maxDdPct,
      retN: this.retN,
      retMean: this.retMean,
      retM2: this.retM2,
    };
  }

  static fromJSON(s: PaperAccountState): PaperAccount {
    const a = new PaperAccount(s.initialBalance);
    a.balance = s.balance;
    a.nextTicket = s.nextTicket;
    for (const p of s.positions) a.positions.set(p.ticket, { ...p });
    a.closed = s.closed.map((t) => ({ ...t }));
    a.peak = s.peak;
    a.maxDdValue = s.maxDdValue;
    a.maxDdPct = s.maxDdPct;
    a.retN = s.retN;
    a.retMean = s.retMean;
    a.retM2 = s.retM2;
    return a;
  }

  // ── sessions ──────────────────────────────────────────────

  /**
   * A replay starts (or the cursor was moved back) at `bar`. The balance, the
   * history and the running figures stay; positions still open are closed
   * where they were last marked and the equity curve starts again from here.
   */
  beginSession(bar: ReplayBar, contractSize: number, reason: CloseReason = "session"): ClosedTrade[] {
    const leftovers = this.settleAll(null, reason);
    this.contractSize = contractSize > 0 ? contractSize : 1;
    this.equityCurve = [];
    this.record(bar);
    return leftovers;
  }

  /** Close every open position at `bar`'s close, or where each was last marked (`bar` null). */
  settleAll(bar: ReplayBar | null, reason: CloseReason = "session"): ClosedTrade[] {
    const made: ClosedTrade[] = [];
    for (const pos of [...this.positions.values()]) {
      this.positions.delete(pos.ticket);
      const price = bar ? bar.close : pos.markPrice;
      const when = bar ? bar.time : Math.max(pos.markTime, pos.time);
      made.push(this.trade(pos, when, price, reason));
    }
    return made;
  }

  // ── trading ───────────────────────────────────────────────

  /** A market order, filled at the close of `bar` (a conservative replay fill). */
  place(req: OrderRequest, bar: ReplayBar): OrderResult {
    if (!(req.volume > 0) || !Number.isFinite(req.volume)) {
      return { ok: false, error: "Quantity must be greater than zero" };
    }
    const price = bar.close;
    const sl = req.sl || 0;
    const tp = req.tp || 0;
    // Validate the stops against the entry like a broker would.
    if (sl) {
      if (req.side === "BUY" && sl >= price) return { ok: false, error: "Stop loss must be below the entry for a buy" };
      if (req.side === "SELL" && sl <= price) return { ok: false, error: "Stop loss must be above the entry for a sell" };
    }
    if (tp) {
      if (req.side === "BUY" && tp <= price) return { ok: false, error: "Take profit must be above the entry for a buy" };
      if (req.side === "SELL" && tp >= price) return { ok: false, error: "Take profit must be below the entry for a sell" };
    }
    const ticket = this.nextTicket++;
    this.positions.set(ticket, {
      ticket,
      symbol: req.symbol,
      side: req.side,
      volume: req.volume,
      priceOpen: price,
      contractSize: this.contractSize,
      sl,
      tp,
      time: bar.time,
      markPrice: price,
      markTime: bar.time,
    });
    return { ok: true, ticket, price };
  }

  /** Change a position's stops; `null` clears one, `undefined` leaves it. */
  modify(ticket: number, sl: number | null | undefined, tp: number | null | undefined): OrderResult {
    const pos = this.positions.get(ticket);
    if (!pos) return { ok: false, error: `Position ${ticket} not found` };
    const price = pos.markPrice;
    const nextSl = sl === undefined ? pos.sl : sl || 0;
    const nextTp = tp === undefined ? pos.tp : tp || 0;
    const buy = pos.side === "BUY";
    if (nextSl && (buy ? nextSl >= price : nextSl <= price)) {
      return { ok: false, error: `Stop loss must be ${buy ? "below" : "above"} the current price` };
    }
    if (nextTp && (buy ? nextTp <= price : nextTp >= price)) {
      return { ok: false, error: `Take profit must be ${buy ? "above" : "below"} the current price` };
    }
    pos.sl = nextSl;
    pos.tp = nextTp;
    return { ok: true, ticket, price };
  }

  close(ticket: number, bar: ReplayBar): OrderResult {
    const pos = this.positions.get(ticket);
    if (!pos) return { ok: false, error: `Position ${ticket} not found` };
    this.positions.delete(ticket);
    this.trade(pos, bar.time, bar.close, "manual");
    // Closing by hand changes the account without the cursor moving, so the
    // curve records it here rather than lagging until the next bar.
    this.record(bar);
    return { ok: true, ticket, price: bar.close };
  }

  // ── per-bar processing ────────────────────────────────────

  /**
   * Check the stops and targets against the bar's range and close what was
   * hit. When a bar spans both, the stop is assumed to have come first (the
   * conservative reading). A bar that opens beyond a level fills at the open.
   */
  onBar(bar: ReplayBar): ClosedTrade[] {
    const made: ClosedTrade[] = [];
    for (const pos of [...this.positions.values()]) {
      const hit = levelHit(pos, bar);
      if (hit) {
        this.positions.delete(pos.ticket);
        made.push(this.trade(pos, bar.time, hit.price, hit.reason));
      } else {
        pos.markPrice = bar.close;
        pos.markTime = bar.time;
      }
    }
    this.record(bar);
    return made;
  }

  /** Note the account's equity at the bar the replay is on. */
  mark(bar: ReplayBar): void {
    this.record(bar);
  }

  // ── reporting ─────────────────────────────────────────────

  equity(price: number): number {
    let floating = 0;
    for (const p of this.positions.values()) floating += positionPnl(p, price);
    return this.balance + floating;
  }

  metrics(price: number): PaperMetrics {
    const equity = this.equity(price);
    const wins = this.closed.filter((t) => t.pnl > 0);
    const losses = this.closed.filter((t) => t.pnl < 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const peak = Math.max(this.peak, equity);
    const maxDrawdown = Math.max(this.maxDdValue, peak - equity);
    const maxDrawdownPct = Math.max(this.maxDdPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    let sharpe = 0;
    if (this.retN > 1) {
      const sd = Math.sqrt(this.retM2 / this.retN);
      if (sd > 0) sharpe = (this.retMean / sd) * Math.sqrt(this.retN);
    }
    const trades = this.closed.length;
    return {
      initialBalance: this.initialBalance,
      balance: this.balance,
      equity,
      realized: round2(this.balance - this.initialBalance),
      unrealized: equity - this.balance,
      totalReturnPct: ((equity - this.initialBalance) / this.initialBalance) * 100,
      maxDrawdown,
      maxDrawdownPct,
      sharpe,
      trades,
      wins: wins.length,
      losses: losses.length,
      winRate: trades ? (wins.length / trades) * 100 : 0,
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
      avgTrade: trades ? (grossProfit - grossLoss) / trades : 0,
      avgWin: wins.length ? grossProfit / wins.length : 0,
      avgLoss: losses.length ? -grossLoss / losses.length : 0,
      largestWin: wins.reduce((m, t) => Math.max(m, t.pnl), 0),
      largestLoss: losses.reduce((m, t) => Math.min(m, t.pnl), 0),
    };
  }

  /** Start the account over, optionally with a new starting balance. */
  reset(balance?: number): void {
    if (balance != null && balance > 0) this.initialBalance = balance;
    this.balance = this.initialBalance;
    this.positions.clear();
    this.closed = [];
    this.equityCurve = [];
    this.nextTicket = 1;
    this.peak = this.initialBalance;
    this.maxDdValue = 0;
    this.maxDdPct = 0;
    this.retN = 0;
    this.retMean = 0;
    this.retM2 = 0;
  }

  // ── internals ─────────────────────────────────────────────

  private trade(pos: PaperPosition, exitTime: number, exitPrice: number, reason: CloseReason): ClosedTrade {
    // Booked in cents so thousands of additions don't pile up float dust in a
    // balance that lives for good in the profile.
    const pnl = round2(positionPnl(pos, exitPrice));
    const t: ClosedTrade = {
      ticket: pos.ticket,
      symbol: pos.symbol,
      side: pos.side,
      volume: pos.volume,
      entryTime: pos.time,
      exitTime,
      entryPrice: pos.priceOpen,
      exitPrice,
      pnl,
      reason,
    };
    this.balance = round2(this.balance + pnl);
    this.closed.push(t);
    return t;
  }

  /**
   * Note the equity at `bar`; a second note for the same bar replaces the
   * first. The running figures are updated here so asking for metrics after
   * every bar of a fast replay never walks the whole curve.
   */
  private record(bar: ReplayBar): void {
    const value = this.equity(bar.close);
    const last = this.equityCurve[this.equityCurve.length - 1];
    if (last && last.time === bar.time) {
      last.value = value;
      return;
    }
    if (last && last.value) this.countReturn((value - last.value) / last.value);
    this.equityCurve.push({ time: bar.time, value });
    this.peak = Math.max(this.peak, value);
    const dd = this.peak - value;
    this.maxDdValue = Math.max(this.maxDdValue, dd);
    if (this.peak > 0) this.maxDdPct = Math.max(this.maxDdPct, (dd / this.peak) * 100);
  }

  /** Welford's running mean / variance of the per-bar returns. */
  private countReturn(r: number): void {
    this.retN += 1;
    const delta = r - this.retMean;
    this.retMean += delta / this.retN;
    this.retM2 += delta * (r - this.retMean);
  }
}

function levelHit(pos: PaperPosition, bar: ReplayBar): { price: number; reason: CloseReason } | null {
  if (pos.side === "BUY") {
    if (pos.sl && bar.low <= pos.sl) return { price: Math.min(pos.sl, bar.open), reason: "sl" };
    if (pos.tp && bar.high >= pos.tp) return { price: Math.max(pos.tp, bar.open), reason: "tp" };
  } else {
    if (pos.sl && bar.high >= pos.sl) return { price: Math.max(pos.sl, bar.open), reason: "sl" };
    if (pos.tp && bar.low <= pos.tp) return { price: Math.min(pos.tp, bar.open), reason: "tp" };
  }
  return null;
}
