import { ArrowLeftRight, ChevronDown, ChevronUp, Ellipsis, LayoutGrid, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { PlaceOrderInput } from "../../services/schemas.ts";
import { DOMPanel } from "../trading/DOMPanel.tsx";
import { notAvailable } from "./notAvailable.ts";
import { Switch } from "./ui.tsx";

type OrderType = "MARKET" | "LIMIT" | "STOP";

/**
 * TradingView's order panel (Paper Trading): Order | DOM, a Sell / Buy price
 * switch, Market · Limit · Stop, price and quantity, exits in ticks, extra
 * settings and the side-coloured submit button.
 */
export function OrderTicketPanel({
  symbol,
  tick,
  tickSize,
  accountId,
  onPlace,
  onClose,
}: {
  symbol: string;
  tick?: { bid: number; ask: number };
  tickSize: number;
  accountId: string | null;
  onPlace: (input: PlaceOrderInput) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"order" | "dom">("order");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<OrderType>("LIMIT");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [tpOn, setTpOn] = useState(false);
  const [slOn, setSlOn] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [exitsOpen, setExitsOpen] = useState(true);
  const [extraOpen, setExtraOpen] = useState(true);
  const [tif, setTif] = useState("Week");

  const ticker = symbol.slice(symbol.indexOf(":") + 1);
  const digits = Math.max(0, Math.round(-Math.log10(tickSize || 0.01)));
  const fmt = (v: number) => v.toFixed(digits);
  const bid = tick?.bid;
  const ask = tick?.ask;
  const market = side === "BUY" ? ask : bid;
  // A limit/stop price defaults to the touch on the chosen side, as on TradingView.
  const entry = type === "MARKET" ? market : price !== "" ? Number(price) : market;
  const quantity = Number(qty) || 0;
  const value = entry != null ? entry * quantity : null;
  const ticksFrom = (lvl: string) => (entry != null && lvl !== "" ? Math.round(Math.abs(Number(lvl) - entry) / (tickSize || 0.01)) : 0);
  // Exits start 0.25 % away from the entry, on whole ticks.
  const exitDefault = (dir: 1 | -1) => (entry != null ? fmt(entry * (1 + dir * 0.0025)) : "");

  const submit = () => {
    if (!accountId || !(quantity > 0)) return;
    onPlace({
      accountId,
      symbol,
      side,
      type,
      quantity,
      ...(type === "LIMIT" && entry != null ? { price: Number(fmt(entry)) } : {}),
      ...(type === "STOP" && entry != null ? { stopPrice: Number(fmt(entry)) } : {}),
      ...(tpOn && tp !== "" ? { takeProfit: Number(tp) } : {}),
      ...(slOn && sl !== "" ? { stopLoss: Number(sl) } : {}),
    });
  };

  const buy = side === "BUY";
  return (
    <div className="flex h-full w-[318px] flex-col bg-card text-[14px]">
      <div className="flex h-[50px] shrink-0 items-center gap-2 pl-4 pr-2">
        <span className="flex h-[22px] w-[24px] items-center justify-center rounded-[4px] bg-tv-active text-[10px] font-bold text-tv-active-foreground">TV</span>
        <span className="font-semibold">{ticker}</span>
        <span className="rounded-full bg-[#f23645]/10 px-1.5 text-[11px] text-[#f23645]">≈</span>
        <div className="flex-1" />
        <HeadBtn title="Layout" onClick={() => notAvailable("Order panel layouts")}><LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.25} /></HeadBtn>
        <HeadBtn title="More" onClick={() => notAvailable("Order panel settings")}><Ellipsis className="h-[18px] w-[18px]" strokeWidth={1.25} /></HeadBtn>
        <HeadBtn title="Close" onClick={onClose}><X className="h-[20px] w-[20px]" strokeWidth={1.25} /></HeadBtn>
      </div>

      <div className="px-4">
        <div className="flex h-[34px] rounded-[8px] bg-pill p-[3px]">
          {(["order", "dom"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn("flex-1 rounded-[6px]", view === v ? "bg-card shadow-[0_1px_2px_rgba(0,0,0,0.1)]" : "text-muted-foreground")}
            >
              {v === "order" ? "Order" : "DOM"}
            </button>
          ))}
        </div>
      </div>

      {view === "dom" ? (
        <div className="min-h-0 flex-1 pt-2">
          <DOMPanel symbol={symbol} tick={tick} />
        </div>
      ) : (
        <>
          <div className="tv-scroll min-h-0 flex-1 px-4 pb-3">
            <div className="relative mt-4 flex h-[52px] overflow-hidden rounded-[8px] bg-pill">
              <button type="button" onClick={() => setSide("SELL")} className={cn("flex flex-1 flex-col justify-center pl-2.5 text-left", !buy && "bg-[#f23645]/15 text-[#f23645]")}>
                <span className="text-[14px] font-semibold">Sell</span>
                <span className="text-[16px] tabular-nums">{bid != null ? fmt(bid) : "—"}</span>
              </button>
              <button type="button" onClick={() => setSide("BUY")} className={cn("flex flex-1 flex-col items-end justify-center pr-2.5", buy && "bg-[#2962ff]/20 text-[#2962ff]")}>
                <span className="text-[14px] font-semibold">Buy</span>
                <span className="text-[16px] tabular-nums">{ask != null ? fmt(ask) : "—"}</span>
              </button>
              {bid != null && ask != null && (
                <span className="absolute bottom-[6px] left-1/2 -translate-x-1/2 rounded-[4px] bg-card px-1.5 text-[11px] tabular-nums">{fmt(ask - bid)}</span>
              )}
            </div>

            <div className="mt-3 flex border-b border-border">
              {(["MARKET", "LIMIT", "STOP"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn("relative h-[34px] flex-1", type === t && "after:absolute after:inset-x-3 after:bottom-[-1px] after:h-[3px] after:rounded-full after:bg-tv-active")}
                >
                  {t[0] + t.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            {type !== "MARKET" && (
              <Field label="Price">
                <InputRow value={price !== "" ? price : market != null ? fmt(market) : ""} onChange={setPrice} hint={buy ? "Ask" : "Bid"} />
              </Field>
            )}
            <Field label={<span className="flex items-center gap-1">Shares <ChevronDown className="h-3.5 w-3.5" /></span>}>
              <InputRow value={qty} onChange={setQty} hint={value != null ? `${value.toFixed(2)} USD` : "— USD"} />
            </Field>
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Tick value</span>
              <span>
                {tickSize} <span className="text-[10px] text-muted-foreground">USD</span>
              </span>
            </div>

            <Section title="Exits" open={exitsOpen} onToggle={() => setExitsOpen((v) => !v)}>
              <ExitRow
                label="Take profit price"
                on={tpOn}
                onToggle={(v) => {
                  setTpOn(v);
                  if (v && tp === "") setTp(exitDefault(buy ? 1 : -1));
                }}
                value={tp !== "" ? tp : exitDefault(buy ? 1 : -1)}
                onChange={setTp}
                ticks={ticksFrom(tp !== "" ? tp : exitDefault(buy ? 1 : -1))}
              />
              <ExitRow
                label="Stop loss price"
                on={slOn}
                onToggle={(v) => {
                  setSlOn(v);
                  if (v && sl === "") setSl(exitDefault(buy ? -1 : 1));
                }}
                value={sl !== "" ? sl : exitDefault(buy ? -1 : 1)}
                onChange={setSl}
                ticks={ticksFrom(sl !== "" ? sl : exitDefault(buy ? -1 : 1))}
              />
            </Section>

            <Section title="Extra settings" open={extraOpen} onToggle={() => setExtraOpen((v) => !v)}>
              <div className="mt-2 text-[13px] text-muted-foreground">Time in force</div>
              <select value={tif} onChange={(e) => setTif(e.target.value)} className="mt-1 h-[34px] w-full rounded-[6px] text-[14px]">
                <option>Day</option>
                <option>Week</option>
                <option>Good till canceled</option>
              </select>
              <label className="mt-3 flex items-center gap-2 text-[14px]">
                <input type="checkbox" onChange={() => notAvailable("Filling outside regular trading hours")} checked={false} className="h-4 w-4" />
                Fill order outside RTH
              </label>
              <label className="mt-2 flex items-center gap-2 text-[14px] text-muted-foreground">
                <input type="checkbox" disabled className="h-4 w-4" />
                Fill take profit outside RTH
              </label>
            </Section>
          </div>
          <div className="shrink-0 px-4 pb-4 pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={!accountId || !(quantity > 0) || entry == null}
              className={cn(
                "flex h-[56px] w-full flex-col items-center justify-center rounded-[8px] text-white disabled:opacity-50",
                buy ? "bg-[#2962ff] hover:bg-[#1e53e5]" : "bg-[#f23645] hover:bg-[#d9303e]",
              )}
            >
              <span className="text-[16px] font-semibold">{buy ? "Buy" : "Sell"}</span>
              <span className="text-[12px]">
                {quantity} {ticker} @ {type === "MARKET" ? "MKT" : `${entry != null ? fmt(entry) : "—"} ${type}`}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function HeadBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-[32px] w-[32px] items-center justify-center rounded hover:bg-secondary">
      {children}
    </button>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[13px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function InputRow({ value, onChange, hint, disabled }: { value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean }) {
  return (
    <div className={cn("flex h-[34px] items-center rounded-[6px] border border-border px-2 focus-within:border-[#2962ff]", disabled && "opacity-50")}>
      <input
        value={value}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 text-[14px] tabular-nums outline-none ring-0 focus:border-0 focus:ring-0"
      />
      <ArrowLeftRight className="mx-2 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.25} />
      {hint && <span className="w-[92px] shrink-0 text-right text-[12px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between font-semibold">
        {title}
        {open ? <ChevronUp className="h-4 w-4" strokeWidth={1.5} /> : <ChevronDown className="h-4 w-4" strokeWidth={1.5} />}
      </button>
      {open && children}
    </div>
  );
}

function ExitRow({
  label,
  on,
  onToggle,
  value,
  onChange,
  ticks,
}: {
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  ticks: number;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
          {label} <ChevronDown className="h-3.5 w-3.5" />
        </span>
        <Switch checked={on} onChange={onToggle} />
      </div>
      <InputRow value={value} onChange={onChange} hint={`${ticks} ticks`} disabled={!on} />
    </div>
  );
}
