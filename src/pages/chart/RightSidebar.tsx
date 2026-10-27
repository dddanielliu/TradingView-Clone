import { AlarmClock, Bell, Calendar, ChevronDown, CircleHelp, Columns3, Ellipsis, Layers, LayoutGrid, List, MessageSquare, Mountain, Plus, Rss, Sparkles, Target, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { priceDigits, type useWatchlist } from "./shared.ts";
import { cn } from "../../lib/utils.ts";
import { type QuoteStats, useMarketInterest, useQuoteStats } from "../../market/index.ts";
import type { Symbol } from "../../services/schemas.ts";
import { notAvailable } from "./notAvailable.ts";
import { SymbolBadge } from "./ui.tsx";

export type SidePage = "watchlist" | "objtree";

const fmt = (v: number, d: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** TradingView's right rail: its pages first, then its other tools. */
const RAIL: { id: SidePage | null; title: string; icon: typeof List }[] = [
  { id: "watchlist", title: "Watchlist, details, and news", icon: List },
  { id: null, title: "Alerts", icon: AlarmClock },
  { id: "objtree", title: "Object tree and data window", icon: Layers },
];

const RAIL_LOWER: { title: string; icon: typeof List }[] = [
  { title: "AI Copilot", icon: Sparkles },
  { title: "Screeners", icon: Target },
  { title: "Pine Editor", icon: Mountain },
  { title: "Calendars", icon: Calendar },
  { title: "Community", icon: Rss },
  { title: "Notifications", icon: Bell },
  { title: "Chats", icon: MessageSquare },
  { title: "Products", icon: LayoutGrid },
];

/** TradingView's right rail: 44px cells; clicking the open page's icon closes it. */
export function RightRail({
  page,
  onPage,
}: {
  page: SidePage | null;
  onPage: (p: SidePage | null) => void;
}) {
  const cell = (active: boolean) =>
    cn(
      "my-[1px] flex h-[44px] w-[44px] items-center justify-center rounded transition-colors",
      active ? "bg-secondary text-foreground" : "text-foreground hover:bg-secondary",
    );
  return (
    // TradingView's rail: 44px cells, 1px apart from the edges and each other.
    <div className="flex h-full w-[44px] flex-col items-center py-[1px]">
      {RAIL.map((r) => (
        <button
          key={r.title}
          type="button"
          title={r.title}
          aria-label={r.title}
          aria-pressed={r.id !== null && page === r.id}
          onClick={() => (r.id ? onPage(page === r.id ? null : r.id) : notAvailable(r.title))}
          className={cell(r.id !== null && page === r.id)}
        >
          <r.icon className="h-[24px] w-[24px]" strokeWidth={1.25} />
        </button>
      ))}
      <div className="flex-1" />
      {RAIL_LOWER.map((r, i) => (
        <button
          key={r.title}
          type="button"
          title={r.title}
          aria-label={r.title}
          onClick={() => notAvailable(r.title)}
          // AI Copilot and Screeners touch on TradingView.
          className={cn(cell(false), i === 0 && "!mb-0", i === 1 && "!mt-0")}
        >
          <r.icon className="h-[24px] w-[24px]" strokeWidth={1.25} />
        </button>
      ))}
      <div className="h-[11px]" />
      <button type="button" title="Help Center" aria-label="Help Center" onClick={() => notAvailable("Help Center")} className={cell(false)}>
        <CircleHelp className="h-[24px] w-[24px]" strokeWidth={1.25} />
      </button>
    </div>
  );
}

/** Watchlist on top, the selected symbol's details below, as on TradingView. */
export function WatchlistPage({
  selected,
  symbolInfo,
  onSelect,
  onAdd,
  watchlist,
}: {
  selected: string;
  symbolInfo?: Symbol;
  onSelect: (s: string) => void;
  onAdd: () => void;
  watchlist: ReturnType<typeof useWatchlist>;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const all = useMemo(() => [...new Set([...watchlist.symbols, selected])], [watchlist.symbols, selected]);
  useMarketInterest(all);
  const stats = useQuoteStats(all);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[50px] shrink-0 items-center justify-between pl-4 pr-1.5">
        <button type="button" className="flex items-center gap-1 rounded px-1 py-0.5 text-[14px] font-semibold hover:bg-secondary">
          Watchlist <ChevronDown className="h-4 w-4" />
        </button>
        <div className="flex items-center">
          <button
            type="button"
            title="Add symbol"
            onClick={onAdd}
            className="flex h-[34px] w-[34px] items-center justify-center rounded hover:bg-secondary"
          >
            <Plus className="h-[22px] w-[22px]" strokeWidth={1.25} />
          </button>
          <button
            type="button"
            title="Advanced view"
            onClick={() => notAvailable("Advanced watchlist view")}
            className="flex h-[34px] w-[34px] items-center justify-center rounded hover:bg-secondary"
          >
            <Columns3 className="h-[22px] w-[22px]" strokeWidth={1.25} />
          </button>
          <button
            type="button"
            title="More"
            onClick={() => notAvailable("Watchlist options")}
            className="flex h-[34px] w-[34px] items-center justify-center rounded hover:bg-secondary"
          >
            <Ellipsis className="h-[22px] w-[22px]" strokeWidth={1.25} />
          </button>
        </div>
      </div>

      <div className="flex h-[30px] shrink-0 items-center border-y border-border pl-4 text-[14px] text-muted-foreground">
        <span className="flex-1">Symbol</span>
        <span className="h-full w-[76px] border-l border-border pr-2 text-right leading-[28px]">Last</span>
        <span className="h-full w-[66px] border-l border-border pr-2 text-right leading-[28px]">Chg</span>
        <span className="h-full w-[66px] border-l border-border pr-2 text-right leading-[28px]">Chg%</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {watchlist.sections.map((sec) => (
          <div key={sec.section}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [sec.section]: !c[sec.section] }))}
              className="flex h-[38px] w-full items-center gap-1.5 pl-4 text-[11px] uppercase tracking-[0.4px] text-muted-foreground hover:bg-secondary"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", collapsed[sec.section] && "-rotate-90")} />
              {sec.section}
            </button>
            {!collapsed[sec.section] &&
              sec.symbols.map((s) => (
                <WatchRow
                  key={s}
                  symbol={s}
                  stat={stats[s]}
                  active={s === selected}
                  onSelect={() => onSelect(s)}
                  onRemove={() => watchlist.remove(s)}
                />
              ))}
          </div>
        ))}
      </div>

      <div className="h-[4px] shrink-0 bg-background" />
      <SymbolDetails symbol={selected} stat={stats[selected]} symbolInfo={symbolInfo} />
    </div>
  );
}

