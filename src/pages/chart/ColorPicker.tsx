import { useEffect, useRef, useState } from "react";
import { safeStorage } from "../../lib/safe-storage.ts";
import { cn } from "../../lib/utils.ts";
import { baseHex } from "./colors.ts";

/**
 * TradingView's colour picker (ColorPicker / Opacity / the custom colour
 * editor), as in its source: a 224px column (6px 12px padding) of 17px
 * swatches on a 23px pitch — the basic rows (white, the greys, black; then
 * the ten 500 colours), the six shade rows (100, 200, 300, 400, 700, 900) —
 * a separator, the saved custom colours ending in "+", and the Opacity
 * slider with its percent field. A swatch picks the colour; "+" swaps the
 * panel for the custom editor (saturation box, hue strip, hex field, Add).
 * Custom colours are kept (the newest 29), and a right-click removes one.
 */

const BASIC = [
  ["#ffffff", "#dbdbdb", "#b8b8b8", "#9c9c9c", "#808080", "#636363", "#464646", "#1a1a1a", "#000000", "#000000"],
  ["#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#673ab7", "#9c27b0", "#e91e63"],
];

const EXTENDED = [
  ["#fccbcd", "#ffe0b2", "#fff9c4", "#c8e6c9", "#ace5dc", "#b2ebf2", "#bbd9fb", "#d1c4e9", "#e1bee7", "#f8bbd0"],
  ["#faa1a4", "#ffcc80", "#fff59d", "#a5d6a7", "#70ccbd", "#80deea", "#90bff9", "#b39ddb", "#ce93d8", "#f48fb1"],
  ["#f77c80", "#ffb74d", "#fff176", "#81c784", "#42bda8", "#4dd0e1", "#5b9cf6", "#9575cd", "#ba68c8", "#f06292"],
  ["#f7525f", "#ffa726", "#ffee58", "#66bb6a", "#22ab94", "#26c6da", "#3179f5", "#7e57c2", "#ab47bc", "#ec407a"],
  ["#b22833", "#f57c00", "#fbc02d", "#388e3c", "#056656", "#0097a7", "#1848cc", "#512da8", "#7b1fa2", "#c2185b"],
  ["#801922", "#e65100", "#f57f17", "#1b5e20", "#00332a", "#006064", "#0c3299", "#311b92", "#4a148c", "#880e4f"],
];

const CUSTOM_KEY = "pickerCustomColors";
const CUSTOM_EVENT = "tv-picker-custom-colors";
const MAX_CUSTOM = 29;

