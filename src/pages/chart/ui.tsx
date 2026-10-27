import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useDismiss } from "./shared.ts";
import { cn } from "../../lib/utils.ts";

/**
 * Small building blocks shared by the TradingView-style chart page: toolbar
 * buttons, separators, popover menus and a modal shell. Sizes follow the
 * measurements of tradingview.com/chart (38px toolbar rows, 52x38 left-toolbar
 * cells, 44px right-rail cells, 14px text).
 */


export function ToolbarSeparator({ vertical = true }: { vertical?: boolean }) {
  return vertical ? (
    <span aria-hidden="true" className="mx-1 h-[22px] w-px shrink-0 bg-border" />
  ) : (
    <span aria-hidden="true" className="my-1 h-px w-[34px] shrink-0 self-center bg-border" />
  );
}

export function HeaderButton({
  title,
  onClick,
  active,
  pressed,
  disabled,
  children,
  className,
  id,
}: {
  title: string;
  onClick?: () => void;
  /** Highlighted like a selected item. */
  active?: boolean;
  /** Solid, like TradingView's Replay button while replay is on. */
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed || active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // TradingView's header cells: 38px tall, icon-only cells 38px wide.
        "flex h-[38px] min-w-[38px] shrink-0 items-center justify-center px-[3px] text-[14px] text-foreground",
        "disabled:cursor-default disabled:opacity-40",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-[32px] w-full min-w-[32px] items-center justify-center gap-[6px] rounded px-[3px] transition-colors",
          pressed
            ? "bg-tv-active text-tv-active-foreground"
            : active
              ? "bg-secondary"
              : "hover:bg-secondary",
        )}
      >
        {children}
      </span>
    </button>
  );
}

/**
 * A popup menu anchored to its trigger. Like TradingView's, it is laid out in
 * a fixed layer so a scrolling toolbar can never clip it, opens below (or
 * above / beside), stays inside the window, and scrolls when taller than the
 * room it has. Closes on an outside click or Esc.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = "left",
  side = "bottom",
  className,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right" | "center";
  side?: "bottom" | "right" | "top";
  className?: string;
}) {
  const ref = useDismiss<HTMLDivElement>(open, onClose);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    // A closed menu is not rendered, so its last position never shows; it is
    // measured afresh (before paint) every time it opens.
    if (!open) return;
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const w = menu.offsetWidth;
      const h = menu.scrollHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;
      let left: number;
      let top: number;
      if (side === "right") {
        left = anchor.right + 4;
        top = anchor.top;
      } else {
        left = align === "right" ? anchor.right - w : align === "center" ? anchor.left + anchor.width / 2 - w / 2 : anchor.left;
        top = side === "top" ? anchor.top - 4 - Math.min(h, anchor.top - margin) : anchor.bottom + 2;
      }
      left = Math.max(margin, Math.min(left, vw - w - margin));
      const maxHeight = side === "top" ? anchor.top - 4 - margin : vh - top - margin;
      if (side === "right") top = Math.max(margin, Math.min(top, vh - Math.min(h, vh - 2 * margin) - margin));
      setPos({ left, top: Math.max(margin, top), maxHeight: Math.max(120, maxHeight) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, side, align, ref]);

  return (
    <div ref={ref} className="relative flex shrink-0">
      {trigger}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { left: -9999, top: 0 }}
          className={cn(
            // TradingView's menu: no border, 6px radius, 0 2px 4px shadow, 6px 0 padding.
            "tv-scroll fixed z-[60] min-w-[180px] rounded-[6px] bg-popover py-[6px] text-[14px] text-foreground shadow-[0_2px_4px_rgba(0,0,0,0.2)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.4)]",
            !pos && "invisible",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuTitle({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-1.5 text-[11px] font-normal uppercase tracking-[0.4px] text-muted-foreground">
      {children}
    </div>
  );
}

export function MenuItem({
  onClick,
  selected,
  icon,
  hint,
  disabled,
  children,
}: {
  onClick?: () => void;
  selected?: boolean;
  icon?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // TradingView's menu item: 32px rows (28px + 2px padding), 8px / 10px
        // inline padding, full-width hover fill, dark fill when selected.
        "flex h-8 w-full items-center whitespace-nowrap pl-2 pr-[10px] text-left text-[14px] disabled:opacity-50",
        selected ? "bg-tv-active text-tv-active-foreground" : "hover:bg-secondary",
      )}
    >
      {icon && <span className="mr-[6px] flex max-h-[28px] w-[28px] shrink-0 justify-center">{icon}</span>}
      <span className="flex-1 pl-1">{children}</span>
      {hint && (
        <span className={cn("ml-[58px] mr-[5px] text-[12px]", selected ? "opacity-70" : "text-muted-foreground")}>{hint}</span>
      )}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-[6px] h-px bg-border" />;
}

/** TradingView's modal shell: centred card, title row with a close button. */
export function Modal({
  open,
  title,
  onClose,
  width = 720,
  height,
  children,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  width?: number;
  height?: number | string;
  children: ReactNode;
}) {
  const ref = useDismiss<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    // TradingView's dialogs float near the top without dimming the chart.
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[88px]">
      <div
        ref={ref}
        role="dialog"
        aria-label={typeof title === "string" ? title : undefined}
        className="flex max-h-[calc(100vh-110px)] w-full flex-col overflow-hidden rounded-[16px] bg-popover text-foreground shadow-[0_2px_24px_rgba(0,0,0,0.18)]"
        style={{ maxWidth: width, height }}
      >
        <div className="flex h-[66px] shrink-0 items-center justify-between pl-5 pr-4">
          <h2 className="text-[20px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded hover:bg-secondary"
          >
            <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Round letter badge standing in for a symbol logo. */
export function SymbolBadge({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const ticker = symbol.includes(":") ? symbol.slice(symbol.indexOf(":") + 1) : symbol;
  const letter = ticker.replace(/^[^A-Z0-9]+/i, "").charAt(0).toUpperCase() || "?";
  // A stable hue per ticker so badges are told apart at a glance.
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55), background: `hsl(${h} 55% 45%)` }}
    >
      {letter}
    </span>
  );
}

/** Controlled toggle like TradingView's menu switches. */
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative h-[18px] w-[34px] shrink-0 rounded-full transition-colors",
        checked ? "bg-tv-active" : "bg-muted-foreground/40",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-card transition-[left]",
          checked ? "left-[18px]" : "left-[2px]",
        )}
      />
    </button>
  );
}