/** The price with its changed trailing digits coloured, as TradingView's watchlist does on a tick. */
function TickPrice({ value, digits }: { value: number; digits: number }) {
  const text = fmt(value, digits);
  const [prev, setPrev] = useState({ value, text, dir: 0, split: text.length });
  if (prev.value !== value) {
    // Compare with the previous rendering: colour from the first digit that changed.
    let i = 0;
    while (i < text.length && text[i] === prev.text[i]) i++;
    setPrev({ value, text, dir: value > prev.value ? 1 : -1, split: i });
  }
  const tone = prev.dir > 0 ? "text-success" : prev.dir < 0 ? "text-destructive" : "";
  return (
    <>
      {text.slice(0, prev.split)}
      <span className={tone}>{text.slice(prev.split)}</span>
    </>
  );
}

function WatchRow({
  symbol,
  stat,
  active,
  onSelect,
  onRemove,
}: {
  symbol: string;
  stat?: QuoteStats;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const ticker = symbol.slice(symbol.indexOf(":") + 1);
  const tone = !stat || stat.change === 0 ? "" : stat.change > 0 ? "text-success" : "text-destructive";
  const d = stat ? priceDigits(stat.last) : 2;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      title={symbol}
      className={cn(
        "group relative mx-1 flex h-[30px] cursor-default items-center rounded-[4px] pl-3 text-[14px] tabular-nums",
        active ? "ring-[1.5px] ring-inset ring-foreground" : "hover:bg-secondary",
      )}
    >
      {/* TradingView's flag stub at the row's left edge. */}
      <span aria-hidden="true" className="absolute left-0 top-1/2 h-[14px] w-[7px] -translate-y-1/2 bg-border [clip-path:polygon(0_0,100%_0,60%_50%,100%_100%,0_100%)]" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <SymbolBadge symbol={symbol} />
        <span className="truncate">{ticker}</span>
        {stat?.delayed && <span className="-mt-2 text-[10px] font-bold text-warning">D</span>}
      </span>
      <span className="w-[76px] pr-2 text-right">{stat ? <TickPrice value={stat.last} digits={d} /> : "—"}</span>
      <span className={cn("w-[66px] pr-2 text-right", tone)}>{stat ? `${stat.change < 0 ? "−" : ""}${fmt(Math.abs(stat.change), d)}` : ""}</span>
      <span className={cn("w-[62px] pr-1 text-right", tone)}>{stat ? `${stat.changePct < 0 ? "−" : ""}${Math.abs(stat.changePct).toFixed(2)}%` : ""}</span>
      <button
        type="button"
        title="Remove from watchlist"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={cn(
          "absolute right-1 h-6 w-6 items-center justify-center rounded bg-card text-foreground hover:bg-secondary",
          active ? "flex" : "hidden group-hover:flex",
        )}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.25} />
      </button>
    </div>
  );
}

