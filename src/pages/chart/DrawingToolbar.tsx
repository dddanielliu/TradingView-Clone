import { AlarmClockPlus, Ellipsis, LayoutTemplate, Lock, LockOpen, Settings } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { DrawingLine, DrawingLineStyle } from "../trading/constants.ts";
import { TrashIcon } from "./icons.tsx";
import { notAvailable } from "./notAvailable.ts";
import { MenuItem, Popover } from "./ui.tsx";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Converts a Windows-style shortcut ("Ctrl + D") to Mac glyphs ("⌘ D"). */
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

/**
 * The floating toolbar over a selected drawing, in TradingView's order:
 * grip · templates │ line colour · background colour · text colour · width ·
 * style │ settings · alert · lock · remove · more.
 *
 * Each property is one button that opens its own popup, as there.
 */

/** Ten columns: greys, base hues, then lighter and darker steps of each hue. */
const BASE = ["#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#673ab7", "#9c27b0", "#e91e63"];
const GREYS = ["#ffffff", "#d1d4dc", "#b2b5be", "#9598a1", "#787b86", "#5d606b", "#434651", "#2a2e39", "#131722", "#000000"];

function mix(hex: string, with_: string, amount: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  const b = p(with_);
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

const PALETTE: string[][] = [
  GREYS,
  BASE,
  BASE.map((c) => mix(c, "#ffffff", 0.75)),
  BASE.map((c) => mix(c, "#ffffff", 0.55)),
  BASE.map((c) => mix(c, "#ffffff", 0.3)),
  BASE.map((c) => mix(c, "#000000", 0.2)),
  BASE.map((c) => mix(c, "#000000", 0.4)),
  BASE.map((c) => mix(c, "#000000", 0.6)),
];

const WIDTHS = [1, 2, 3, 4];
const STYLES: { style: DrawingLineStyle; label: string; dash?: string }[] = [
  { style: "solid", label: "Line" },
  { style: "dashed", label: "Dashed line", dash: "5 4" },
  { style: "dotted", label: "Dotted line", dash: "1.5 3" },
];

const FILLABLE = new Set(["rectangle", "ellipse", "triangle", "channel", "xabcd", "cypher", "headshoulders", "trianglepattern"]);
const ALERTABLE = new Set(["horizontal", "trendline"]);
/** Line tools that also carry a text label get a text-colour button, as on TradingView. */
const TEXT_COLORED = new Set(["trendline", "horizontal", "vertical", "rectangle"]);

type Popup = "line" | "fill" | "text" | "width" | "style" | "more" | null;

export function DrawingToolbar({
  drawing,
  onUpdate,
  onClone,
  onRemove,
  onOpenSettings,
}: {
  drawing: DrawingLine;
  onUpdate: (d: DrawingLine) => void;
  onClone: () => void;
  onRemove: () => void;
  onOpenSettings: () => void;
}) {
  const [popup, setPopup] = useState<Popup>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const patch = (p: Partial<DrawingLine>) => onUpdate({ ...drawing, ...p });
  const toggle = (p: Exclude<Popup, null>) => setPopup((cur) => (cur === p ? null : p));
  const close = () => setPopup(null);
  const isText = drawing.type === "text";
  const width = drawing.width ?? 2;

  return (
    <div
      role="toolbar"
      aria-label="Drawing toolbar"
      // TradingView opens it at the chart's top-right, 11px down and 16px in.
      className="absolute right-4 top-[11px] z-20 flex h-[38px] items-center rounded-md border border-border bg-popover px-[3px] text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <span
        title="Drag the toolbar"
        className="flex h-[32px] w-[14px] cursor-grab items-center justify-center text-muted-foreground"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <svg viewBox="0 0 6 16" className="h-4 w-1.5" fill="currentColor" aria-hidden="true">
          {[2, 6, 10, 14].flatMap((y) => [<circle key={`a${y}`} cx="1.5" cy={y} r="1" />, <circle key={`b${y}`} cx="4.5" cy={y} r="1" />])}
        </svg>
      </span>
      <Btn title="Templates" onClick={() => notAvailable("Drawing templates")}>
        <LayoutTemplate className="h-[20px] w-[20px]" strokeWidth={1.25} />
      </Btn>
      <Sep />

      {!isText && (
        <ColorButton
          title="Line tool colors"
          glyph={<PencilGlyph />}
          color={drawing.color}
          open={popup === "line"}
          onToggle={() => toggle("line")}
          onClose={close}
          onPick={(color) => patch({ color })}
        />
      )}
      {FILLABLE.has(drawing.type) && (
        <ColorButton
          title="Line tool background color"
          glyph={<BucketGlyph />}
          color={drawing.fillColor ?? drawing.color}
          open={popup === "fill"}
          onToggle={() => toggle("fill")}
          onClose={close}
          onPick={(fillColor) => patch({ fillColor })}
        />
      )}
      {(isText || TEXT_COLORED.has(drawing.type)) && (
        <ColorButton
          title="Text color"
          glyph={<span className="text-[15px] leading-none">T</span>}
          color={drawing.textColor ?? drawing.color}
          open={popup === "text"}
          onToggle={() => toggle("text")}
          onClose={close}
          onPick={(c) => patch(isText ? { color: c } : { textColor: c })}
        />
      )}
      {!isText && (
        <Popover
          open={popup === "width"}
          className="min-w-0"
          onClose={close}
          trigger={
            <Btn title="Line tool width" active={popup === "width"} onClick={() => toggle("width")} wide>
              <span className="block w-[14px] rounded-full bg-current" style={{ height: Math.max(1, width) }} />
              <span className="text-[13px]">{width}px</span>
            </Btn>
          }
        >
          {WIDTHS.map((w) => (
            <MenuItem key={w} selected={w === width} onClick={() => { patch({ width: w }); close(); }}>
              <span className="flex items-center gap-3 pr-2">
                <span className="block w-[16px] rounded-full bg-current" style={{ height: w }} />
                {w}px
              </span>
            </MenuItem>
          ))}
        </Popover>
      )}
      {!isText && (
        <Popover
          open={popup === "style"}
          onClose={close}
          trigger={
            <Btn title="Style" active={popup === "style"} onClick={() => toggle("style")}>
              <StyleGlyph dash={STYLES.find((s) => s.style === (drawing.lineStyle ?? "solid"))?.dash} />
            </Btn>
          }
        >
          {STYLES.map((s) => (
            <MenuItem key={s.style} selected={(drawing.lineStyle ?? "solid") === s.style} onClick={() => { patch({ lineStyle: s.style }); close(); }}>
              <span className="flex items-center gap-3">
                <StyleGlyph dash={s.dash} />
                {s.label}
              </span>
            </MenuItem>
          ))}
        </Popover>
      )}
      <Sep />

      <Btn title="Settings" onClick={onOpenSettings}>
        <Settings className="h-[20px] w-[20px]" strokeWidth={1.25} />
      </Btn>
      <Btn
        title={ALERTABLE.has(drawing.type) ? (drawing.alertEnabled ? "Remove alert" : "Add alert") : "Add alert"}
        active={drawing.alertEnabled}
        onClick={() =>
          ALERTABLE.has(drawing.type) ? patch({ alertEnabled: !drawing.alertEnabled }) : notAvailable("Alerts on this drawing")
        }
      >
        <AlarmClockPlus className="h-[20px] w-[20px]" strokeWidth={1.25} />
      </Btn>
      <Btn title={drawing.locked ? "Unlock" : "Lock"} active={drawing.locked} onClick={() => patch({ locked: !drawing.locked })}>
        {drawing.locked ? <Lock className="h-[20px] w-[20px]" strokeWidth={1.25} /> : <LockOpen className="h-[20px] w-[20px]" strokeWidth={1.25} />}
      </Btn>
      <Btn title="Remove" onClick={onRemove}>
        <TrashIcon className="h-[24px] w-[24px]" />
      </Btn>
      <Popover
        open={popup === "more"}
        onClose={close}
        align="right"
        trigger={
          <Btn title="More" active={popup === "more"} onClick={() => toggle("more")}>
            <Ellipsis className="h-[20px] w-[20px]" strokeWidth={1.25} />
          </Btn>
        }
      >
        <MenuItem hint={shortcutFor("Ctrl + D")} onClick={() => { onClone(); close(); }}>Clone</MenuItem>
        <MenuItem onClick={() => { close(); notAvailable("Copying drawings to other charts"); }}>Copy</MenuItem>
        <MenuItem onClick={() => { close(); notAvailable("Drawing visual order"); }}>Visual order</MenuItem>
        <MenuItem onClick={() => { close(); notAvailable("Drawing visibility on intervals"); }}>Visibility on intervals</MenuItem>
        <MenuItem onClick={() => { patch({ hidden: true }); close(); }}>Hide</MenuItem>
      </Popover>
    </div>
  );
}

function Btn({
  title,
  active,
  wide,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  wide?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "flex h-[32px] items-center justify-center gap-1.5 rounded",
        wide ? "px-2" : "w-[32px]",
        active ? "bg-secondary" : "hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden="true" className="mx-[3px] h-[22px] w-px bg-border" />;
}

function ColorButton({
  title,
  glyph,
  color,
  open,
  onToggle,
  onClose,
  onPick,
}: {
  title: string;
  glyph: ReactNode;
  color: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPick: (c: string) => void;
}) {
  return (
    <Popover
      open={open}
      onClose={onClose}
      trigger={
        <Btn title={title} active={open} onClick={onToggle}>
          <span className="flex flex-col items-center">
            {glyph}
            <span className="mt-[2px] h-[3px] w-[18px] rounded-sm" style={{ background: color }} />
          </span>
        </Btn>
      }
    >
      <div className="p-3">
        <div className="grid grid-cols-10 gap-[3px]">
          {PALETTE.flat().map((c, i) => (
            <button
              key={`${c}-${i}`}
              type="button"
              title={c}
              onClick={() => {
                onPick(c);
                onClose();
              }}
              className={cn(
                "h-[20px] w-[20px] rounded-[3px] border border-black/10",
                c.toLowerCase() === color.toLowerCase() && "ring-2 ring-primary ring-offset-1 ring-offset-popover",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          Custom
          <input type="color" value={color.length === 7 ? color : "#2962ff"} onChange={(e) => onPick(e.target.value)} className="h-6 w-8 cursor-default border-0 bg-transparent p-0" />
        </label>
      </div>
    </Popover>
  );
}

function PencilGlyph() {
  return (
    <svg viewBox="0 0 20 16" className="h-[15px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M4 14l1-4 8.5-8.5 3 3L8 13z M11.8 3.2l3 3" />
    </svg>
  );
}

function BucketGlyph() {
  return (
    <svg viewBox="0 0 20 16" className="h-[15px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
      <path d="M3 8l6-6 6 6-6 6z M9 2V0.5 M16.5 10.5c0 1.2-.7 2-1.5 2s-1.5-.8-1.5-2 1.5-3 1.5-3 1.5 1.8 1.5 3z" />
    </svg>
  );
}

function StyleGlyph({ dash }: { dash?: string }) {
  return (
    <svg viewBox="0 0 22 4" className="h-[4px] w-[22px]" aria-hidden="true">
      <line x1="1" y1="2" x2="21" y2="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}