function readCustom(): string[] {
  try {
    const v: unknown = JSON.parse(safeStorage.getItem(CUSTOM_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

function writeCustom(next: string[]): void {
  safeStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CUSTOM_EVENT));
}

/** useCustomColors: the saved list, appended to (the oldest dropped past 29, duplicates skipped). */
function useCustomColors(): [string[], (c: string) => void, (i: number) => void] {
  const [colors, setColors] = useState(readCustom);
  useEffect(() => {
    const sync = () => setColors(readCustom());
    window.addEventListener(CUSTOM_EVENT, sync);
    return () => window.removeEventListener(CUSTOM_EVENT, sync);
  }, []);
  const add = (c: string) => {
    const list = readCustom();
    if (list.some((x) => sameRgb(x, c))) return;
    const next = [...list, c];
    if (next.length > MAX_CUSTOM) next.shift();
    writeCustom(next);
  };
  const remove = (i: number) => writeCustom(readCustom().filter((_, k) => k !== i));
  return [colors, add, remove];
}

function sameRgb(a: string, b: string): boolean {
  return baseHex(a) === baseHex(b);
}

type Hsv = { h: number; s: number; v: number };

/** TradingView's rgb → hsv (R). */
function toHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return { h: 0, s: 0, v: 0 };
  const r = parseInt(m[1]!, 16) / 255;
  const g = parseInt(m[2]!, 16) / 255;
  const b = parseInt(m[3]!, 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** TradingView's hsv → "#rrggbb". */
function fromHsv({ h, s, v }: Hsv): string {
  const i = Math.floor(6 * h);
  const f = 6 * h - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6] ?? [0, 0, 0];
  return `#${[r, g, b].map((x = 0) => Math.round(255 * x).toString(16).padStart(2, "0")).join("")}`;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** A drag on an element: the pointer's fraction across / down it, live. */
function dragFraction(e: React.MouseEvent<HTMLElement>, onMove: (fx: number, fy: number) => void) {
  const el = e.currentTarget;
  const at = (ev: MouseEvent | React.MouseEvent) => {
    const r = el.getBoundingClientRect();
    onMove(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
  };
  at(e);
  const move = (ev: MouseEvent) => at(ev);
  const up = (ev: MouseEvent) => {
    at(ev);
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function Swatch({
  color,
  selected,
  onSelect,
  onRemove,
}: {
  color: string;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const white = color.toLowerCase() === "#ffffff";
  return (
    <span className="relative">
      <button
        type="button"
        data-role="swatch"
        title={color}
        onClick={onSelect}
        onContextMenu={
          onRemove
            ? (e) => {
                e.preventDefault();
                setMenu((v) => !v);
              }
            : undefined
        }
        // 15px + a 1px border in the colour (white: #dbdbdb), 2px corners,
        // 3px margins; hover / selection draw a 2px ring 3px outside.
        className={cn(
          "group relative m-[3px] block h-[17px] w-[17px] rounded-[2px] border",
          "after:absolute after:-left-[5px] after:-top-[5px] after:box-content after:h-full after:w-full after:rounded-[6px] after:border-2 after:border-transparent after:p-[3px] after:transition-colors after:duration-[350ms] after:content-['']",
          selected ? "after:z-[1] after:border-foreground" : "hover:after:border-muted-foreground/60",
        )}
        style={{ background: color, borderColor: white ? "#dbdbdb" : color }}
      />
      {menu && onRemove && (
        <span className="absolute left-0 top-[24px] z-10 rounded-[6px] bg-popover py-[6px] shadow-[0_2px_4px_rgba(0,0,0,0.2)]">
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              onRemove();
            }}
            className="flex h-8 items-center whitespace-nowrap px-3 text-[14px] hover:bg-secondary"
          >
            Remove color
          </button>
        </span>
      )}
    </span>
  );
}

function Rows({
  colors,
  current,
  onSelect,
  onRemove,
  children,
}: {
  colors: string[];
  current: string;
  onSelect: (c: string) => void;
  onRemove?: (i: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="-mx-[3px] mb-[6px] flex flex-wrap">
      {colors.map((c, i) => (
        <Swatch
          key={`${c}-${i}`}
          color={c}
          selected={sameRgb(c, current)}
          onSelect={() => onSelect(c)}
          onRemove={onRemove && (() => onRemove(i))}
        />
      ))}
      {children}
    </div>
  );
}

/** Opacity: a 10px slider over a checker pattern, a 12px pointer, and the 0–100 % field. */
function Opacity({ color, opacity, onChange }: { color: string; opacity: number; onChange: (o: number) => void }) {
  // The field shows the opacity, or what is being typed into it.
  const [typed, setInput] = useState<string | null>(null);
  const input = typed ?? String(Math.round(opacity * 100));
  const set = (o: number) => {
    setInput(null);
    onChange(o);
  };
  return (
    <div className="flex items-center">
      <div
        tabIndex={0}
        role="slider"
        aria-label="Opacity"
        aria-valuenow={Math.round(opacity * 100)}
        className="relative h-[10px] flex-1 rounded-[5px] outline-none"
        style={{
          backgroundColor: "#ffffff",
          backgroundImage:
            "linear-gradient(45deg, #d1d4dc 25%, transparent 25%, transparent 75%, #d1d4dc 75%), linear-gradient(45deg, #d1d4dc 25%, transparent 25%, transparent 75%, #d1d4dc 75%)",
          backgroundSize: "8px 8px",
          backgroundPosition: "1px 1px, 5px 5px",
        }}
        onMouseDown={(e) => {
          // TradingView: the pointer's centre follows the mouse; the range is the width less the pointer.
          const el = e.currentTarget;
          const at = (x: number) => {
            const r = el.getBoundingClientRect();
            set(Math.round(100 * clamp01((x - 6 - r.left) / (r.width - 12))) / 100);
          };
          at(e.clientX);
          const move = (ev: MouseEvent) => at(ev.clientX);
          const up = (ev: MouseEvent) => {
            at(ev.clientX);
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
        onKeyDown={(e) => {
          const n = Number(input);
          if (e.key === "ArrowLeft" && n > 0) set((n - 1) / 100);
          else if (e.key === "ArrowRight" && n < 100) set((n + 1) / 100);
          else return;
          e.preventDefault();
        }}
      >
        <div
          className="h-full w-full rounded-[4px] border"
          style={{ color, borderColor: color, backgroundImage: `linear-gradient(90deg, transparent, ${color})` }}
        />
        <div className="absolute left-0 top-0 w-[calc(100%-12px)]">
          <div
            className="absolute -mt-px h-[12px] w-[12px] rounded-full border-2 border-black bg-white shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
            style={{ left: `${opacity * 100}%` }}
          />
        </div>
      </div>
      <div className="relative flex items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setInput(v);
            const n = Number(v) / 100;
            if (!Number.isNaN(n) && n <= 1) onChange(n);
          }}
          onBlur={() => setInput(null)}
          className="ml-2 h-[26px] w-[47px] rounded-[4px] border border-border bg-transparent pl-[5px] pr-[14px] text-right text-[14px] leading-[24px] outline-none focus:border-[#2962ff]"
        />
        <span className="pointer-events-none absolute left-[40px] top-[5px] text-[14px]">%</span>
      </div>
    </div>
  );
}

/** The custom colour editor: swatch, "#" hex field, Add; the 200 × 184 saturation box and the hue strip. */
function CustomEditor({ color, onSelect, onAdd }: { color: string; onSelect: (c: string) => void; onAdd: (c: string) => void }) {
  const start = /^#[0-9a-f]{6}/i.test(color) ? baseHex(color) : "#000000";
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(start));
  const [current, setCurrent] = useState(start);
  const [input, setInput] = useState(start.slice(1));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const applyHsv = (next: Hsv) => {
    const c = fromHsv(next);
    setHsv(next);
    setCurrent(c);
    setInput(c.slice(1));
    onSelect(c);
  };
  return (
    <div className="w-[248px] px-3 py-[6px]">
      <div className="mb-3 flex">
        <div
          className="h-[26px] w-[26px] rounded-[4px]"
          style={{ background: current, border: current === "#ffffff" ? "1px solid #dbdbdb" : undefined }}
        />
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute top-[5px] w-[21px] text-right text-[14px]">#</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              const t = e.currentTarget.value.replace(/^#/, "");
              setInput(t);
              if (/^[0-9a-f]{6}$/i.test(t)) {
                const c = `#${t.toLowerCase()}`;
                setHsv(toHsv(c));
                setCurrent(c);
                onSelect(c);
              }
            }}
            className="ml-2 h-[26px] w-[68px] rounded-[4px] border border-border bg-transparent pl-3 pr-[5px] text-[14px] leading-[24px] outline-none focus:border-[#2962ff]"
          />
        </div>
        <button
          type="button"
          onClick={() => onAdd(current)}
          className="ml-auto h-[26px] rounded-[4px] bg-[#2962ff] px-3 text-[14px] text-white hover:bg-[#1e53e5]"
        >
          Add
        </button>
      </div>
      <div className="flex h-[184px]">
        <div
          className="relative mr-[7px] h-full w-[200px] overflow-hidden rounded-[2px]"
          style={{ backgroundColor: `hsl(${360 * hsv.h}, 100%, 50%)` }}
          onMouseDown={(e) => dragFraction(e, (fx, fy) => applyHsv({ h: hsv.h, s: fx, v: 1 - fy }))}
        >
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#fff,#fff0)]" />
          <div className="absolute inset-0 bg-[linear-gradient(0deg,#000,#0000)]" />
          <div
            className="absolute z-[1] -ml-[6px] -mt-[6px] h-[10px] w-[10px] rounded-full border-2 border-black shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <div
          className="flex h-full w-[17px] rounded-[2px]"
          style={{ backgroundImage: "linear-gradient(180deg,red 0,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,red)" }}
        >
          <div
            className="relative my-[3px] w-full"
            onMouseDown={(e) => dragFraction(e, (_fx, fy) => applyHsv({ ...hsv, h: fy }))}
          >
            <div
              className="absolute -ml-[2px] -mt-[4px] h-[5px] w-[calc(100%+4px)] rounded-[2px] border-2 border-black shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
              style={{ top: `${hsv.h * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ColorPicker({
  color,
  opacity,
  onColorChange,
  onOpacityChange,
  onClose,
}: {
  /** The current colour ("#rrggbb"). */
  color: string;
  /** 0–1; the Opacity section shows when given. */
  opacity?: number;
  onColorChange: (c: string) => void;
  onOpacityChange?: (o: number) => void;
  /** A swatch pick closes the popup, as on TradingView. */
  onClose: () => void;
}) {
  const [custom, addCustom, removeCustom] = useCustomColors();
  const [editing, setEditing] = useState(false);
  const pick = (c: string) => {
    onColorChange(c);
    onClose();
  };
  if (editing) {
    return (
      <CustomEditor
        color={color}
        onSelect={onColorChange}
        onAdd={(c) => {
          addCustom(c);
          setEditing(false);
        }}
      />
    );
  }
  const plus = (
    <button
      type="button"
      title="Add custom color"
      onClick={() => setEditing(true)}
      className="relative m-[3px] flex h-[17px] w-[17px] items-center justify-center rounded-[2px] transition-colors duration-[350ms] hover:bg-secondary"
    >
      <span className="absolute left-[calc(50%-0.5px)] top-[calc(50%-6.5px)] h-[13px] w-px bg-foreground" />
      <span className="absolute left-[calc(50%-6.5px)] top-[calc(50%-0.5px)] h-px w-[13px] bg-foreground" />
    </button>
  );
  return (
    <div className="w-[248px] px-3 py-[6px] text-foreground">
      <Rows colors={BASIC.flat()} current={color} onSelect={pick} />
      <Rows colors={EXTENDED.flat()} current={color} onSelect={pick} />
      <div className="my-3 h-px bg-border" />
      <Rows colors={custom} current={color} onSelect={pick} onRemove={removeCustom}>
        {plus}
      </Rows>
      {opacity !== undefined && onOpacityChange && (
        <>
          <div className="mb-1 mt-3 text-[12px] leading-[14px] text-muted-foreground">Opacity</div>
          <Opacity color={color} opacity={opacity} onChange={onOpacityChange} />
        </>
      )}
    </div>
  );
}
