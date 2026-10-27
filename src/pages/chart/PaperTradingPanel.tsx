import { ChevronDown, ChevronRight, Download, EyeOff, Eye, Maximize2, Minus, Pencil, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { useClosedPositions } from "../../services/queries.ts";
import type { Account, ClosedPosition, Order, Position } from "../../services/schemas.ts";
import { notAvailable } from "./notAvailable.ts";
import { priceDigits } from "./shared.ts";

/**
 * The bottom "Paper Trading" panel, laid out like TradingView's: an account
 * bar, pill tabs (Positions · Orders · Order history · Balance history ·
 * Activity log · Trade history · Analytics) and TradingView's column sets.
 */

type Tab = "positions" | "orders" | "orderHistory" | "balance" | "activity" | "trades" | "analytics";

const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Orders" },
  { id: "orderHistory", label: "Order history" },
  { id: "balance", label: "Balance history" },
  { id: "activity", label: "Activity log" },
  { id: "trades", label: "Trade history" },
  { id: "analytics", label: "Analytics" },
];

const STARTING_BALANCE = 100_000;

const num = (v: number, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number, d = 2) => `${v < 0 ? "−" : ""}${num(Math.abs(v), d)}`;
const tone = (v: number) => (v > 0 ? "text-[#089981]" : v < 0 ? "text-[#f23645]" : "");
const ticker = (s: string) => s.slice(s.indexOf(":") + 1);
const stamp = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 19) : "—");

