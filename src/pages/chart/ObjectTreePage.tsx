import { ChartCandlestick, Copy, Eye, EyeOff, FolderPlus, ListChecks, Lock, LockOpen, Spline, Trash2, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { INDICATOR_REGISTRY, type IndicatorType } from "../../lib/indicators.ts";
import { cn } from "../../lib/utils.ts";
import type { DrawingLine } from "../trading/constants.ts";
import type { CrosshairBar } from "../trading/ChartPanel.tsx";
import { formatAxisTime } from "../../lib/chart-plugins/drawing-tools/drawings-primitive.ts";
import { notAvailable } from "./notAvailable.ts";
import { priceDigits } from "./shared.ts";

/** TradingView's names for drawings in the Object tree. */
const DRAWING_NAMES: Record<string, string> = {
  trendline: "Trend line",
  horizontal: "Horizontal line",
  vertical: "Vertical line",
  channel: "Parallel channel",
  fibonacci: "Fib retracement",
  fibextension: "Trend-based fib extension",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  arrow: "Arrow",
  text: "Text",
  position: "Position",
  brush: "Brush",
  textnote: "Note",
  pricenote: "Price note",
  pin: "Pin",
  table: "Table",
  callout: "Callout",
  comment: "Comment",
  pricelabel: "Price label",
  signpost: "Signpost",
  flagmark: "Flag mark",
  image: "Image",
  icon: "Icon",
  emoji: "Emoji",
  highlighter: "Highlighter",
  arrowmarker: "Arrow marker",
  arrowup: "Arrow mark up",
  arrowdown: "Arrow mark down",
  rotatedrect: "Rotated rectangle",
  path: "Path",
  circle: "Circle",
  polyline: "Polyline",
  arc: "Arc",
  curve: "Curve",
  doublecurve: "Double curve",
  forecast: "Position forecast",
  barspattern: "Bars pattern",
  ghostfeed: "Ghost feed",
  sector: "Sector",
  anchoredvwap: "Anchored VWAP",
  frvp: "Fixed range volume profile",
  avp: "Anchored volume profile",
  pricerange: "Price range",
  daterange: "Date range",
  datepricerange: "Date and price range",
  cycliclines: "Cyclic lines",
  timecycles: "Time cycles",
  sineline: "Sine line",
  fibextension3: "Trend-based fib extension",
  fibchannel: "Fib channel",
  fibtimezone: "Fib time zone",
  fibspeedfan: "Fib speed resistance fan",
  fibtime: "Trend-based fib time",
  fibcircles: "Fib circles",
  fibspiral: "Fib spiral",
  fibarcs: "Fib speed resistance arcs",
  fibwedge: "Fib wedge",
  pitchfan: "Pitchfan",
  gannbox: "Gann box",
  gannfixed: "Gann square fixed",
  gannsquare: "Gann square",
  gannfan: "Gann fan",
  horzray: "Horizontal ray",
  crossline: "Crossline",
  trendangle: "Trend angle",
  flatbottom: "Flat top/bottom",
  disjointchannel: "Disjoint channel",
  regression: "Regression trend",
  pitchfork: "Pitchfork",
  schiffpitchfork: "Schiff pitchfork",
  modschiffpitchfork: "Modified Schiff pitchfork",
  insidepitchfork: "Inside pitchfork",
  xabcd: "XABCD pattern",
  cypher: "Cypher pattern",
  abcd: "ABCD pattern",
  headshoulders: "Head and shoulders",
  trianglepattern: "Triangle pattern",
  threedrives: "Three drives pattern",
  elliottimpulse: "Elliott impulse wave (12345)",
  elliottcorrection: "Elliott correction wave (ABC)",
  elliotttriangle: "Elliott triangle wave (ABCDE)",
  elliottdouble: "Elliott double combo wave (WXY)",
  elliotttriple: "Elliott triple combo wave (WXYXZ)",
};

/**
 * TradingView's "Object tree and data window" panel: a segmented control
 * switching between the tree of everything on the chart and the values under
 * the crosshair.
 */
export function ObjectTreePage(props: {
  symbol: string;
  intervalLabel: string;
  indicators: IndicatorType[];
  onRemoveIndicator: (t: IndicatorType) => void;
  drawings: DrawingLine[];
  onUpdateDrawing: (d: DrawingLine) => void;
  onRemoveDrawing: (id: string) => void;
  onSelectDrawing: (id: string) => void;
  bar: CrosshairBar | null;
  intraday: boolean;
  dayChange?: { change: number; changePct: number } | null;
}) {
  const [tab, setTab] = useState<"tree" | "data">("tree");
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-[10px]">
        <div className="flex h-[34px] rounded-[8px] bg-pill p-[3px] text-[14px] font-medium">
          {(["tree", "data"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 rounded-[6px]",
                tab === t ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.1)]" : "text-[#464646] dark:text-muted-foreground",
              )}
            >
              {t === "tree" ? "Object tree" : "Data window"}
            </button>
          ))}
        </div>
      </div>
      {tab === "tree" ? <Tree {...props} /> : <DataWindow {...props} />}
    </div>
  );
}

