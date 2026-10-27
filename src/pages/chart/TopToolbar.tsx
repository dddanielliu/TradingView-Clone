import {
  AlarmClockPlus,
  Camera,
  Copy,
  Download,
  ExternalLink,
  Link2,
  ChartCandlestick,
  Lightbulb,
  Plus,
  ChevronUp,
  ChartNoAxesCombined,
  CirclePlus,
  ChevronDown,
  Maximize,
  Redo2,
  Rewind,
  Search,
  Settings,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import type { IndicatorType } from "../../lib/indicators.ts";
import { cn } from "../../lib/utils.ts";
import { TIMEFRAMES, type Timeframe, timeframeMs } from "../trading/constants.ts";
import { CustomIntervalDialog } from "./CustomIntervalDialog.tsx";
import { ChartTemplatesMenu } from "../trading/ChartTemplatesMenu.tsx";
import { notAvailable } from "./notAvailable.ts";
import { intervalLong, intervalShort, useCustomIntervals } from "./shared.ts";
import { HeaderButton, MenuDivider, MenuItem, MenuTitle, Popover, ToolbarSeparator } from "./ui.tsx";

/** TradingView's interval menu, section by section; `tf` marks the ones this chart serves. */
const INTERVAL_SECTIONS: { title: string; items: { label: string; tf?: Timeframe; custom?: boolean }[] }[] = [
  { title: "Ticks", items: ["1 tick", "10 ticks", "100 ticks", "1000 ticks"].map((label) => ({ label })) },
  { title: "Seconds", items: ["1 second", "5 seconds", "10 seconds", "15 seconds", "30 seconds", "45 seconds"].map((label) => ({ label })) },
  {
    title: "Minutes",
    items: [
      { label: "1 minute", tf: "1m" },
      { label: "2 minutes", tf: "2m" },
      { label: "3 minutes", tf: "3m" },
      { label: "5 minutes", tf: "5m" },
      { label: "10 minutes", tf: "10m" },
      { label: "15 minutes", tf: "15m" },
      { label: "30 minutes", tf: "30m" },
      { label: "45 minutes", tf: "45m" },
    ],
  },
  { title: "Hours", items: [{ label: "1 hour", tf: "1h" }, { label: "2 hours", tf: "2h" }, { label: "3 hours", tf: "3h" }, { label: "4 hours", tf: "4h" }] },
  {
    title: "Days",
    items: [
      { label: "1 day", tf: "1d" },
      { label: "1 week", tf: "1w" },
      { label: "1 month", tf: "1M" },
      { label: "3 months", tf: "3M" },
      { label: "6 months", tf: "6M" },
      { label: "12 months", tf: "12M" },
    ],
  },
  { title: "Ranges", items: ["1 range", "10 ranges", "100 ranges", "1000 ranges"].map((label) => ({ label })) },
];

const CHART_TYPES = ["Bars", "Candles", "Hollow candles", "Line", "Area", "Baseline", "Heikin Ashi"];

const PLUGIN_ITEMS: { id: string; label: string }[] = [
  { id: "crosshair", label: "Crosshair highlight" },
  { id: "session", label: "Session highlighting" },
  { id: "session-breaks", label: "Session breaks" },
  { id: "bands", label: "Bands" },
  { id: "tooltip", label: "OHLCV tooltip" },
  { id: "delta-tooltip", label: "Delta tooltip" },
];

export interface TopToolbarProps {
  symbol: string;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  onOpenSymbolSearch: () => void;
  onOpenIndicators: () => void;
  activeIndicators: IndicatorType[];
  onSetIndicators: (list: IndicatorType[]) => void;
  activePlugins: string[];
  onTogglePlugin: (id: string) => void;
  onSetPlugins: (ids: string[]) => void;
  onAddAlert: () => void;
  replayOn: boolean;
  onToggleReplay: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenSettings: () => void;
  onFullscreen: () => void;
  /** Take a snapshot's menu: download or copy the chart image. */
  onSnapshot: (action: "download" | "copy") => void;
  tradeOpen: boolean;
  onToggleTrade: () => void;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** The snapshot shortcuts as TradingView labels them (Mod is ⌘ on a Mac). */
const SNAPSHOT_KEYS = IS_MAC
  ? { download: "⌘ + ⌥ + S", copy: "⌘ + ⇧ + S", link: "⌥ + S" }
  : { download: "Ctrl + Alt + S", copy: "Ctrl + Shift + S", link: "Alt + S" };

/**
 * The chart's top toolbar, in TradingView's order: symbol search · compare ·
 * interval · chart type · indicators · indicator templates · alert · replay ·
 * undo / redo … layout · save · quick search · settings · fullscreen ·
 * snapshot · trade.
 */
export function TopToolbar(p: TopToolbarProps) {
  const [menu, setMenu] = useState<"interval" | "type" | "layout" | "snapshot" | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customIntervals, setCustomIntervals] = useCustomIntervals();
  const close = () => setMenu(null);
  const ticker = p.symbol.includes(":") ? p.symbol.slice(p.symbol.indexOf(":") + 1) : p.symbol;

  return (
    <div className="flex h-[38px] min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden no-scrollbar">
      <button
        id="header-toolbar-symbol-search"
        type="button"
        onClick={p.onOpenSymbolSearch}
        title="Symbol Search"
        className="ml-1 flex h-[28px] w-[128px] shrink-0 items-center rounded-[14px] bg-pill pl-3 pr-1 text-[14px] font-semibold text-foreground hover:bg-secondary"
      >
        <span className="min-w-0 flex-1 truncate text-left">{ticker}</span>
        <span className="flex h-[24px] w-[28px] shrink-0 items-center justify-center rounded-[12px] text-foreground/80">
          <ChartCandlestick className="h-[16px] w-[16px]" strokeWidth={1.25} />
        </span>
      </button>

      <HeaderButton className="ml-1" title="Compare symbols" onClick={() => notAvailable("Compare symbols")}>
        <CirclePlus className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>

      <ToolbarSeparator />

      <Popover
        open={menu === "interval"}
        onClose={close}
        trigger={
          <HeaderButton
            id="header-toolbar-intervals"
            className="w-[47px]"
            title={intervalLong(p.timeframe)}
            active={menu === "interval"}
            onClick={() => setMenu(menu === "interval" ? null : "interval")}
          >
            <span className="min-w-[22px] text-center">{intervalShort(p.timeframe)}</span>
          </HeaderButton>
        }
      >
        <IntervalMenu
          current={p.timeframe}
          custom={customIntervals}
          onRemoveCustom={(tf) => setCustomIntervals(customIntervals.filter((c) => c !== tf))}
          onPick={(tf) => {
            p.onTimeframe(tf);
            close();
          }}
          onAddCustom={() => {
            close();
            setCustomOpen(true);
          }}
          onUnavailable={(label) => {
            close();
            notAvailable(`The ${label} interval`);
          }}
        />
      </Popover>
      <CustomIntervalDialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onAdd={(tf) => {
          setCustomOpen(false);
          if (!TIMEFRAMES.includes(tf as (typeof TIMEFRAMES)[number]) && !customIntervals.includes(tf)) {
            setCustomIntervals([...customIntervals, tf]);
          }
          p.onTimeframe(tf);
        }}
      />

      <ToolbarSeparator />

      <Popover
        open={menu === "type"}
        onClose={close}
        trigger={
          <HeaderButton title="Candles" active={menu === "type"} onClick={() => setMenu(menu === "type" ? null : "type")}>
            <ChartCandlestick className="h-[22px] w-[22px]" strokeWidth={1.25} />
          </HeaderButton>
        }
      >
        {CHART_TYPES.map((t) => (
          <MenuItem
            key={t}
            selected={t === "Candles"}
            onClick={() => {
              close();
              if (t !== "Candles") notAvailable(`${t} chart type`);
            }}
          >
            {t}
          </MenuItem>
        ))}
      </Popover>

      <ToolbarSeparator />

      <HeaderButton id="header-toolbar-indicators" className="lg:w-[108px]" title="Indicators, metrics, and strategies" onClick={p.onOpenIndicators}>
        <ChartNoAxesCombined className="h-[22px] w-[22px]" strokeWidth={1.25} />
        <span className="hidden lg:inline">Indicators</span>
        {p.activeIndicators.length > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[11px] leading-[16px] text-primary-foreground">
            {p.activeIndicators.length}
          </span>
        )}
      </HeaderButton>

      <Popover
        open={menu === "layout"}
        onClose={close}
        trigger={
          // TradingView's 24px chevron beside Indicators; ours also holds the
          // chart plugins.
          <HeaderButton
            className="!min-w-[24px] w-[24px] !px-0"
            title="Favorite indicators and indicators templates"
            active={menu === "layout"}
            onClick={() => setMenu(menu === "layout" ? null : "layout")}
          >
            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
          </HeaderButton>
        }
      >
        <MenuTitle>Chart plugins</MenuTitle>
        {PLUGIN_ITEMS.map((it) => (
          <MenuItem
            key={it.id}
            onClick={() => p.onTogglePlugin(it.id)}
            hint={p.activePlugins.includes(it.id) ? "On" : undefined}
          >
            {it.label}
          </MenuItem>
        ))}
      </Popover>

      <ToolbarSeparator />

      <HeaderButton className="lg:w-[76px]" title="Create alert at the last price" onClick={p.onAddAlert}>
        <AlarmClockPlus className="h-[22px] w-[22px]" strokeWidth={1.25} />
        <span className="hidden lg:inline">Alert</span>
      </HeaderButton>

      <HeaderButton id="header-toolbar-replay" className="lg:w-[90px]" title="Bar replay" pressed={p.replayOn} onClick={p.onToggleReplay}>
        <Rewind className="h-[22px] w-[22px]" strokeWidth={1.25} />
        <span className="hidden lg:inline">Replay</span>
      </HeaderButton>

      <ToolbarSeparator />

      <HeaderButton title="Undo" onClick={p.onUndo}>
        <Undo2 className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>
      <HeaderButton title="Redo" onClick={p.onRedo}>
        <Redo2 className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>

      <div className="min-w-2 flex-1" />

      <HeaderButton title="Layout setup" onClick={() => notAvailable("Multiple chart layouts")}>
        <Square className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>

      <ChartTemplatesMenu
        activeIndicators={p.activeIndicators}
        onSetIndicators={p.onSetIndicators}
        activePlugins={p.activePlugins}
        onSetPlugins={p.onSetPlugins}
      />

      <ToolbarSeparator />

      <HeaderButton title="Quick search" onClick={p.onOpenSymbolSearch}>
        <Search className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>
      <HeaderButton title="Settings" onClick={p.onOpenSettings}>
        <Settings className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>
      <HeaderButton title="Fullscreen mode" onClick={p.onFullscreen}>
        <Maximize className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>
      <Popover
        open={menu === "snapshot"}
        onClose={() => setMenu(null)}
        align="right"
        trigger={
          <HeaderButton
            title="Take a snapshot"
            active={menu === "snapshot"}
            onClick={() => setMenu(menu === "snapshot" ? null : "snapshot")}
          >
            <Camera className="h-[22px] w-[22px]" strokeWidth={1.25} />
          </HeaderButton>
        }
      >
        {/* TradingView's snapshot menu. Link / new tab / post need its image
            hosting, which this app does not offer. */}
        <MenuTitle>Chart snapshot</MenuTitle>
        <MenuItem icon={<Download className="h-[18px] w-[18px]" strokeWidth={1.25} />} hint={SNAPSHOT_KEYS.download} onClick={() => { setMenu(null); p.onSnapshot("download"); }}>
          Download image
        </MenuItem>
        <MenuItem icon={<Copy className="h-[18px] w-[18px]" strokeWidth={1.25} />} hint={SNAPSHOT_KEYS.copy} onClick={() => { setMenu(null); p.onSnapshot("copy"); }}>
          Copy image
        </MenuItem>
        <MenuItem icon={<Link2 className="h-[18px] w-[18px]" strokeWidth={1.25} />} hint={SNAPSHOT_KEYS.link} onClick={() => { setMenu(null); notAvailable("Copy link"); }}>
          Copy link
        </MenuItem>
        <MenuItem icon={<ExternalLink className="h-[18px] w-[18px]" strokeWidth={1.25} />} onClick={() => { setMenu(null); notAvailable("Open in new tab"); }}>
          Open in new tab
        </MenuItem>
        <MenuItem icon={<span className="text-[16px] leading-none">𝕏</span>} onClick={() => { setMenu(null); notAvailable("Post image"); }}>
          Post image
        </MenuItem>
      </Popover>

      <HeaderButton title="Publish idea" onClick={() => notAvailable("Publishing ideas")}>
        <Lightbulb className="h-[22px] w-[22px]" strokeWidth={1.25} />
      </HeaderButton>

      <button
        type="button"
        onClick={p.onToggleTrade}
        className={cn(
          // TradingView: 60 × 28 and 78 × 28 pills, 4px apart from the icons, 8px between.
          "ml-1 mr-2 h-[28px] w-[60px] shrink-0 rounded-[14px] border text-[14px] transition-colors",
          p.tradeOpen ? "border-tv-active bg-tv-active text-tv-active-foreground" : "border-border hover:bg-secondary",
        )}
      >
        Trade
      </button>
      <button
        type="button"
        onClick={() => notAvailable("Upgrading your plan")}
        className="mr-1 h-[28px] w-[78px] shrink-0 rounded-[14px] bg-tv-active text-[14px] text-tv-active-foreground hover:opacity-90"
      >
        Upgrade
      </button>
    </div>
  );
}


