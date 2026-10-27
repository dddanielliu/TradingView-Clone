import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import { type SymbolSearchResult, useSymbolSearch } from "../../market/index.ts";
import { notAvailable } from "./notAvailable.ts";
import { useDismiss } from "./shared.ts";
import { SymbolBadge } from "./ui.tsx";

/** TradingView's search categories → the provider-neutral `type` filter. */
const CATEGORIES: { label: string; type?: string }[] = [
  { label: "All" },
  { label: "Stocks", type: "stock" },
  { label: "Funds", type: "fund" },
  { label: "Futures", type: "futures" },
  { label: "Forex", type: "forex" },
  { label: "Crypto", type: "crypto" },
  { label: "Indices", type: "index" },
  { label: "Bonds", type: "bond" },
  { label: "Economy", type: "economic" },
  { label: "Options", type: "option" },
];

interface Group {
  key: string;
  first: SymbolSearchResult;
  others: SymbolSearchResult[];
}

/**
 * One row per instrument with its other listings folded behind "+N". The
 * order is the providers' own: TradingView's search already ranks by its
 * relevance (MSFT first for "MSF"), so nothing is re-sorted here.
 */
function groupResults(results: SymbolSearchResult[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of results) {
    const key = `${r.symbol.toUpperCase()}|${r.description.toUpperCase()}`;
    const g = groups.get(key);
    if (g) g.others.push(r);
    else groups.set(key, { key, first: r, others: [] });
  }
  return [...groups.values()];
}

/**
 * Symbol search, TradingView's "start typing" dialog: results from every
 * enabled data provider, one row per instrument with its other listings
 * behind "+N". Enter opens the highlighted row; a typed `EXCHANGE:TICKER`
 * opens directly.
 */
export function SymbolSearchDialog({
  open,
  initialQuery = "",
  title,
  onClose,
  onPick,
}: {
  open: boolean;
  initialQuery?: string;
  title?: string;
  onClose: () => void;
  onPick: (symbol: string) => void;
}) {
  return open ? <SearchBody initialQuery={initialQuery} title={title} onClose={onClose} onPick={onPick} /> : null;
}

