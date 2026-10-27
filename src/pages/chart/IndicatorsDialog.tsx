import {
  BarChart3,
  Bookmark,
  ChartNoAxesColumn,
  CircleHelp,
  Flame,
  type LucideIcon,
  Search,
  ShoppingBag,
  Star,
  Store,
  User,
} from "lucide-react";
import { useState } from "react";
import { INDICATOR_REGISTRY, type IndicatorType } from "../../lib/indicators.ts";
import { cn } from "../../lib/utils.ts";
import { notAvailable } from "./notAvailable.ts";
import { Modal } from "./ui.tsx";

/** TradingView's left navigation; only Technicals is served here. */
const NAV: { section: string; items: { label: string; icon: LucideIcon; served?: boolean }[] }[] = [
  {
    section: "Personal",
    items: [
      { label: "My scripts", icon: User },
      { label: "Purchased", icon: ShoppingBag },
    ],
  },
  {
    section: "Built-in",
    items: [
      { label: "Technicals", icon: ChartNoAxesColumn, served: true },
      { label: "Fundamentals", icon: BarChart3 },
    ],
  },
  {
    section: "Community",
    items: [
      { label: "Editors' picks", icon: Bookmark },
      { label: "Top", icon: BarChart3 },
      { label: "Trending", icon: Flame },
      { label: "Marketplace", icon: Store },
    ],
  },
];

const CHIPS = ["Indicators", "Strategies", "Profiles", "Patterns", "Options"];

/**
 * "Indicators, metrics, and strategies", laid out like TradingView's: a
 * search field, the library navigation on the left, category chips and the
 * script list. Clicking a script adds it (or removes it when it is on).
 */
export function IndicatorsDialog({
  open,
  active,
  onToggle,
  onClose,
}: {
  open: boolean;
  active: IndicatorType[];
  onToggle: (type: IndicatorType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = INDICATOR_REGISTRY.filter(
    (i) => !q || i.label.toLowerCase().includes(q) || i.type.toLowerCase().includes(q),
  ).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Modal open={open} title="Indicators, metrics, and strategies" onClose={onClose} width={840} height="min(640px, calc(100vh - 110px))">
      <div className="shrink-0 px-5 pb-3">
        <label className="flex h-[40px] items-center gap-2 rounded-lg border border-border px-3 focus-within:border-[#2962ff]">
          <Search className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-full flex-1 border-0 bg-transparent px-0 text-[16px] outline-none ring-0 focus:border-0 focus:ring-0"
          />
        </label>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-[232px] shrink-0 overflow-y-auto px-3 pb-3 sm:block">
          {NAV.map((sec) => (
            <div key={sec.section} className="mb-2">
              <div className="px-2 pb-1.5 pt-2 text-[11px] uppercase tracking-[0.4px] text-muted-foreground">{sec.section}</div>
              {sec.items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  onClick={() => (it.served ? undefined : notAvailable(`${it.label} scripts`))}
                  className={cn(
                    "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px]",
                    it.served ? "bg-secondary font-semibold" : "hover:bg-secondary",
                  )}
                >
                  <it.icon className="h-5 w-5" strokeWidth={1.25} />
                  {it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1.5 px-3 pb-2">
            {CHIPS.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => (i === 0 ? undefined : notAvailable(c))}
                className={cn(
                  "h-8 rounded-full px-3 text-[14px]",
                  i === 0 ? "bg-tv-active text-tv-active-foreground" : "bg-pill hover:bg-secondary",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-[0.4px] text-muted-foreground">Script name</div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {rows.map((ind) => {
              const on = active.includes(ind.type);
              return (
                <button
                  key={ind.type}
                  type="button"
                  onClick={() => onToggle(ind.type)}
                  className="group flex h-8 w-full items-center gap-2.5 px-3 text-left text-[14px] hover:bg-secondary"
                >
                  <Star
                    className={cn("h-4 w-4 shrink-0", on ? "fill-warning text-warning" : "text-muted-foreground")}
                    strokeWidth={1.25}
                  />
                  <span className="flex-1">{ind.label}</span>
                  {on && <span className="text-[12px] text-muted-foreground">On chart</span>}
                  <CircleHelp className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={1.25} />
                </button>
              );
            })}
            {rows.length === 0 && (
              <div className="px-5 py-12 text-center text-muted-foreground">No results for “{query}”</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
