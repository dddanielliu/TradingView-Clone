import { Equal, Minus, MoveUpRight, MoveVertical, Plus, Spline } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { CursorMode, DrawingLine, DrawingTool, MagnetMode } from "../trading/constants.ts";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Converts a Windows-style shortcut ("Alt + Shift + R") to Mac glyphs ("⌥ ⇧ R"). */
function macShortcut(shortcut: string): string {
  return shortcut
    .replace(/Alt/g, "⌥")
    .replace(/Ctrl/g, "⌘")
    .replace(/Shift/g, "⇧")
    .replace(/\s*\+\s*/g, " ");
}

function shortcutFor(shortcut: string): string {
  return IS_MAC ? macShortcut(shortcut) : shortcut;
}
import {
  ArrowCursorIcon,
  ArrowIcon,
  BrushIcon,
  CrossIcon,
  DemonstrationIcon,
  DotIcon,
  EllipseIcon,
  EraserIcon,
  EyeIcon,
  FibChannelIcon,
  FibCirclesIcon,
  FibArcsIcon,
  FibExtensionIcon,
  FibTimeIcon,
  FibIcon,
  FibSpiralIcon,
  FibTimeZoneIcon,
  FibWedgeIcon,
  GannBoxIcon,
  GannFanIcon,
  HeadAndShouldersIcon,
  KeepDrawingIcon,
  LockIcon,
  LongPositionIcon,
  MagnetIcon,
  PatternIcon,
  PitchfanIcon,
  RectangleIcon,
  CypherPatternIcon,
  ABCDPatternIcon,
  TrianglePatternIcon,
  ThreeDrivesIcon,
  ElliottImpulseIcon,
  ElliottCorrectionIcon,
  ElliottTriangleIcon,
  ElliottDoubleComboIcon,
  ElliottTripleComboIcon,
  CyclicLinesIcon,
  TimeCyclesIcon,
  SineLineIcon,
  PositionForecastIcon,
  BarsPatternIcon,
  GhostFeedIcon,
  SectorIcon,
  AnchoredVWAPIcon,
  FixedRangeVolumeProfileIcon,
  AnchoredVolumeProfileIcon,
  PriceRangeIcon,
  DateRangeIcon,
  DateAndPriceRangeIcon,
  RulerIcon,
  ShortPositionIcon,
  SmileIcon,
  TextIcon,
  TrashIcon,
  TrendLineIcon,
  TriangleIcon,
  ZoomInIcon,
  HighlighterIcon,
  ArrowMarkerIcon,
  ArrowMarkUpIcon,
  ArrowMarkDownIcon,
  RotatedRectangleIcon,
  PathIcon,
  CircleIcon,
  PolylineIcon,
  ArcIcon,
  CurveIcon,
  DoubleCurveIcon,
  NoteIcon,
  PriceNoteIcon,
  PinIcon,
  TableIcon,
  CalloutIcon,
  CommentIcon,
  PriceLabelIcon,
  SignpostIcon,
  FlagMarkIcon,
  ImageIcon,
} from "./icons.tsx";
import { IconsPicker } from "./IconsPicker.tsx";
import { useDismiss } from "./shared.ts";
import { MenuDivider, MenuItem, MenuTitle } from "./ui.tsx";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

interface ToolMeta {
  tool: DrawingTool;
  icon: Icon;
  label: string;
  /** The toolbar tooltip when it differs from the menu label (TradingView: "Trendline"). */
  tip?: string;
  shortcut?: string;
}

interface ToolGroup {
  id: string;
  /** TradingView's name for the group (its tooltip). */
  label: string;
  sections: { title: string; tools: ToolMeta[] }[];
}

/**
 * TradingView's drawing groups, limited to the tools this chart implements.
 * Section titles and shortcuts are TradingView's.
 */