function Tree({
  symbol,
  intervalLabel,
  indicators,
  onRemoveIndicator,
  drawings,
  onUpdateDrawing,
  onRemoveDrawing,
  onSelectDrawing,
}: Parameters<typeof ObjectTreePage>[0]) {
  const colon = symbol.indexOf(":");
  const title = colon > 0 ? `${symbol.slice(colon + 1)} · ${symbol.slice(0, colon)}, ${intervalLabel}` : `${symbol}, ${intervalLabel}`;
  return (
    <>
      <div className="flex h-[44px] items-center border-b border-border px-3">
        <ToolIcon title="Create a group of drawings" onClick={() => notAvailable("Drawing groups")}>
          <FolderPlus className="h-[18px] w-[18px]" strokeWidth={1.25} />
        </ToolIcon>
        <ToolIcon title="Clone" onClick={() => notAvailable("Cloning from the object tree")}>
          <Copy className="h-[18px] w-[18px]" strokeWidth={1.25} />
        </ToolIcon>
        <ToolIcon title="Move to" onClick={() => notAvailable("Moving between panes")}>
          <ArrowUpDown className="h-[18px] w-[18px]" strokeWidth={1.25} />
        </ToolIcon>
        <div className="flex-1" />
        <ToolIcon title="Manage" onClick={() => notAvailable("Managing object tree items")}>
          <ListChecks className="h-[18px] w-[18px]" strokeWidth={1.25} />
        </ToolIcon>
      </div>
      <div className="tv-scroll min-h-0 flex-1 py-2">
        <Row icon={<ChartCandlestick className="h-[18px] w-[18px]" strokeWidth={1.25} />} label={title} bold />
        <Row icon={<Spline className="h-[18px] w-[18px]" strokeWidth={1.25} />} label="Vol" />
        {indicators.map((t) => (
          <Row
            key={t}
            icon={<Spline className="h-[18px] w-[18px]" strokeWidth={1.25} />}
            label={INDICATOR_REGISTRY.find((i) => i.type === t)?.label ?? t}
            onRemove={() => onRemoveIndicator(t)}
          />
        ))}
        {drawings.map((d) => (
          <Row
            key={d.id}
            icon={<span className="h-[10px] w-[10px] rounded-full" style={{ background: d.color }} />}
            label={DRAWING_NAMES[d.type] ?? d.type}
            dim={d.hidden}
            onClick={() => onSelectDrawing(d.id)}
            hidden={d.hidden}
            onToggleHidden={() => onUpdateDrawing({ ...d, hidden: !d.hidden })}
            locked={d.locked}
            onToggleLock={() => onUpdateDrawing({ ...d, locked: !d.locked })}
            onRemove={() => onRemoveDrawing(d.id)}
          />
        ))}
      </div>
    </>
  );
}

function ToolIcon({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="flex h-[30px] w-[30px] items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
      {children}
    </button>
  );
}

