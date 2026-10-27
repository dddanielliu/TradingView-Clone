import { flipPattern, mirrorPattern } from "../../lib/chart-plugins/drawing-tools/barspattern.ts";
import {
  Bell,
  ChevronsDown,
  ChevronsUp,
  Copy,
  GripVertical,
  Lock,
  LockOpen,
  type LucideIcon,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useDragOffset } from "../../hooks/useDragOffset.ts";
import { FIB_EXT_LEVELS, FIB_LEVELS } from "../../lib/chart-plugins/drawing-tools/resolve.ts";
import { cn } from "../../lib/utils.ts";
import {
  DRAWING_WIDTHS,
  type DrawingLine,
  type DrawingLineStyle,
} from "./constants.ts";
import {
  type DrawingTemplate,
  getTemplates,
  saveTemplate,
  setTypeDefault,
} from "./drawingStyles.ts";

// ── Floating toolbar (TradingView-style) shown while a drawing is selected ──

export interface DrawingToolbarProps {
  drawing: DrawingLine;
  onUpdate: (d: DrawingLine) => void;
  onClone: () => void;
  onRemove: () => void;
  onOpenSettings: () => void;
}

const LINE_STYLES: Array<{ style: DrawingLineStyle; dash: string }> = [
  { style: "solid", dash: "" },
  { style: "dashed", dash: "6 4" },
  { style: "dotted", dash: "2 3" },
];