const GROUPS: ToolGroup[] = [
  {
    id: "cursors",
    label: "Cursors",
    // Cursor tools are cursor modes, not drawing tools: see CURSOR_TOOLS.
    sections: [{ title: "", tools: [{ tool: "eraser", icon: EraserIcon, label: "Eraser" }] }],
  },
  {
    id: "trend",
    label: "Trend line tools",
    sections: [
      // TradingView's order, shortcuts included.
      {
        title: "Lines",
        tools: [
          { tool: "trendline", icon: TrendLineIcon, label: "Trend line", tip: "Trendline", shortcut: shortcutFor("Alt + T") },
          { tool: "ray", icon: MoveUpRight, label: "Ray" },
          { tool: "infoline", icon: TrendLineIcon, label: "Info line" },
          { tool: "extended", icon: Spline, label: "Extended line" },
          { tool: "trendangle", icon: TrendLineIcon, label: "Trend angle" },
          { tool: "horizontal", icon: Minus, label: "Horizontal line", shortcut: shortcutFor("Alt + H") },
          { tool: "horzray", icon: Minus, label: "Horizontal ray", shortcut: shortcutFor("Alt + J") },
          { tool: "vertical", icon: MoveVertical, label: "Vertical line", shortcut: shortcutFor("Alt + V") },
          { tool: "crossline", icon: Plus, label: "Crossline", shortcut: shortcutFor("Alt + C") },
        ],
      },
      {
        title: "Channels",
        tools: [
          { tool: "channel", icon: Equal, label: "Parallel channel" },
          { tool: "regression", icon: Equal, label: "Regression trend" },
          { tool: "flatbottom", icon: Equal, label: "Flat top/bottom" },
          { tool: "disjointchannel", icon: Equal, label: "Disjoint channel" },
        ],
      },
      {
        title: "Pitchforks",
        tools: [
          { tool: "pitchfork", icon: Spline, label: "Pitchfork" },
          { tool: "schiffpitchfork", icon: Spline, label: "Schiff pitchfork" },
          { tool: "modschiffpitchfork", icon: Spline, label: "Modified Schiff pitchfork" },
          { tool: "insidepitchfork", icon: Spline, label: "Inside pitchfork" },
        ],
      },
    ],
  },
  {
    id: "fib",
    label: "Gann and Fibonacci tools",
    sections: [
      {
        title: "Fibonacci",
        tools: [
          { tool: "fibonacci", icon: FibIcon, label: "Fib retracement", shortcut: shortcutFor("Alt + F") },
          { tool: "fibextension3", icon: FibExtensionIcon, label: "Trend-based fib extension" },
          { tool: "fibchannel", icon: FibChannelIcon, label: "Fib channel" },
          { tool: "fibtimezone", icon: FibTimeZoneIcon, label: "Fib time zone" },
          { tool: "fibspeedfan", icon: FibArcsIcon, label: "Fib speed resistance fan" },
          { tool: "fibtime", icon: FibTimeIcon, label: "Trend-based fib time" },
          { tool: "fibcircles", icon: FibCirclesIcon, label: "Fib circles" },
          { tool: "fibspiral", icon: FibSpiralIcon, label: "Fib spiral" },
          { tool: "fibarcs", icon: FibArcsIcon, label: "Fib speed resistance arcs" },
          { tool: "fibwedge", icon: FibWedgeIcon, label: "Fib wedge" },
          { tool: "pitchfan", icon: PitchfanIcon, label: "Pitchfan" },
        ],
      },
      {
        title: "Gann",
        tools: [
          { tool: "gannbox", icon: GannBoxIcon, label: "Gann box" },
          { tool: "gannfixed", icon: FibIcon, label: "Gann square fixed" },
          { tool: "gannsquare", icon: FibIcon, label: "Gann square" },
          { tool: "gannfan", icon: GannFanIcon, label: "Gann fan" },
        ],
      },
    ],
  },
  {
    id: "patterns",
    label: "Patterns",
    // TradingView opens this group on its XABCD pattern.
    sections: [
      {
        title: "Chart patterns",
        tools: [
          { tool: "xabcd", icon: PatternIcon, label: "XABCD pattern" },
          { tool: "cypher", icon: CypherPatternIcon, label: "Cypher pattern" },
          { tool: "headshoulders", icon: HeadAndShouldersIcon, label: "Head and shoulders" },
          { tool: "abcd", icon: ABCDPatternIcon, label: "ABCD pattern" },
          { tool: "trianglepattern", icon: TrianglePatternIcon, label: "Triangle pattern" },
          { tool: "threedrives", icon: ThreeDrivesIcon, label: "Three drives pattern" },
        ],
      },
      {
        title: "Elliott waves",
        tools: [
          { tool: "elliottimpulse", icon: ElliottImpulseIcon, label: "Elliott impulse wave (1·2·3·4·5)" },
          { tool: "elliottcorrection", icon: ElliottCorrectionIcon, label: "Elliott correction wave (A·B·C)" },
          { tool: "elliotttriangle", icon: ElliottTriangleIcon, label: "Elliott triangle wave (A·B·C·D·E)" },
          { tool: "elliottdouble", icon: ElliottDoubleComboIcon, label: "Elliott double combo wave (W·X·Y)" },
          { tool: "elliotttriple", icon: ElliottTripleComboIcon, label: "Elliott triple combo wave (W·X·Y·X·Z)" },
        ],
      },
      {
        title: "Cycles",
        tools: [
          { tool: "cycliclines", icon: CyclicLinesIcon, label: "Cyclic lines" },
          { tool: "timecycles", icon: TimeCyclesIcon, label: "Time cycles" },
          { tool: "sineline", icon: SineLineIcon, label: "Sine line" },
        ],
      },
    ],
  },
  {
    id: "forecast",
    label: "Forecasting and measurement tools",
    sections: [
      {
        title: "Forecasting",
        tools: [
          { tool: "long-position", icon: LongPositionIcon, label: "Long position" },
          { tool: "short-position", icon: ShortPositionIcon, label: "Short position" },
          { tool: "forecast", icon: PositionForecastIcon, label: "Position forecast" },
          { tool: "barspattern", icon: BarsPatternIcon, label: "Bars pattern" },
          { tool: "ghostfeed", icon: GhostFeedIcon, label: "Ghost feed" },
          { tool: "sector", icon: SectorIcon, label: "Sector" },
        ],
      },
      {
        title: "Volume-based",
        tools: [
          { tool: "anchoredvwap", icon: AnchoredVWAPIcon, label: "Anchored VWAP" },
          { tool: "frvp", icon: FixedRangeVolumeProfileIcon, label: "Fixed range volume profile" },
          { tool: "avp", icon: AnchoredVolumeProfileIcon, label: "Anchored volume profile" },
        ],
      },
      {
        title: "Measurers",
        tools: [
          { tool: "pricerange", icon: PriceRangeIcon, label: "Price range" },
          { tool: "daterange", icon: DateRangeIcon, label: "Date range" },
          { tool: "datepricerange", icon: DateAndPriceRangeIcon, label: "Date and price range" },
        ],
      },
    ],
  },
  {
    id: "shapes",
    label: "Geometric shapes",
    sections: [
      // TradingView opens this group on its Brush.
      {
        title: "Brushes",
        tools: [
          { tool: "brush", icon: BrushIcon, label: "Brush" },
          { tool: "highlighter", icon: HighlighterIcon, label: "Highlighter" },
        ],
      },
      {
        title: "Arrows",
        tools: [
          { tool: "arrowmarker", icon: ArrowMarkerIcon, label: "Arrow marker" },
          { tool: "arrow", icon: ArrowIcon, label: "Arrow" },
          { tool: "arrowup", icon: ArrowMarkUpIcon, label: "Arrow mark up" },
          { tool: "arrowdown", icon: ArrowMarkDownIcon, label: "Arrow mark down" },
        ],
      },
      {
        title: "Shapes",
        tools: [
          { tool: "rectangle", icon: RectangleIcon, label: "Rectangle", shortcut: shortcutFor("Alt + Shift + R") },
          { tool: "rotatedrect", icon: RotatedRectangleIcon, label: "Rotated rectangle" },
          { tool: "path", icon: PathIcon, label: "Path" },
          { tool: "circle", icon: CircleIcon, label: "Circle" },
          { tool: "ellipse", icon: EllipseIcon, label: "Ellipse" },
          { tool: "polyline", icon: PolylineIcon, label: "Polyline" },
          { tool: "triangle", icon: TriangleIcon, label: "Triangle" },
          { tool: "arc", icon: ArcIcon, label: "Arc" },
          { tool: "curve", icon: CurveIcon, label: "Curve" },
          { tool: "doublecurve", icon: DoubleCurveIcon, label: "Double curve" },
        ],
      },
    ],
  },
  {
    id: "text",
    label: "Annotation tools",
    sections: [
      {
        title: "Text and notes",
        tools: [
          { tool: "text", icon: TextIcon, label: "Text" },
          { tool: "textnote", icon: NoteIcon, label: "Note" },
          { tool: "pricenote", icon: PriceNoteIcon, label: "Price note" },
          { tool: "pin", icon: PinIcon, label: "Pin" },
          { tool: "table", icon: TableIcon, label: "Table" },
          { tool: "callout", icon: CalloutIcon, label: "Callout" },
          { tool: "comment", icon: CommentIcon, label: "Comment" },
          { tool: "pricelabel", icon: PriceLabelIcon, label: "Price label" },
          { tool: "signpost", icon: SignpostIcon, label: "Signpost" },
          { tool: "flagmark", icon: FlagMarkIcon, label: "Flag mark" },
        ],
      },
      { title: "Content", tools: [{ tool: "image", icon: ImageIcon, label: "Image" }] },
    ],
  },
];