function SearchBody({
  initialQuery,
  title,
  onClose,
  onPick,
}: {
  initialQuery: string;
  title?: string;
  onClose: () => void;
  onPick: (symbol: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { results, loading, errors } = useSymbolSearch(query, CATEGORIES[category]?.type);
  const groups = useMemo(() => groupResults(results).slice(0, 60), [results]);
  const listRef = useRef<HTMLDivElement>(null);
  const ref = useDismiss<HTMLDivElement>(true, onClose);
  const typedId = /^[A-Z0-9_.]+:[A-Z0-9_.!&-]+$/i.test(query.trim()) ? query.trim().toUpperCase() : null;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (id: string) => {
    onPick(id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[68px]">
      <div
        ref={ref}
        role="dialog"
        aria-label={title ?? "Symbol Search"}
        className="flex h-[min(680px,calc(100vh-90px))] w-full max-w-[840px] flex-col overflow-hidden rounded-[20px] bg-popover text-foreground shadow-[0_2px_24px_rgba(0,0,0,0.18)]"
      >
        <div className="flex h-[70px] shrink-0 items-center gap-2 px-5">
          <Search className="h-[22px] w-[22px] shrink-0" strokeWidth={1.5} />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, Math.max(groups.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                const g = groups[cursor];
                if (g) pick(g.first.id);
                else if (typedId) pick(typedId);
              }
            }}
            placeholder="Symbol, ISIN, or CUSIP"
            spellCheck={false}
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 text-[18px] uppercase outline-none ring-0 placeholder:normal-case placeholder:text-muted-foreground focus:border-0 focus:ring-0"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => setQuery("")}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted-foreground/70 text-popover hover:bg-muted-foreground"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
          <button
            type="button"
            title="Sources"
            onClick={() => notAvailable("Filtering by data source")}
            className="ml-2 flex h-8 w-8 items-center justify-center rounded hover:bg-secondary"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.25} />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 px-5 pb-3">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                setCategory(i);
                setCursor(0);
              }}
              className={cn(
                "h-8 rounded-full px-3 text-[14px] transition-colors",
                i === category ? "bg-tv-active text-tv-active-foreground" : "bg-pill hover:bg-secondary",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">
          {typedId && !groups.some((g) => g.first.id === typedId) && (
            <Row id={typedId} ticker={typedId.split(":")[1] ?? typedId} description="Open this symbol" type="" exchange={typedId.split(":")[0] ?? ""} query={query} active={false} index={-1} onPick={pick} />
          )}
          {groups.map((g, i) => (
            <div key={g.key}>
              <Row
                id={g.first.id}
                ticker={g.first.symbol}
                description={g.first.description}
                type={g.first.type}
                exchange={g.first.exchange}
                query={query}
                active={i === cursor}
                index={i}
                more={g.others.length}
                expanded={expanded === g.key}
                onToggleMore={() => setExpanded((e) => (e === g.key ? null : g.key))}
                onHover={() => setCursor(i)}
                onPick={pick}
              />
              {expanded === g.key &&
                g.others.map((o) => (
                  <Row key={o.id} id={o.id} ticker={o.symbol} description={o.description} type={o.type} exchange={o.exchange} query={query} active={false} index={-2} nested onPick={pick} />
                ))}
            </div>
          ))}
          {groups.length === 0 && !typedId && (
            <div className="py-16 text-center text-[14px] text-muted-foreground">
              {loading ? "Searching…" : query.trim() ? "No symbols match your criteria" : "Start typing to search"}
              {!loading && errors.length > 0 && <div className="mt-2 text-[12px]">Some providers did not answer: {errors.join(" · ")}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  id,
  ticker,
  description,
  type,
  exchange,
  query,
  active,
  index,
  more = 0,
  expanded,
  nested,
  onToggleMore,
  onHover,
  onPick,
}: {
  id: string;
  ticker: string;
  description: string;
  type: string;
  exchange: string;
  query: string;
  active: boolean;
  index: number;
  more?: number;
  expanded?: boolean;
  nested?: boolean;
  onToggleMore?: () => void;
  onHover?: () => void;
  onPick: (id: string) => void;
}) {
  // The typed prefix of the ticker is shown in blue, as TradingView does.
  const q = query.trim().toUpperCase();
  const hit = q && ticker.toUpperCase().startsWith(q) ? q.length : 0;
  return (
    <div
      role="button"
      tabIndex={-1}
      data-row={index}
      onMouseEnter={onHover}
      onClick={() => onPick(id)}
      className={cn(
        "flex h-[56px] cursor-default items-center gap-3 rounded-lg px-2",
        nested && "pl-12",
        active ? "bg-secondary" : "hover:bg-secondary",
      )}
    >
      <SymbolBadge symbol={id} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] leading-[20px]">
          <span className="text-primary">{ticker.slice(0, hit)}</span>
          {ticker.slice(hit)}
        </div>
        <div className="flex items-center gap-1.5 truncate text-[13px] leading-[18px] text-muted-foreground">
          <span className="truncate">{description}</span>
          {type && (
            <span className="shrink-0 rounded-[3px] bg-pill px-1 text-[9px] font-semibold uppercase leading-[14px] tracking-[0.3px] text-foreground/70">
              {type}
            </span>
          )}
        </div>
      </div>
      {more > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMore?.();
          }}
          className="flex h-7 items-center gap-0.5 rounded-full bg-pill px-2 text-[13px] hover:bg-secondary"
        >
          +{more}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
      <span className="w-[64px] shrink-0 truncate text-right text-[13px]" title={exchange}>
        {exchange}
      </span>
    </div>
  );
}