export function PaperTradingPanel({
  account,
  positions,
  orders,
  accountId,
  onClosePosition,
  onEditPosition,
  onCancelOrder,
  onEditOrder,
  onBuy,
  onSell,
  onMinimize,
  onMaximize,
}: {
  account: Account | undefined;
  positions: Position[];
  orders: Order[];
  accountId: string | null;
  onClosePosition: (id: string) => void;
  onEditPosition: (p: Position) => void;
  onCancelOrder: (id: string) => void;
  onEditOrder: (o: Order) => void;
  onBuy: () => void;
  onSell: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const [more, setMore] = useState(false);
  const [masked, setMasked] = useState(false);
  const { data: closedPage } = useClosedPositions(accountId);
  const closed = useMemo(() => closedPage?.data ?? [], [closedPage]);

  const balance = account?.balance ?? STARTING_BALANCE;
  const unrealized = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
  const equity = account?.equity ?? balance + unrealized;
  const margin = account?.margin ?? 0;
  const free = account?.freeMargin ?? equity - margin;
  const realized = balance - (account?.template?.startingBalance ?? STARTING_BALANCE);
  const show = (v: string) => (masked ? "•••" : v);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[40px] shrink-0 items-end bg-background">
        <div className="flex h-[38px] items-center gap-2 rounded-t-[6px] bg-card pl-4 pr-3 text-[14px]">
          <span className="flex h-[18px] w-[22px] items-center justify-center rounded-[3px] bg-tv-active text-[9px] font-bold text-tv-active-foreground">TV</span>
          <span className="relative">
            Paper Trading
            <span className="absolute -left-[22px] -top-[3px] h-[6px] w-[6px] rounded-full bg-[#089981]" />
          </span>
          <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <div className="flex-1" />
        <div className="flex h-[38px] items-center pr-2">
          <IconBtn title="Minimize panel" onClick={onMinimize}><Minus className="h-[18px] w-[18px]" strokeWidth={1.25} /></IconBtn>
          <IconBtn title="Maximize panel" onClick={onMaximize}><Maximize2 className="h-[16px] w-[16px]" strokeWidth={1.25} /></IconBtn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-card px-4 pt-3">
        <div className="flex h-[44px] shrink-0 items-center rounded-full border border-border px-4 text-[14px] tabular-nums">
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-5 overflow-x-auto whitespace-nowrap">
          <button type="button" onClick={() => notAvailable("Switching paper accounts")} className="flex shrink-0 items-center gap-1.5">
            <span>{account?.label ?? "Paper account"}</span>
            <span className="font-semibold">{show(num(balance))}</span>
            <span className="text-[11px] text-muted-foreground">USD</span>
            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <span className="h-[22px] w-px bg-border" />
          <Metric label="Equity" value={show(num(equity))} />
          <Metric label="Realized PnL" value={show(signed(realized))} className={masked ? "" : tone(realized)} />
          <Metric label="Unrealized PnL" value={show(signed(unrealized))} className={masked ? "" : tone(unrealized)} />
          <Metric label="Account margin" value={show(num(margin))} dotted />
          {more && (
            <>
              <Metric label="Available funds" value={show(num(free))} />
              <Metric label="Margin buffer" value={show(`${num(equity > 0 ? (free / equity) * 100 : 100)}%`)} />
            </>
          )}
          <button type="button" title={more ? "Less" : "More"} onClick={() => setMore((v) => !v)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-secondary">
            <ChevronRight className={cn("h-4 w-4 transition-transform", more && "rotate-180")} strokeWidth={1.5} />
          </button>
          </div>
          <button type="button" title={masked ? "Show values" : "Hide values"} onClick={() => setMasked((v) => !v)} className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-secondary">
            {masked ? <Eye className="h-[18px] w-[18px]" strokeWidth={1.25} /> : <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.25} />}
          </button>
        </div>

        <div className="flex h-[48px] shrink-0 items-center gap-1.5">
          {/* The pills scroll sideways when the panel is narrow; Export stays put. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => (t.id === "analytics" ? notAvailable("Trading analytics") : setTab(t.id))}
                className={cn(
                  "h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-[14px]",
                  tab === t.id ? "bg-tv-active text-tv-active-foreground" : "bg-pill hover:bg-secondary",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <IconBtn title="Export data" onClick={() => notAvailable("Exporting trading data")}><Download className="h-[18px] w-[18px]" strokeWidth={1.25} /></IconBtn>
        </div>

        <div className="tv-scroll min-h-0 flex-1 overflow-x-auto pb-2">
          {tab === "positions" && <PositionsTable positions={positions} onClose={onClosePosition} onEdit={onEditPosition} onBuy={onBuy} onSell={onSell} />}
          {tab === "orders" && <OrdersTable orders={orders.filter((o) => o.status === "PENDING" || o.status === "NEW")} onCancel={onCancelOrder} onEdit={onEditOrder} />}
          {tab === "orderHistory" && <OrderHistoryTable orders={orders.filter((o) => o.status !== "PENDING" && o.status !== "NEW")} />}
          {tab === "balance" && <BalanceHistoryTable closed={closed} start={account?.template?.startingBalance ?? STARTING_BALANCE} />}
          {tab === "activity" && <ActivityTable orders={orders} closed={closed} />}
          {tab === "trades" && <TradeHistoryTable closed={closed} />}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded hover:bg-secondary">
      {children}
    </button>
  );
}

function Metric({ label, value, className, dotted }: { label: string; value: string; className?: string; dotted?: boolean }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
      <span className={cn(dotted && "underline decoration-dotted underline-offset-4")}>{label}</span>
      <span className={cn("font-semibold", className)}>{value}</span>
    </span>
  );
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <>
      <table className="w-max min-w-full text-[13px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="h-[34px] whitespace-nowrap border-b border-border px-3 text-left text-[13px] font-normal normal-case tracking-normal text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty}
    </>
  );
}

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("h-[36px] whitespace-nowrap border-b border-border/60 px-3 tabular-nums", className)}>{children}</td>;
}

function Empty({ onBuy, onSell }: { onBuy?: () => void; onSell?: () => void }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="text-[18px] font-semibold">Make a trade to get started</div>
      <div className="mt-1 text-[14px] text-muted-foreground">Buy or sell — choose your pill.</div>
      {onBuy && onSell && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onSell} className="h-8 rounded-full bg-[#f23645] px-4 text-[14px] text-white hover:brightness-110">Sell</button>
          <button type="button" onClick={onBuy} className="h-8 rounded-full bg-[#2962ff] px-4 text-[14px] text-white hover:brightness-110">Buy</button>
        </div>
      )}
    </div>
  );
}

function SideCell({ side }: { side: string }) {
  const buy = side === "BUY" || side === "LONG";
  return <Cell className={buy ? "text-[#2962ff]" : "text-[#f23645]"}>{buy ? "Buy" : "Sell"}</Cell>;
}

function PositionsTable({
  positions,
  onClose,
  onEdit,
  onBuy,
  onSell,
}: {
  positions: Position[];
  onClose: (id: string) => void;
  onEdit: (p: Position) => void;
  onBuy: () => void;
  onSell: () => void;
}) {
  const head = ["Symbol", "Side", "Quantity", "Avg fill price", "Take profit", "Stop loss", "Last price", "Unrealized PnL", "Unrealized PnL %", "Trade value", "Market value", "Leverage", "Margin", "Expiration date", ""];
  return (
    <Table head={head} empty={positions.length === 0 ? <Empty onBuy={onBuy} onSell={onSell} /> : null}>
      {positions.map((p) => {
        const d = priceDigits(p.entryPrice);
        const last = p.currentPrice ?? p.entryPrice;
        const cs = p.contractSize ?? 1;
        const tradeValue = p.entryPrice * p.quantity * cs;
        const marketValue = last * p.quantity * cs;
        const pct = tradeValue ? (p.unrealizedPnl / tradeValue) * 100 : 0;
        return (
          <tr key={p.id} className="group hover:bg-secondary">
            <Cell className="font-semibold">{ticker(p.symbolName)}</Cell>
            <SideCell side={p.side} />
            <Cell>{p.quantity}</Cell>
            <Cell>{num(p.entryPrice, d)}</Cell>
            <Cell>{p.takeProfit != null ? num(p.takeProfit, d) : "—"}</Cell>
            <Cell>{p.stopLoss != null ? num(p.stopLoss, d) : "—"}</Cell>
            <Cell>{num(last, d)}</Cell>
            <Cell className={tone(p.unrealizedPnl)}>{signed(p.unrealizedPnl)}</Cell>
            <Cell className={tone(pct)}>{signed(pct)}%</Cell>
            <Cell>{num(tradeValue)}</Cell>
            <Cell>{num(marketValue)}</Cell>
            <Cell>—</Cell>
            <Cell>{num(p.margin)}</Cell>
            <Cell>—</Cell>
            <Cell className="w-[64px]">
              <span className="invisible flex gap-1 group-hover:visible">
                <IconBtn title="Protect position" onClick={() => onEdit(p)}><Pencil className="h-4 w-4" strokeWidth={1.25} /></IconBtn>
                <IconBtn title="Close position" onClick={() => onClose(p.id)}><X className="h-4 w-4" strokeWidth={1.5} /></IconBtn>
              </span>
            </Cell>
          </tr>
        );
      })}
    </Table>
  );
}

function OrdersTable({ orders, onCancel, onEdit }: { orders: Order[]; onCancel: (id: string) => void; onEdit: (o: Order) => void }) {
  const head = ["Symbol", "Side", "Type", "Quantity", "Limit price", "Stop price", "Fill price", "Take profit", "Stop loss", "Instruction", "Status", "Placing time", "Order ID", "Level ID", "Expiry", "Leverage", "Margin", ""];
  return (
    <Table head={head} empty={orders.length === 0 ? <div className="py-8 text-center text-[14px] text-muted-foreground">There are no working orders</div> : null}>
      {orders.map((o) => (
        <tr key={o.id} className="group hover:bg-secondary">
          <Cell className="font-semibold">{ticker(o.symbolName)}</Cell>
          <SideCell side={o.side} />
          <Cell>{o.type[0] + o.type.slice(1).toLowerCase()}</Cell>
          <Cell>{o.quantity}</Cell>
          <Cell>{o.price != null ? num(o.price, priceDigits(o.price)) : "—"}</Cell>
          <Cell>{o.stopPrice != null ? num(o.stopPrice, priceDigits(o.stopPrice)) : "—"}</Cell>
          <Cell>{o.avgFillPrice != null ? num(o.avgFillPrice, priceDigits(o.avgFillPrice)) : "—"}</Cell>
          <Cell>{o.takeProfit != null ? num(o.takeProfit, priceDigits(o.takeProfit)) : "—"}</Cell>
          <Cell>{o.stopLoss != null ? num(o.stopLoss, priceDigits(o.stopLoss)) : "—"}</Cell>
          <Cell>—</Cell>
          <Cell>Working</Cell>
          <Cell>{stamp(o.createdAt)}</Cell>
          <Cell>{o.id.slice(0, 8)}</Cell>
          <Cell>—</Cell>
          <Cell>GTC</Cell>
          <Cell>—</Cell>
          <Cell>—</Cell>
          <Cell className="w-[64px]">
            <span className="invisible flex gap-1 group-hover:visible">
              <IconBtn title="Modify order" onClick={() => onEdit(o)}><Pencil className="h-4 w-4" strokeWidth={1.25} /></IconBtn>
              <IconBtn title="Cancel order" onClick={() => onCancel(o.id)}><X className="h-4 w-4" strokeWidth={1.5} /></IconBtn>
            </span>
          </Cell>
        </tr>
      ))}
    </Table>
  );
}

function OrderHistoryTable({ orders }: { orders: Order[] }) {
  const head = ["Symbol", "Side", "Type", "Quantity", "Limit price", "Stop price", "Fill price", "Status", "Commission", "Placing time", "Closing time", "Order ID", "Level ID", "Leverage", "Margin"];
  return (
    <Table head={head} empty={orders.length === 0 ? <div className="py-8 text-center text-[14px] text-muted-foreground">No orders yet</div> : null}>
      {orders.map((o) => (
        <tr key={o.id} className="hover:bg-secondary">
          <Cell className="font-semibold">{ticker(o.symbolName)}</Cell>
          <SideCell side={o.side} />
          <Cell>{o.type[0] + o.type.slice(1).toLowerCase()}</Cell>
          <Cell>{o.quantity}</Cell>
          <Cell>{o.price != null ? num(o.price, priceDigits(o.price)) : "—"}</Cell>
          <Cell>{o.stopPrice != null ? num(o.stopPrice, priceDigits(o.stopPrice)) : "—"}</Cell>
          <Cell>{o.avgFillPrice != null ? num(o.avgFillPrice, priceDigits(o.avgFillPrice)) : "—"}</Cell>
          <Cell>{o.status[0] + o.status.slice(1).toLowerCase()}</Cell>
          <Cell>0.00</Cell>
          <Cell>{stamp(o.createdAt)}</Cell>
          <Cell>{stamp(o.updatedAt)}</Cell>
          <Cell>{o.id.slice(0, 8)}</Cell>
          <Cell>—</Cell>
          <Cell>—</Cell>
          <Cell>—</Cell>
        </tr>
      ))}
    </Table>
  );
}

function BalanceHistoryTable({ closed, start }: { closed: ClosedPosition[]; start: number }) {
  // Oldest first to accumulate the balance, newest first to show it.
  const rows = useMemo(() => {
    const sorted = [...closed].sort((a, b) => Date.parse(a.closedAt ?? "") - Date.parse(b.closedAt ?? ""));
    const out = sorted.reduce<{ id: string; time: string | null; before: number; after: number; pnl: number; action: string }[]>((acc, c) => {
      const before = acc.length ? acc[acc.length - 1]!.after : start;
      return [...acc, { id: c.id, time: c.closedAt, before, after: before + c.realizedPnl, pnl: c.realizedPnl, action: `Close position ${ticker(c.symbolName)}` }];
    }, []);
    return out.reverse();
  }, [closed, start]);
  return (
    <Table head={["Time", "Balance before", "Balance after", "Realized PnL", "Action"]} empty={rows.length === 0 ? <div className="py-8 text-center text-[14px] text-muted-foreground">No balance changes yet</div> : null}>
      {rows.map((r) => (
        <tr key={r.id} className="hover:bg-secondary">
          <Cell>{stamp(r.time)}</Cell>
          <Cell>{num(r.before)}</Cell>
          <Cell>{num(r.after)}</Cell>
          <Cell className={tone(r.pnl)}>{signed(r.pnl)}</Cell>
          <Cell>{r.action}</Cell>
        </tr>
      ))}
    </Table>
  );
}

function ActivityTable({ orders, closed }: { orders: Order[]; closed: ClosedPosition[] }) {
  const rows = useMemo(() => {
    const items = [
      ...orders.map((o) => ({
        t: o.createdAt,
        text: `${o.type === "MARKET" ? "Market" : o.type[0] + o.type.slice(1).toLowerCase()} order ${o.status.toLowerCase()}: ${o.side === "BUY" ? "Buy" : "Sell"} ${o.quantity} ${ticker(o.symbolName)}${o.avgFillPrice != null ? ` @ ${o.avgFillPrice}` : o.price != null ? ` @ ${o.price}` : ""}`,
      })),
      ...closed.map((c) => ({ t: c.closedAt ?? c.openedAt, text: `Position closed: ${ticker(c.symbolName)} ${c.quantity} @ ${c.exitPrice}, realized PnL ${signed(c.realizedPnl)}` })),
    ];
    return items.sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  }, [orders, closed]);
  return (
    <Table head={["Time", "Text"]} empty={rows.length === 0 ? <div className="py-8 text-center text-[14px] text-muted-foreground">No activity yet</div> : null}>
      {rows.map((r, i) => (
        <tr key={i} className="hover:bg-secondary">
          <Cell>{stamp(r.t)}</Cell>
          <Cell>{r.text}</Cell>
        </tr>
      ))}
    </Table>
  );
}

function TradeHistoryTable({ closed }: { closed: ClosedPosition[] }) {
  return (
    <Table head={["Symbol", "Side", "Quantity", "Entry price", "Exit price", "Realized PnL", "Commission", "Opening time", "Closing time"]} empty={closed.length === 0 ? <div className="py-8 text-center text-[14px] text-muted-foreground">No trades yet</div> : null}>
      {closed.map((c) => (
        <tr key={c.id} className="hover:bg-secondary">
          <Cell className="font-semibold">{ticker(c.symbolName)}</Cell>
          <SideCell side={c.side} />
          <Cell>{c.quantity}</Cell>
          <Cell>{num(c.entryPrice, priceDigits(c.entryPrice))}</Cell>
          <Cell>{num(c.exitPrice, priceDigits(c.exitPrice))}</Cell>
          <Cell className={tone(c.realizedPnl)}>{signed(c.realizedPnl)}</Cell>
          <Cell>{num(c.commission)}</Cell>
          <Cell>{stamp(c.openedAt)}</Cell>
          <Cell>{stamp(c.closedAt)}</Cell>
        </tr>
      ))}
    </Table>
  );
}