const allTools = (g: ToolGroup) => g.sections.flatMap((s) => s.tools);


const LockOpenIcon: Icon = (p) => <LockIcon open {...p} />;
const EyeOffIcon: Icon = (p) => <EyeIcon off {...p} />;

export interface LeftToolbarProps {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
  cursorMode: CursorMode;
  onCursorMode: (mode: CursorMode) => void;
  magnetMode: MagnetMode;
  onMagnetMode: (m: MagnetMode) => void;
  stayInDrawingMode: boolean;
  onToggleStayInDrawingMode: () => void;
  drawings: DrawingLine[];
  onUpdateDrawing: (d: DrawingLine) => void;
  onClearDrawings: () => void;
  indicatorCount: number;
  onClearIndicators: () => void;
  positionsShown: boolean;
  onTogglePositions: () => void;
  onZoomIn: () => void;
}

// TradingView's cursor group: Cross, Dot, Arrow, Demonstration, then Eraser.
const CURSOR_TOOLS: { mode: CursorMode; icon: ToolMeta["icon"]; label: string }[] = [
  { mode: "cross", icon: CrossIcon, label: "Cross" },
  { mode: "dot", icon: DotIcon, label: "Dot" },
  { mode: "arrow", icon: ArrowCursorIcon, label: "Arrow" },
  { mode: "demonstration", icon: DemonstrationIcon, label: "Demonstration" },
];