function WidthButtons({ current, onPick }: { current: number; onPick: (w: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {DRAWING_WIDTHS.map((w) => (
        <button
          key={w}
          type="button"
          title={`${w}px`}
          onClick={() => onPick(w)}
          className={cn(
            "px-1.5 py-1.5 rounded hover:bg-secondary",
            current === w ? "bg-primary/15 text-primary" : "text-muted-foreground",
          )}
        >
          <span className="block w-4 rounded-full bg-current" style={{ height: w }} />
        </button>
      ))}
    </div>
  );
}

function LineStyleButtons({
  current,
  onPick,
}: {
  current: DrawingLineStyle;
  onPick: (s: DrawingLineStyle) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {LINE_STYLES.map(({ style, dash }) => (
        <button
          key={style}
          type="button"
          title={style}
          onClick={() => onPick(style)}
          className={cn(
            "px-1 py-1.5 rounded hover:bg-secondary",
            current === style ? "bg-primary/15 text-primary" : "text-muted-foreground",
          )}
        >
          <svg width="20" height="4" viewBox="0 0 20 4" aria-hidden="true">
            <line
              x1="1"
              y1="2"
              x2="19"
              y2="2"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={dash || undefined}
            />
          </svg>
        </button>
      ))}
    </div>
  );
}

// ── Settings dialog (double-click a drawing or gear button) ──────────────────

export interface DrawingSettingsProps {
  drawing: DrawingLine;
  /** Current chart timeframe — stamped as createdTf when scoping visibility. */
  currentTf: string;
  onUpdate: (d: DrawingLine) => void;
  onRemove: () => void;
  onClose: () => void;
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ExtendToggles({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  return (
    <SettingsRow label="Extend">
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-default">
          <input
            type="checkbox"
            checked={drawing.extendLeft ?? false}
            onChange={(e) => patch({ extendLeft: e.target.checked })}
          />
          Left
        </label>
        <label className="flex items-center gap-1.5 cursor-default">
          <input
            type="checkbox"
            checked={drawing.extendRight ?? false}
            onChange={(e) => patch({ extendRight: e.target.checked })}
          />
          Right
        </label>
      </div>
    </SettingsRow>
  );
}

const FILLABLE = new Set(["rectangle", "ellipse", "triangle", "channel"]);

function FillControls({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  return (
    <SettingsRow label="Fill">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={drawing.fillColor ?? drawing.color}
          onChange={(e) => patch({ fillColor: e.target.value })}
          className="h-6 w-8 cursor-default bg-transparent border-0 p-0"
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={drawing.fillOpacity ?? 0.14}
          onChange={(e) => patch({ fillOpacity: Number.parseFloat(e.target.value) })}
          className="w-20"
        />
      </div>
    </SettingsRow>
  );
}

function ArrowheadToggles({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  return (
    <SettingsRow label="Arrows">
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-default">
          <input
            type="checkbox"
            checked={drawing.arrowStart ?? false}
            onChange={(e) => patch({ arrowStart: e.target.checked })}
          />
          Start
        </label>
        <label className="flex items-center gap-1.5 cursor-default">
          <input
            type="checkbox"
            checked={drawing.arrowEnd ?? false}
            onChange={(e) => patch({ arrowEnd: e.target.checked })}
          />
          End
        </label>
      </div>
    </SettingsRow>
  );
}

// Comma-separated custom fibonacci levels (commits on blur).
function FibLevelsRow({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  const defaults = drawing.type === "fibextension" ? FIB_EXT_LEVELS : FIB_LEVELS;
  const current = drawing.fibLevels ?? [...defaults];
  return (
    <SettingsRow label="Levels">
      <input
        type="text"
        defaultValue={current.join(", ")}
        onBlur={(e) => {
          const levels = e.target.value
            .split(",")
            .map((s) => Number.parseFloat(s.trim()))
            .filter((n) => Number.isFinite(n));
          if (levels.length > 0) patch({ fibLevels: levels });
        }}
        className="bg-secondary text-xs rounded px-1.5 py-1 border border-border w-36"
      />
    </SettingsRow>
  );
}

function NumRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <SettingsRow label={label}>
      <input
        type="number"
        step="any"
        value={value != null && Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="bg-secondary text-xs rounded px-1.5 py-1 border border-border w-28 text-right"
      />
    </SettingsRow>
  );
}

// Precise numeric coordinate entry (TradingView "Coordinates" tab).
function CoordinateInputs({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  const isPos = drawing.type === "position";
  return (
    <>
      <NumRow
        label={isPos ? "Entry" : "Price"}
        value={drawing.price}
        onChange={(price) => patch({ price })}
      />
      {drawing.price2 != null && !isPos && (
        <NumRow label="Price 2" value={drawing.price2} onChange={(price2) => patch({ price2 })} />
      )}
      {isPos && (
        <NumRow
          label="Stop"
          value={drawing.stopPrice}
          onChange={(stopPrice) => patch({ stopPrice })}
        />
      )}
      {isPos && (
        <NumRow
          label="Target"
          value={drawing.targetPrice}
          onChange={(targetPrice) => patch({ targetPrice })}
        />
      )}
      {isPos && (
        <NumRow
          label="Risk %"
          value={drawing.riskPct ?? 1}
          onChange={(riskPct) => patch({ riskPct })}
        />
      )}
    </>
  );
}

const FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

function TextFormatBar({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  const toggle =
    "h-7 w-7 rounded border border-border flex items-center justify-center text-sm hover:bg-secondary";
  const on = "bg-primary/20 text-primary border-primary/40";
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={drawing.color}
        onChange={(e) => patch({ color: e.target.value })}
        title="Text color"
        className="h-7 w-9 cursor-default rounded bg-transparent border border-border p-0.5"
      />
      <select
        value={drawing.fontSize ?? 14}
        onChange={(e) => patch({ fontSize: Number.parseInt(e.target.value, 10) })}
        className="h-7 rounded border border-border bg-secondary px-1.5 text-xs"
        title="Font size"
      >
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="button"
        title="Bold"
        onClick={() => patch({ bold: !drawing.bold })}
        className={cn(toggle, "font-bold", drawing.bold && on)}
      >
        B
      </button>
      <button
        type="button"
        title="Italic"
        onClick={() => patch({ italic: !drawing.italic })}
        className={cn(toggle, "italic font-serif", drawing.italic && on)}
      >
        I
      </button>
    </div>
  );
}

function TextToggleRow({
  label,
  enabled,
  color,
  fallback,
  onToggle,
  onColor,
}: {
  label: string;
  enabled: boolean;
  color: string;
  fallback: string;
  onToggle: (v: boolean) => void;
  onColor: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex flex-1 items-center gap-2 text-xs cursor-default">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      <input
        type="color"
        value={color || fallback}
        onChange={(e) => onColor(e.target.value)}
        className="h-6 w-8 cursor-default rounded bg-transparent border border-border p-0.5"
      />
    </div>
  );
}

// TradingView-style text editor: large multi-line input plus rich styling.
function TextSettings({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  return (
    <div className="space-y-2.5">
      <TextFormatBar drawing={drawing} patch={patch} />
      <textarea
        value={drawing.text ?? ""}
        onChange={(e) => patch({ text: e.target.value })}
        placeholder="Text"
        rows={5}
        style={{
          fontWeight: drawing.bold ? 700 : 400,
          fontStyle: drawing.italic ? "italic" : "normal",
        }}
        className="min-h-[120px] w-full resize-y rounded-md border border-border bg-secondary px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <TextToggleRow
        label="Background"
        enabled={Boolean(drawing.textBg)}
        color={drawing.textBgColor ?? ""}
        fallback="#1e222d"
        onToggle={(textBg) => patch({ textBg })}
        onColor={(textBgColor) => patch({ textBgColor, textBg: true })}
      />
      <TextToggleRow
        label="Border"
        enabled={Boolean(drawing.textBorder)}
        color={drawing.textBorderColor ?? ""}
        fallback={drawing.color}
        onToggle={(textBorder) => patch({ textBorder })}
        onColor={(textBorderColor) => patch({ textBorderColor, textBorder: true })}
      />
    </div>
  );
}

// Line/shape style controls (everything except text drawings).
function LineStyleSection({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  return (
    <>
      <SettingsRow label="Color">
        <input
          type="color"
          value={drawing.color}
          onChange={(e) => patch({ color: e.target.value })}
          className="h-6 w-10 cursor-default bg-transparent border-0 p-0"
        />
      </SettingsRow>
      <SettingsRow label="Width">
        <WidthButtons current={drawing.width ?? 2} onPick={(width) => patch({ width })} />
      </SettingsRow>
      <SettingsRow label="Style">
        <LineStyleButtons
          current={drawing.lineStyle ?? "solid"}
          onPick={(lineStyle) => patch({ lineStyle })}
        />
      </SettingsRow>
      {drawing.type === "trendline" && <ExtendToggles drawing={drawing} patch={patch} />}
      {(drawing.type === "gannbox" || drawing.type === "fibspeedfan" || drawing.type === "gannsquare") && (
        <SettingsRow label="">
          <label className="flex items-center gap-1.5 text-xs cursor-default">
            <input type="checkbox" checked={drawing.reverse ?? false} onChange={(e) => patch({ reverse: e.target.checked })} />
            Reverse
          </label>
        </SettingsRow>
      )}
      {drawing.type === "barspattern" && (
        <>
          <SettingsRow label="Mode">
            <select
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              value={drawing.barsMode ?? "bars"}
              onChange={(e) => patch({ barsMode: e.target.value as NonNullable<DrawingLine["barsMode"]> })}
            >
              <option value="bars">HL Bars</option>
              <option value="openclose">OC Bars</option>
              <option value="line">Line - close</option>
              <option value="lineopen">Line - open</option>
              <option value="linehigh">Line - high</option>
              <option value="linelow">Line - low</option>
              <option value="linehl2">Line - HL/2</option>
            </select>
          </SettingsRow>
          <SettingsRow label="">
            <label className="flex items-center gap-1.5 text-xs cursor-default">
              <input type="checkbox" checked={drawing.mirrored ?? false} onChange={(e) => patch(mirrorBars(drawing, e.target.checked))} />
              Mirrored
            </label>
            <label className="ml-3 flex items-center gap-1.5 text-xs cursor-default">
              <input type="checkbox" checked={drawing.flipped ?? false} onChange={(e) => patch(flipBars(drawing, e.target.checked))} />
              Flipped
            </label>
          </SettingsRow>
        </>
      )}
      {drawing.type === "fibspiral" && (
        <SettingsRow label="">
          <label className="flex items-center gap-1.5 text-xs cursor-default">
            <input
              type="checkbox"
              checked={drawing.counterclockwise ?? false}
              onChange={(e) => patch({ counterclockwise: e.target.checked })}
            />
            Counterclockwise
          </label>
        </SettingsRow>
      )}
      {(drawing.type === "trendline" || drawing.type === "arrow") && (
        <ArrowheadToggles drawing={drawing} patch={patch} />
      )}
      {FILLABLE.has(drawing.type) && <FillControls drawing={drawing} patch={patch} />}
      {(drawing.type === "fibonacci" || drawing.type === "fibextension") && (
        <FibLevelsRow drawing={drawing} patch={patch} />
      )}
    </>
  );
}

// Save the drawing's look as the per-type default (new drawings inherit it) or
// as a named template that can be re-applied to any drawing.
function StyleTools({
  drawing,
  patch,
}: {
  drawing: DrawingLine;
  patch: (p: Partial<DrawingLine>) => void;
}) {
  const [templates, setTemplates] = useState<DrawingTemplate[]>(() => getTemplates());
  const btn = "px-2 py-1 rounded text-xs bg-secondary hover:bg-secondary/70";
  return (
    <div className="space-y-2 pt-1 border-t border-border/60">
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => setTypeDefault(drawing.type, drawing)}>
          Set as default
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            const name = window.prompt("Template name")?.trim();
            if (name) {
              saveTemplate(name, drawing);
              setTemplates(getTemplates());
            }
          }}
        >
          Save template
        </button>
      </div>
      {templates.length > 0 && (
        <SettingsRow label="Template">
          <select
            value=""
            onChange={(e) => {
              const t = templates.find((x) => x.name === e.target.value);
              if (t) patch(t.style);
            }}
            className="bg-secondary text-xs rounded px-1.5 py-1 border border-border"
          >
            <option value="">Apply…</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </SettingsRow>
      )}
    </div>
  );
}

export function DrawingSettingsDialog({
  drawing,
  currentTf,
  onUpdate,
  onRemove,
  onClose,
}: DrawingSettingsProps) {
  const patch = (p: Partial<DrawingLine>) => onUpdate({ ...drawing, ...p });
  const drag = useDragOffset();
  const isText = drawing.type === "text";
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
      <div
        className={cn(
          "rounded-lg bg-card border border-border shadow-2xl p-3 space-y-3",
          isText ? "w-80" : "w-64",
        )}
        style={drag.style}
      >
        <div
          onPointerDown={drag.onPointerDown}
          className="flex cursor-grab select-none items-center justify-between active:cursor-grabbing"
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold capitalize">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
            {drawing.type} settings
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {isText ? (
          <TextSettings drawing={drawing} patch={patch} />
        ) : (
          <LineStyleSection drawing={drawing} patch={patch} />
        )}

        <div className="pt-1 border-t border-border/60" />
        <CoordinateInputs drawing={drawing} patch={patch} />

        <SettingsRow label="Visibility">
          <select
            value={drawing.visibility === "tf" ? "tf" : "all"}
            onChange={(e) =>
              patch(
                e.target.value === "tf"
                  ? { visibility: "tf", createdTf: drawing.createdTf ?? currentTf }
                  : { visibility: "all" },
              )
            }
            className="bg-secondary text-xs rounded px-1.5 py-1 border border-border"
          >
            <option value="all">All timeframes</option>
            <option value="tf">Only {drawing.createdTf ?? currentTf}</option>
          </select>
        </SettingsRow>

        <StyleTools drawing={drawing} patch={patch} />

        <div className="flex items-center justify-between pt-1 border-t border-border">
          <button
            type="button"
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#f23645] hover:bg-[#f23645]/10"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded text-xs bg-primary text-primary-foreground hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Right-click context menu ─────────────────────────────────────────────────

export interface DrawingContextMenuProps {
  drawing: DrawingLine;
  x: number;
  y: number;
  onClose: () => void;
  onSettings: () => void;
  onDuplicate: () => void;
  onReorder: (dir: "front" | "back") => void;
  onToggleLock: () => void;
  onToggleAlert: () => void;
  onRemove: () => void;
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary text-left",
        danger ? "text-[#f23645]" : "text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function DrawingContextMenu({
  drawing,
  x,
  y,
  onClose,
  onSettings,
  onDuplicate,
  onReorder,
  onToggleLock,
  onToggleAlert,
  onRemove,
}: DrawingContextMenuProps) {
  const canAlert = drawing.type === "horizontal" || drawing.type === "trendline";
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        className="fixed z-40 w-44 rounded-md bg-card border border-border shadow-2xl py-1"
        style={{ left: x, top: y }}
      >
        <MenuItem icon={Settings2} label="Settings" onClick={act(onSettings)} />
        <MenuItem icon={Copy} label="Duplicate" onClick={act(onDuplicate)} />
        <MenuItem
          icon={ChevronsUp}
          label="Bring to front"
          onClick={act(() => onReorder("front"))}
        />
        <MenuItem icon={ChevronsDown} label="Send to back" onClick={act(() => onReorder("back"))} />
        <MenuItem
          icon={drawing.locked ? LockOpen : Lock}
          label={drawing.locked ? "Unlock" : "Lock"}
          onClick={act(onToggleLock)}
        />
        {canAlert && (
          <MenuItem
            icon={Bell}
            label={drawing.alertEnabled ? "Remove alert" : "Add alert"}
            onClick={act(onToggleAlert)}
          />
        )}
        <div className="my-1 border-t border-border/60" />
        <MenuItem icon={Trash2} label="Delete" danger onClick={act(onRemove)} />
      </div>
    </>
  );
}

// Bars pattern Mirror / Flip (TradingView's _mirror / _flip): change the copy
// and swap the two points' prices.
function swapPrices(d: DrawingLine): Partial<DrawingLine> {
  const [p, q] = d.points ?? [];
  if (!p || !q) return {};
  const points = [{ ...p, price: q.price }, { ...q, price: p.price }];
  return { points, price: points[0]!.price, price2: points[1]!.price };
}
function mirrorBars(d: DrawingLine, mirrored: boolean): Partial<DrawingLine> {
  return { mirrored, pattern: d.pattern && mirrorPattern(d.pattern), ...swapPrices(d) };
}
function flipBars(d: DrawingLine, flipped: boolean): Partial<DrawingLine> {
  return { flipped, pattern: d.pattern && flipPattern(d.pattern), ...swapPrices(d) };
}