/** Custom intervals join their section in time order: minutes, hours, then days and up. */
function withCustom(custom: Timeframe[]): typeof INTERVAL_SECTIONS {
  const sectionOf = (tf: Timeframe) => (tf.endsWith("m") ? "Minutes" : tf.endsWith("h") ? "Hours" : "Days");
  return INTERVAL_SECTIONS.map((sec) => {
    const extra = custom.filter((tf) => sectionOf(tf) === sec.title).map((tf) => ({ label: intervalLong(tf), tf, custom: true }));
    if (extra.length === 0) return sec;
    const items = [...sec.items, ...extra].sort((a, b) => timeframeMs(a.tf ?? "") - timeframeMs(b.tf ?? ""));
    return { ...sec, items };
  });
}

function IntervalMenu({
  current,
  custom,
  onRemoveCustom,
  onPick,
  onAddCustom,
  onUnavailable,
}: {
  current: Timeframe;
  custom: Timeframe[];
  onRemoveCustom: (tf: Timeframe) => void;
  onPick: (tf: Timeframe) => void;
  onAddCustom: () => void;
  onUnavailable: (label: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="max-h-[calc(100vh-60px)] w-[188px] overflow-y-auto">
      <MenuItem icon={<Plus className="h-[18px] w-[18px]" strokeWidth={1.25} />} onClick={onAddCustom}>
        Add custom interval…
      </MenuItem>
      {withCustom(custom).map((sec) => (
        <div key={sec.title}>
          <MenuDivider />
          <button
            type="button"
            onClick={() => setCollapsed((c) => ({ ...c, [sec.title]: !c[sec.title] }))}
            className="flex h-[28px] w-full items-center justify-between rounded px-2 text-[11px] uppercase tracking-[0.4px] text-muted-foreground hover:bg-secondary"
          >
            {sec.title}
            <ChevronUp className={cn("h-4 w-4 transition-transform", collapsed[sec.title] && "rotate-180")} strokeWidth={1.5} />
          </button>
          {!collapsed[sec.title] &&
            sec.items.map((it) => (
              <MenuItem
                key={it.label}
                selected={it.tf === current}
                onClick={() => (it.tf ? onPick(it.tf) : onUnavailable(it.label))}
              >
                <span className="group/custom flex items-center">
                  <span className="flex-1">{it.label}</span>
                  {it.custom && it.tf && (
                    <span
                      role="button"
                      tabIndex={-1}
                      title="Remove from favorites"
                      aria-label="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveCustom(it.tf!);
                      }}
                      className="invisible flex h-5 w-5 items-center justify-center group-hover/custom:visible"
                    >
                      <X className="h-[14px] w-[14px]" strokeWidth={1.5} />
                    </span>
                  )}
                </span>
              </MenuItem>
            ))}
        </div>
      ))}
    </div>
  );
}