function Row({
  icon,
  label,
  bold,
  dim,
  onClick,
  hidden,
  onToggleHidden,
  locked,
  onToggleLock,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  bold?: boolean;
  dim?: boolean;
  onClick?: () => void;
  hidden?: boolean;
  onToggleHidden?: () => void;
  locked?: boolean;
  onToggleLock?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onClick}
      className={cn("group flex h-[38px] cursor-default items-center gap-3 px-6 text-[14px] hover:bg-secondary", dim && "opacity-50")}
    >
      <span className="flex w-[18px] shrink-0 justify-center">{icon}</span>
      <span className={cn("min-w-0 flex-1 truncate", bold && "font-semibold")}>{label}</span>
      <span className="hidden items-center gap-1 group-hover:flex">
        {onToggleLock && (
          <button type="button" title={locked ? "Unlock" : "Lock"} onClick={(e) => { e.stopPropagation(); onToggleLock(); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted">
            {locked ? <Lock className="h-4 w-4" strokeWidth={1.25} /> : <LockOpen className="h-4 w-4" strokeWidth={1.25} />}
          </button>
        )}
        {onToggleHidden && (
          <button type="button" title={hidden ? "Show" : "Hide"} onClick={(e) => { e.stopPropagation(); onToggleHidden(); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted">
            {hidden ? <EyeOff className="h-4 w-4" strokeWidth={1.25} /> : <Eye className="h-4 w-4" strokeWidth={1.25} />}
          </button>
        )}
        {onRemove && (
          <button type="button" title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted">
            <Trash2 className="h-4 w-4" strokeWidth={1.25} />
          </button>
        )}
      </span>
    </div>
  );
}

function DataWindow({ symbol, intervalLabel, bar, intraday, dayChange }: Parameters<typeof ObjectTreePage>[0]) {
  const colon = symbol.indexOf(":");
  const title = colon > 0 ? `${symbol.slice(colon + 1)} · ${intervalLabel} · ${symbol.slice(0, colon)}` : `${symbol} · ${intervalLabel}`;
  if (!bar) return <div className="p-4 text-[14px] text-muted-foreground">No data</div>;
  const d = priceDigits(bar.close);
  const up = bar.close >= bar.open;
  const tone = up ? "text-[#089981]" : "text-[#f23645]";
  const f = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const vol = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)} M` : v >= 1e3 ? `${(v / 1e3).toFixed(2)} K` : String(Math.round(v)));
  const ch = bar.prevClose != null ? bar.close - bar.prevClose : bar.close - bar.open;
  const chPct = bar.prevClose ? (ch / bar.prevClose) * 100 : 0;
  const signed = (v: number, digits = d) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
  const dateText = formatAxisTime(bar.time, false);
  const timeText = intraday ? formatAxisTime(bar.time, true).slice(dateText.length + 1) : null;
  return (
    <div className="tv-scroll min-h-0 flex-1 px-4 py-3 text-[14px]">
      <Line label="Date" value={dateText} />
      {timeText && <Line label="Time" value={timeText} />}
      <div className="mt-4 mb-2 pl-9 font-semibold">{title}</div>
      <Line label="Open" value={f(bar.open)} tone={tone} />
      <Line label="High" value={f(bar.high)} tone={tone} />
      <Line label="Low" value={f(bar.low)} tone={tone} />
      <Line label="Close" value={f(bar.close)} tone={tone} />
      <Line label="Change" value={`${signed(ch)} (${signed(chPct, 2)}%)`} tone={ch >= 0 ? "text-[#089981]" : "text-[#f23645]"} />
      <Line label="Vol" value={vol(bar.volume)} tone={tone} />
      {dayChange && (
        <Line
          label="Last day change"
          value={`${signed(dayChange.change)} (${signed(dayChange.changePct, 2)}%)`}
          tone={dayChange.change >= 0 ? "text-[#089981]" : "text-[#f23645]"}
        />
      )}
      <div className="mt-4 mb-2 pl-9 font-semibold">Vol</div>
      <Line label="Volume" value={vol(bar.volume)} tone={up ? "text-[#089981]" : "text-[#ef5350]"} />
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex h-[26px] items-center justify-between">
      <span>{label}</span>
      <span className={cn("tabular-nums", tone)}>{value}</span>
    </div>
  );
}