function compact(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} K`;
  return v.toFixed(0);
}

function SymbolDetails({ symbol, stat, symbolInfo }: { symbol: string; stat?: QuoteStats; symbolInfo?: Symbol }) {
  const colon = symbol.indexOf(":");
  const exchange = colon > 0 ? symbol.slice(0, colon) : "";
  const ticker = symbol.slice(colon + 1);
  const d = stat ? priceDigits(stat.last) : 2;
  const tone = !stat || stat.change >= 0 ? "text-success" : "text-destructive";
  return (
    <div className="max-h-[48%] shrink-0 overflow-y-auto px-4 pb-4 pt-3">
      <div className="flex items-center gap-2">
        <SymbolBadge symbol={symbol} size={26} />
        <span className="text-[16px] font-semibold">{ticker}</span>
      </div>
      <div className="mt-2 text-[14px]">
        {symbolInfo?.displayName ?? ticker}
        {exchange && <span className="text-muted-foreground"> · {exchange}</span>}
      </div>
      {symbolInfo?.category && (
        <div className="mt-0.5 text-[13px] capitalize text-muted-foreground">{symbolInfo.category.toLowerCase()}</div>
      )}
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[28px] font-semibold tabular-nums leading-none">{stat ? fmt(stat.last, d) : "—"}</span>
        {stat && (
          <span className={cn("text-[16px] tabular-nums", tone)}>
            {stat.change < 0 ? "−" : "+"}
            {fmt(Math.abs(stat.change), d)} {stat.changePct < 0 ? "−" : "+"}
            {Math.abs(stat.changePct).toFixed(2)}%
          </span>
        )}
      </div>
      {stat && (
        <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", stat.delayed ? "bg-warning" : "bg-success")} />
          {stat.delayed ? "Delayed data" : "Real-time"} · via {stat.provider}
        </div>
      )}
      {stat && (
        <div className="mt-4 grid grid-cols-2 gap-y-2 text-[13px]">
          <DetailCell label="Volume" value={stat.volume != null ? compact(stat.volume) : "—"} />
          <DetailCell label="Prev. close" value={stat.prevClose != null ? fmt(stat.prevClose, d) : "—"} right />
          <DetailCell label="Day's range" value={stat.low != null && stat.high != null ? `${fmt(stat.low, d)} – ${fmt(stat.high, d)}` : "—"} />
          <DetailCell label="Open" value={stat.open != null ? fmt(stat.open, d) : "—"} right />
        </div>
      )}
    </div>
  );
}

function DetailCell({ label, value, right }: { label: string; value: ReactNode; right?: boolean }) {
  return (
    <div className={cn("flex flex-col", right && "items-end text-right")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}