/** TradingView's left drawing toolbar: 52px wide, 52x38 cells, flyouts on the chevrons. */
export function LeftToolbar(p: LeftToolbarProps) {
  const [open, setOpen] = useState<string | null>(null);
  // The main button of a group re-arms the last tool used from it.
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({});
  const [, setLastIconKind] = useState<"emoji" | "icon">("emoji");
  const ref = useDismiss<HTMLDivElement>(open !== null, () => setOpen(null));

  const pick = (group: string, tool: DrawingTool) => {
    setLastUsed((m) => ({ ...m, [group]: tool }));
    p.onDrawingTool(tool);
    setOpen(null);
  };

  const allLocked = p.drawings.length > 0 && p.drawings.every((d) => d.locked);
  const allHidden = p.drawings.length > 0 && p.drawings.every((d) => d.hidden);
  const setAll = (patch: Partial<DrawingLine>) => {
    for (const d of p.drawings) p.onUpdateDrawing({ ...d, ...patch });
  };
  const nDrawings = p.drawings.length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <div ref={ref} className="flex h-full w-[52px] flex-col items-center overflow-visible py-1.5">
      {GROUPS.flatMap((g) => {
        if (g.id === "cursors") {
          const cursor = CURSOR_TOOLS.find((c) => c.mode === p.cursorMode) ?? CURSOR_TOOLS[0]!;
          const erasing = p.drawingTool === "eraser";
          return [
            <ToolCell
              key={g.id}
              title={erasing ? "Eraser" : cursor.label}
              icon={erasing ? EraserIcon : cursor.icon}
              active={p.drawingTool === "none" || erasing}
              onClick={() => (erasing ? undefined : p.onCursorMode(cursor.mode))}
              onChevron={() => setOpen(open === g.id ? null : g.id)}
              chevronLabel={g.label}
              menuOpen={open === g.id}
            >
              {CURSOR_TOOLS.map((c) => (
                <MenuItem
                  key={c.mode}
                  icon={<c.icon className="h-[28px] w-[28px]" />}
                  selected={!erasing && p.cursorMode === c.mode}
                  onClick={() => {
                    p.onCursorMode(c.mode);
                    setOpen(null);
                  }}
                >
                  {c.label}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem
                icon={<EraserIcon className="h-[28px] w-[28px]" />}
                selected={erasing}
                onClick={() => pick(g.id, "eraser")}
              >
                Eraser
              </MenuItem>
            </ToolCell>,
          ];
        }
        const tools = allTools(g);
        const activeHere = tools.find((t) => t.tool === p.drawingTool);
        const shown = activeHere ?? tools.find((t) => t.tool === lastUsed[g.id]) ?? tools[0]!;
        const isActive = Boolean(activeHere);
        const cell = (
          <ToolCell
            key={g.id}
            title={shown.tip ?? shown.label}
            icon={shown.icon}
            active={isActive}
            onClick={() => pick(g.id, shown.tool)}
            onChevron={() => setOpen(open === g.id ? null : g.id)}
            chevronLabel={g.label}
            menuOpen={open === g.id}
          >
            {g.sections.map((s, i) => (
              <div key={s.title || i}>
                {i > 0 && <MenuDivider />}
                {s.title && <MenuTitle>{s.title}</MenuTitle>}
                {s.tools.map((t) => (
                  <MenuItem
                    key={t.tool}
                    icon={<t.icon className="h-[28px] w-[28px]" />}
                    hint={t.shortcut}
                    selected={p.drawingTool === t.tool && t.tool !== "none"}
                    onClick={() => pick(g.id, t.tool)}
                  >
                    {t.label}
                  </MenuItem>
                ))}
              </div>
            ))}
          </ToolCell>
        );
        if (g.id !== "text") return [cell];
        // TradingView shows the Icons/Emoji group as the emoji icon button.
        const Shown: Icon = () => <SmileIcon className="h-[28px] w-[28px]" />;
        return [
          cell,
          <ToolCell
            key="icons"
            title="Icon"
            icon={Shown}
            active={open === "icons"}
            onClick={() => setOpen(open === "icons" ? null : "icons")}
            onChevron={() => setOpen(open === "icons" ? null : "icons")}
            chevronLabel="Icons"
            menuOpen={open === "icons"}
          >
            <IconsPicker
              onPick={(kind) => {
                setLastIconKind(kind);
                p.onDrawingTool(kind);
                setOpen(null);
              }}
            />
          </ToolCell>,
        ];
      })}

      <Divider />

      <ToolCell
        // TradingView's tooltip: "Measure" with the hotkey "⇧ + Click on the chart".
        title="Measure (⇧ + Click on the chart)"
        icon={RulerIcon}
        active={p.drawingTool === "measure"}
        onClick={() => p.onDrawingTool(p.drawingTool === "measure" ? "none" : "measure")}
      />
      <ToolCell title="Zoom in" icon={ZoomInIcon} onClick={p.onZoomIn} />

      <Divider />

      <ToolCell
        title="Magnet mode snaps drawings placed near price bars to the closest OHLC value"
        icon={MagnetIcon}
        active={p.magnetMode !== "none"}
        onClick={() => p.onMagnetMode(p.magnetMode === "none" ? "weak" : "none")}
        onChevron={() => setOpen(open === "magnet" ? null : "magnet")}
        chevronLabel="Magnets"
        menuOpen={open === "magnet"}
      >
        <MenuItem selected={p.magnetMode === "weak"} onClick={() => { p.onMagnetMode("weak"); setOpen(null); }}>
          Weak magnet
        </MenuItem>
        <MenuItem selected={p.magnetMode === "strong"} onClick={() => { p.onMagnetMode("strong"); setOpen(null); }}>
          Strong magnet
        </MenuItem>
      </ToolCell>
      <ToolCell
        title="Keep drawing"
        icon={KeepDrawingIcon}
        active={p.stayInDrawingMode}
        onClick={p.onToggleStayInDrawingMode}
      />
      <ToolCell
        title={allLocked ? "Unlock drawings and indicators" : "Lock drawings and indicators"}
        icon={allLocked ? LockIcon : LockOpenIcon}
        active={allLocked}
        onClick={() => setAll({ locked: !allLocked })}
      />
      <ToolCell
        title={allHidden ? "Show all drawings" : "Hide all drawings"}
        icon={allHidden ? EyeOffIcon : EyeIcon}
        active={allHidden || !p.positionsShown}
        onClick={() => setAll({ hidden: !allHidden })}
        onChevron={() => setOpen(open === "hide" ? null : "hide")}
        chevronLabel="Hide options"
        menuOpen={open === "hide"}
      >
        <MenuItem disabled={nDrawings === 0} onClick={() => { setAll({ hidden: !allHidden }); setOpen(null); }}>
          {allHidden ? "Show drawings" : "Hide drawings"}
        </MenuItem>
        <MenuItem onClick={() => { p.onTogglePositions(); setOpen(null); }}>
          {p.positionsShown ? "Hide positions and orders" : "Show positions and orders"}
        </MenuItem>
      </ToolCell>

      <Divider />

      <ToolCell
        title="Remove objects"
        icon={TrashIcon}
        onClick={() => setOpen(open === "remove" ? null : "remove")}
        onChevron={() => setOpen(open === "remove" ? null : "remove")}
        chevronLabel="Remove options"
        menuOpen={open === "remove"}
      >
        <MenuItem disabled={nDrawings === 0} onClick={() => { p.onClearDrawings(); setOpen(null); }}>
          Remove {plural(nDrawings, "drawing")}
        </MenuItem>
        <MenuItem disabled={p.indicatorCount === 0} onClick={() => { p.onClearIndicators(); setOpen(null); }}>
          Remove {plural(p.indicatorCount, "indicator")}
        </MenuItem>
        <MenuItem
          disabled={nDrawings === 0 && p.indicatorCount === 0}
          onClick={() => {
            p.onClearDrawings();
            p.onClearIndicators();
            setOpen(null);
          }}
        >
          Remove {plural(nDrawings, "drawing")} & {plural(p.indicatorCount, "indicator")}
        </MenuItem>
      </ToolCell>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="my-1.5 h-px w-[34px] shrink-0 bg-border" />;
}

function ToolCell({
  title,
  icon: Icon,
  active,
  disabled,
  onClick,
  onChevron,
  chevronLabel,
  menuOpen,
  children,
}: {
  title: string;
  icon: Icon;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onChevron?: () => void;
  chevronLabel?: string;
  menuOpen?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="group relative flex h-[38px] w-[52px] shrink-0 items-center justify-center">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={active || undefined}
        disabled={disabled}
        onClick={onClick}
        // The whole 52 × 38 cell is the button on TradingView.
        className="group/tool flex h-[38px] w-[52px] items-center justify-center text-foreground disabled:opacity-40"
      >
        <span
          className={cn(
            "flex h-[34px] w-[34px] items-center justify-center rounded transition-colors",
            active ? "bg-secondary" : "group-hover/tool:bg-secondary",
          )}
        >
          <Icon className="h-[28px] w-[28px]" />
        </span>
      </button>
      {onChevron && (
        <button
          type="button"
          title={chevronLabel}
          aria-label={chevronLabel}
          aria-expanded={menuOpen}
          onClick={onChevron}
          className={cn(
            "absolute right-0 top-[2px] z-10 flex h-[34px] w-[11px] items-center justify-center rounded-sm text-muted-foreground transition-opacity",
            menuOpen ? "bg-secondary opacity-100" : "opacity-0 hover:bg-secondary group-hover:opacity-100",
          )}
        >
          <svg viewBox="0 0 4 8" className="h-2 w-1" fill="currentColor" aria-hidden="true">
            <path d="M0 0l4 4-4 4z" />
          </svg>
        </button>
      )}
      {menuOpen && children && (
        <div className="absolute left-full top-0 z-50 ml-1 min-w-[240px] rounded-md border border-border bg-popover py-1.5 text-[14px] shadow-[0_2px_12px_rgba(0,0,0,0.2)]">
          {children}
        </div>
      )}
    </div>
  );
}
