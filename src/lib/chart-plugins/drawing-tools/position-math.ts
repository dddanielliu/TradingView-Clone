/**
 * Long / short position tool calculations, matching TradingView's position
 * tool (its documented formulas and defaults; see
 * tradingview.com/support/solutions/43000475660):
 *
 *   QtyRisk  = RiskSize / (|Entry − Stop| × PointValue) / LotSize
 *   QtyLvg   = AccountSize × Leverage / Entry × PointValue / LotSize
 *   Qty      = min(QtyRisk, QtyLvg)
 *   Amount   = AccountSize ± (Level − Entry) × Qty × PointValue × LotSize
 *   RR       = |Target − Entry| / |Entry − Stop|
 *
 * Defaults are TradingView's: account 1000, lot 1, risk 25 % of the account,
 * leverage 10 000. On placement both levels sit 20 % of the visible price
 * range from the entry and the box spans max(3, 15 % of the visible bars).
 */

export const POSITION_DEFAULTS = {
  accountSize: 1000,
  lotSize: 1,
  riskPct: 25,
  leverage: 10_000,
} as const;

/** Fraction of the visible price range each default level sits from the entry. */
export const DEFAULT_LEVEL_FRACTION = 0.2;

/** Bars from entry to the box's right edge for a freshly placed tool. */
export function defaultWidthBars(visibleBars: number): number {
  return Math.max(3, Math.round(0.15 * visibleBars));
}

/** Default stop / profit distance in price, snapped to whole ticks. */
export function defaultLevelOffset(visibleRange: number, tickSize: number): number {
  const base = tickSize > 0 ? 1 / tickSize : 100;
  return Math.max(1, Math.round(DEFAULT_LEVEL_FRACTION * visibleRange * base)) / base;
}

export interface PositionInput {
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  accountSize?: number;
  lotSize?: number;
  riskPct?: number;
  leverage?: number;
}

export interface PositionSizing {
  qty: number;
  riskSize: number;
  rr: number;
  amountTarget: number;
  amountStop: number;
}

const round2 = (v: number) => parseFloat(v.toFixed(2));

export function positionSizing(p: PositionInput): PositionSizing {
  const account = p.accountSize ?? POSITION_DEFAULTS.accountSize;
  const lot = p.lotSize ?? POSITION_DEFAULTS.lotSize;
  const leverage = p.leverage ?? POSITION_DEFAULTS.leverage;
  const riskSize = (account * (p.riskPct ?? POSITION_DEFAULTS.riskPct)) / 100;
  const risk = Math.abs(p.entry - p.stop);
  const reward = Math.abs(p.target - p.entry);
  const qtyRisk = risk > 0 ? riskSize / risk / lot : Infinity;
  const qtyLvg = p.entry > 0 ? (account * leverage) / p.entry / lot : Infinity;
  const qty = Number.isFinite(Math.min(qtyRisk, qtyLvg)) ? Math.min(qtyRisk, qtyLvg) : 0;
  const dir = p.side === "long" ? 1 : -1;
  return {
    qty,
    riskSize,
    rr: risk > 0 ? reward / risk : 0,
    amountTarget: round2(account + (p.target - p.entry) * dir * qty * lot),
    amountStop: round2(account + (p.stop - p.entry) * dir * qty * lot),
  };
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type CloseKind = "target" | "stop" | "open";

export interface PositionOutcome {
  /** Bar where price first traded through the entry, if any inside the box. */
  entryBar: Bar | null;
  /** Where the trade is closed (or marked, when still open). */
  closeTime: number;
  closePrice: number;
  kind: CloseKind;
  /** P&L in price units, as TradingView's "Open/Closed P&L" shows it. */
  pnl: number;
}

/**
 * Walk the bars inside the box [startTime, endTime]: the first bar whose range
 * contains the entry opens the trade; from there the first bar reaching the
 * stop (checked first) or the target closes it. Otherwise the trade is open
 * and marked at the last bar inside the box, or at `lastPrice` when the box
 * lies entirely in the future.
 */
export function positionOutcome(
  p: PositionInput,
  startTime: number,
  endTime: number,
  bars: readonly Bar[],
  lastPrice: number | null,
): PositionOutcome {
  const long = p.side === "long";
  const inside = bars.filter((b) => b.time >= startTime && b.time <= endTime);
  let entryIdx = -1;
  for (let i = 0; i < inside.length; i++) {
    const b = inside[i]!;
    if (b.low <= p.entry && b.high >= p.entry) {
      entryIdx = i;
      break;
    }
  }
  const pnlAt = (price: number) => (long ? price - p.entry : p.entry - price);

  if (entryIdx >= 0) {
    for (let i = entryIdx; i < inside.length; i++) {
      const b = inside[i]!;
      const stopHit = long ? b.low <= p.stop : b.high >= p.stop;
      if (stopHit) return { entryBar: inside[entryIdx]!, closeTime: b.time, closePrice: p.stop, kind: "stop", pnl: pnlAt(p.stop) };
      const targetHit = long ? b.high >= p.target : b.low <= p.target;
      if (targetHit) return { entryBar: inside[entryIdx]!, closeTime: b.time, closePrice: p.target, kind: "target", pnl: pnlAt(p.target) };
    }
  }

  const last = inside[inside.length - 1];
  if (last) {
    return { entryBar: entryIdx >= 0 ? inside[entryIdx]! : null, closeTime: last.time, closePrice: last.close, kind: "open", pnl: pnlAt(last.close) };
  }
  const price = lastPrice ?? p.entry;
  return { entryBar: null, closeTime: startTime, closePrice: price, kind: "open", pnl: pnlAt(price) };
}

/** TradingView prints numbers without trailing zeros: 1250, 1.5, 0.33. */
export function trimNumber(v: number, maxDecimals = 2): string {
  return parseFloat(v.toFixed(maxDecimals)).toString();
}

/** Quantity as TradingView's default precision shows it. */
export function formatQty(qty: number): string {
  if (qty >= 1) return Math.floor(qty).toString();
  return trimNumber(qty, 4);
}
