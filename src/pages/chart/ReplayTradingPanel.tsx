import { ColorType, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { ChevronDown, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { ClosedTrade, EquityPoint } from "../../replay/paper.ts";
import type { ReplayController } from "../../replay/useReplay.ts";
import { toast } from "../../services/toast.ts";
import { MenuDivider, MenuItem, MenuTitle, Popover } from "./ui.tsx";

type Tab = "positions" | "history" | "performance";

const money = (v: number) =>
  `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (v: number) => (v > 0 ? "text-success" : v < 0 ? "text-destructive" : "");
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ");
const REASON: Record<ClosedTrade["reason"], string> = {
  sl: "Stop loss",
  tp: "Take profit",
  manual: "Closed",
  session: "Replay ended",
  rewind: "Rewound",
};

/**
 * "Replay Trading": the paper account that trades along with a bar replay.
 * Orders fill at the close of the bar under the cursor; stops and targets are
 * checked against every later bar's range (see src/replay/paper.ts).
 */
export function ReplayTradingPanel({
  replay,
  digits,
  onCollapse,
}: {
  replay: ReplayController;
  digits: number;
  onCollapse?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const snap = replay.snapshot;
  const m = snap?.metrics;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[40px] shrink-0 items-center gap-1 border-b border-border px-3 text-[14px]">
        <ProfileMenu replay={replay} />
        <span className="mx-2 h-[22px] w-px bg-border" />
        <TabButton active={tab === "positions"} onClick={() => setTab("positions")}>
          Positions{snap && snap.positions.length > 0 ? ` ${snap.positions.length}` : ""}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          History{snap && snap.trades.length > 0 ? ` ${snap.trades.length}` : ""}
        </TabButton>
        <TabButton active={tab === "performance"} onClick={() => setTab("performance")}>
          Performance
        </TabButton>
        <div className="ml-auto hidden items-center gap-5 tabular-nums lg:flex">
          {m && (
            <>
              <Figure label="Account balance" value={money(m.balance)} />
              <Figure label="Equity" value={money(m.equity)} />
              <Figure label="Realized P&L" value={money(m.realized)} className={tone(m.realized)} />
              <Figure label="Unrealized P&L" value={money(m.unrealized)} className={tone(m.unrealized)} />
            </>
          )}
        </div>
        {onCollapse && (
          <button type="button" title="Collapse panel" onClick={onCollapse} className="ml-2 flex h-[30px] w-[30px] items-center justify-center rounded hover:bg-secondary">
            <ChevronDown className="h-5 w-5" strokeWidth={1.25} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <OrderTicket replay={replay} digits={digits} />
        <div className="min-w-0 flex-1 overflow-auto">
          {!snap ? (
            <Empty>Click a bar on the chart to start the replay; then trade it here or with the SELL / BUY buttons on the chart.</Empty>
          ) : tab === "positions" ? (
            <PositionsTable replay={replay} digits={digits} />
          ) : tab === "history" ? (
            <HistoryTable trades={snap.trades} digits={digits} />
          ) : (
            <Performance replay={replay} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("h-[30px] rounded px-2.5", active ? "bg-secondary font-semibold" : "hover:bg-secondary")}
    >
      {children}
    </button>
  );
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-[14px] text-muted-foreground">{children}</div>;
}

function OrderTicket({ replay, digits }: { replay: ReplayController; digits: number }) {
  const [qty, setQty] = useState("1");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const running = replay.mode === "running";
  const price = replay.snapshot?.price;

  const send = (side: "BUY" | "SELL") => {
    const r = replay.order(side, Number(qty), sl ? Number(sl) : null, tp ? Number(tp) : null);
    if (r.ok) {
      toast.success(`${side === "BUY" ? "Bought" : "Sold"} ${qty}`, `Filled at ${r.price.toFixed(digits)}`);
      setSl("");
      setTp("");
    } else toast.error("Order rejected", r.error);
  };

  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-2 border-r border-border p-3 text-[13px]">
      <Field label="Quantity">
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="h-8 w-full text-[14px]" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Stop loss">
          <input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" placeholder="Price" className="h-8 w-full text-[14px]" />
        </Field>
        <Field label="Take profit">
          <input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" placeholder="Price" className="h-8 w-full text-[14px]" />
        </Field>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!running}
          onClick={() => send("SELL")}
          className="h-9 rounded bg-[#f23645] text-white hover:brightness-110 disabled:opacity-40"
        >
          Sell
        </button>
        <button
          type="button"
          disabled={!running}
          onClick={() => send("BUY")}
          className="h-9 rounded bg-[#2962ff] text-white hover:brightness-110 disabled:opacity-40"
        >
          Buy
        </button>
      </div>
      <div className="text-muted-foreground">
        Market at {price != null ? price.toFixed(digits) : "—"} · fills at the bar close
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function PositionsTable({ replay, digits }: { replay: ReplayController; digits: number }) {
  const positions = replay.snapshot?.positions ?? [];
  if (positions.length === 0) return <Empty>No open positions</Empty>;

  const edit = (ticket: number, which: "sl" | "tp", current: number) => {
    const raw = window.prompt(`${which === "sl" ? "Stop loss" : "Take profit"} price (empty to remove)`, current ? String(current) : "");
    if (raw == null) return;
    const v = raw.trim() === "" ? null : Number(raw);
    const r = which === "sl" ? replay.modifyPosition(ticket, v, undefined) : replay.modifyPosition(ticket, undefined, v);
    if (!r.ok) toast.error("Modify failed", r.error);
  };

  return (
    <table className="text-[13px]">
      <thead>
        <tr>
          <Th>Side</Th>
          <Th>Qty</Th>
          <Th>Entry</Th>
          <Th>Stop loss</Th>
          <Th>Take profit</Th>
          <Th>Opened</Th>
          <Th right>Unrealized P&L</Th>
          <th className="w-10 border-b border-border">
            <button type="button" onClick={replay.closeAll} className="text-[12px] font-normal normal-case text-primary hover:underline">
              Flatten
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.ticket} className="hover:bg-secondary">
            <td className={p.side === "BUY" ? "text-[#2962ff]" : "text-[#f23645]"}>{p.side === "BUY" ? "Long" : "Short"}</td>
            <td className="tabular-nums">{p.volume}</td>
            <td className="tabular-nums">{p.priceOpen.toFixed(digits)}</td>
            <td>
              <button type="button" className="tabular-nums hover:underline" onClick={() => edit(p.ticket, "sl", p.sl)}>
                {p.sl ? p.sl.toFixed(digits) : "Add"}
              </button>
            </td>
            <td>
              <button type="button" className="tabular-nums hover:underline" onClick={() => edit(p.ticket, "tp", p.tp)}>
                {p.tp ? p.tp.toFixed(digits) : "Add"}
              </button>
            </td>
            <td className="tabular-nums text-muted-foreground">{when(p.time)}</td>
            <td className={cn("text-right tabular-nums", tone(p.pnl))}>{money(p.pnl)}</td>
            <td>
              <button
                type="button"
                title="Close position"
                onClick={() => {
                  const r = replay.closePosition(p.ticket);
                  if (!r.ok) toast.error("Close failed", r.error);
                }}
                className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryTable({ trades, digits }: { trades: ClosedTrade[]; digits: number }) {
  if (trades.length === 0) return <Empty>No closed trades yet</Empty>;
  return (
    <table className="text-[13px]">
      <thead>
        <tr>
          <Th>Symbol</Th>
          <Th>Side</Th>
          <Th>Qty</Th>
          <Th>Entry</Th>
          <Th>Exit</Th>
          <Th>Closed by</Th>
          <Th>Exit time</Th>
          <Th right>P&L</Th>
        </tr>
      </thead>
      <tbody>
        {[...trades].reverse().map((t) => (
          <tr key={`${t.ticket}-${t.exitTime}-${t.symbol}`} className="hover:bg-secondary">
            <td>{t.symbol.slice(t.symbol.indexOf(":") + 1)}</td>
            <td className={t.side === "BUY" ? "text-[#2962ff]" : "text-[#f23645]"}>{t.side === "BUY" ? "Long" : "Short"}</td>
            <td className="tabular-nums">{t.volume}</td>
            <td className="tabular-nums">{t.entryPrice.toFixed(digits)}</td>
            <td className="tabular-nums">{t.exitPrice.toFixed(digits)}</td>
            <td>{REASON[t.reason]}</td>
            <td className="tabular-nums text-muted-foreground">{when(t.exitTime)}</td>
            <td className={cn("text-right tabular-nums", tone(t.pnl))}>{money(t.pnl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={cn("whitespace-nowrap font-normal normal-case tracking-normal", right && "text-right")}>{children}</th>;
}

function Performance({ replay }: { replay: ReplayController }) {
  const m = replay.snapshot?.metrics;
  if (!m) return null;
  const rows: [string, string, string?][] = [
    ["Net profit", money(m.realized), tone(m.realized)],
    ["Total return", `${m.totalReturnPct.toFixed(2)}%`, tone(m.totalReturnPct)],
    ["Gross profit", money(m.grossProfit)],
    ["Gross loss", money(-m.grossLoss)],
    ["Max drawdown", `${money(m.maxDrawdown)} (${m.maxDrawdownPct.toFixed(2)}%)`],
    ["Profit factor", m.profitFactor ? m.profitFactor.toFixed(2) : "—"],
    ["Total closed trades", String(m.trades)],
    ["Percent profitable", `${m.winRate.toFixed(1)}% (${m.wins}/${m.trades})`],
    ["Avg trade", money(m.avgTrade), tone(m.avgTrade)],
    ["Avg winning trade", money(m.avgWin)],
    ["Avg losing trade", money(m.avgLoss)],
    ["Largest winning trade", money(m.largestWin)],
    ["Largest losing trade", money(m.largestLoss)],
    ["Sharpe (per bar)", m.sharpe.toFixed(2)],
  ];
  return (
    <div className="flex h-full min-h-[160px] gap-4 p-3">
      <div className="grid h-fit min-w-[300px] grid-cols-[auto_auto] gap-x-6 gap-y-1 text-[13px]">
        {rows.map(([k, v, c]) => (
          <div key={k} className="contents">
            <span className="text-muted-foreground">{k}</span>
            <span className={cn("text-right tabular-nums", c)}>{v}</span>
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[13px] text-muted-foreground">Equity, this session</div>
        <EquityChart points={replay.snapshot?.equity ?? []} />
      </div>
    </div>
  );
}

function EquityChart({ points }: { points: EquityPoint[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Baseline"> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const styles = getComputedStyle(host.current);
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: styles.color, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(128,128,128,0.12)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale: false,
    });
    series.current = c.addBaselineSeries({ lineWidth: 2, priceLineVisible: false });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const s = series.current;
    if (!s || points.length === 0) return;
    s.applyOptions({ baseValue: { type: "price", price: points[0]!.value } });
    s.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
    chart.current?.timeScale().fitContent();
  }, [points]);

  return <div ref={host} className="h-[calc(100%-20px)] min-h-[120px] w-full text-muted-foreground" />;
}

function ProfileMenu({ replay }: { replay: ReplayController }) {
  const [open, setOpen] = useState(false);
  const { list, activeId, activeName } = replay.profiles;

  const ask = (q: string, initial = "") => window.prompt(q, initial)?.trim() ?? null;
  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      toast.error("Profile", (e as Error).message);
    }
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      side="top"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Paper-trading profile"
          className={cn("flex h-[30px] items-center gap-1 rounded px-2 font-semibold", open ? "bg-secondary" : "hover:bg-secondary")}
        >
          Replay Trading · {activeName}
          <ChevronDown className="h-4 w-4" />
        </button>
      }
    >
      <MenuTitle>Paper-trading profiles</MenuTitle>
      {list.map((p) => (
        <MenuItem
          key={p.id}
          selected={p.id === activeId}
          hint={`${money(p.balance)} · ${p.trades} trades`}
          onClick={() => {
            guard(() => replay.selectProfile(p.id));
            setOpen(false);
          }}
        >
          {p.name}
        </MenuItem>
      ))}
      <MenuDivider />
      <MenuItem
        onClick={() => {
          const name = ask("Name of the new profile", "Paper account");
          if (!name) return;
          const balance = Number(ask("Starting balance", "10000"));
          guard(() => replay.createProfile(name, balance));
          setOpen(false);
        }}
      >
        New profile…
      </MenuItem>
      <MenuItem
        onClick={() => {
          const raw = ask(`Start "${activeName}" over with this balance`, String(list.find((p) => p.id === activeId)?.initialBalance ?? 10000));
          if (raw == null) return;
          guard(() => replay.resetProfile(activeId, Number(raw)));
          setOpen(false);
        }}
      >
        Reset this profile…
      </MenuItem>
      <MenuItem
        onClick={() => {
          if (!window.confirm(`Delete "${activeName}" and its history?`)) return;
          guard(() => replay.deleteProfile(activeId));
          setOpen(false);
        }}
      >
        Delete this profile
      </MenuItem>
    </Popover>
  );
}
