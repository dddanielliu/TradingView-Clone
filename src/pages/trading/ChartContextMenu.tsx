import { AlarmClockPlus, ChevronDown, ChevronUp, Settings, SquarePlus } from "lucide-react";
import { notAvailable } from "../chart/notAvailable.ts";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// ── Chart context menu (TradingView-style right-click menu) ──────────────────
// Rendered by ChartPanel at the cursor position when the user right-clicks
// empty chart space (right-clicks on a drawing open the drawing menu instead).

export interface ChartContextMenuProps {
  x: number;
  y: number;
  /** Price under the cursor (null when the click landed off the price scale). */
  price: number | null;
  pipDigits: number;
  symbol: string;
  tick?: { bid: number; ask: number };
  drawingsCount: number;
  indicatorsCount: number;
  onClose: () => void;
  /** Kept for callers; TradingView resets the view with Alt + R, not from this menu. */
  onResetView?: () => void;
  onCopyPrice: (price: number) => void;
  onAddAlert?: (price: number) => void;
  onQuickOrder?: (side: "BUY" | "SELL", type: "LIMIT" | "STOP", price: number) => void;
  onOpenObjectTree: () => void;
  onRemoveAllDrawings?: () => void;
  onClearIndicators?: () => void;
  onOpenSettings: () => void;
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center pl-2 pr-[10px] text-left text-[14px] text-foreground hover:bg-secondary"
    >
      <span className="mr-[6px] flex w-[28px] shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="ml-[58px] mr-[5px] shrink-0 text-[12px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

function Separator() {
  return <div className="my-[6px] border-t border-border" />;
}

/** A resting order below the ask buys cheaper (limit); above it is a breakout stop. */
function buyOrderType(price: number, ask: number): "LIMIT" | "STOP" {
  return price <= ask ? "LIMIT" : "STOP";
}

/** A resting order above the bid sells dearer (limit); below it is a breakdown stop. */
function sellOrderType(price: number, bid: number): "LIMIT" | "STOP" {
  return price >= bid ? "LIMIT" : "STOP";
}

function TradeSection({
  price,
  pipDigits,
  symbol,
  tick,
  onQuickOrder,
  onAddAlert,
  onClose,
}: Pick<
  ChartContextMenuProps,
  "pipDigits" | "symbol" | "tick" | "onQuickOrder" | "onAddAlert" | "onClose"
> & { price: number }) {
  const p = price.toFixed(pipDigits);
  const ticker = symbol.slice(symbol.indexOf(":") + 1);
  const ico = "h-[18px] w-[18px]";
  return (
    <>
      {onAddAlert && (
        <MenuItem
          icon={<AlarmClockPlus className={ico} strokeWidth={1.25} />}
          label={`Add alert on ${ticker} at ${p}…`}
          hint="Alt + A"
          onClick={() => {
            onAddAlert(price);
            onClose();
          }}
        />
      )}
      {onQuickOrder && tick && (
        <>
          <MenuItem
            icon={<ChevronUp className={ico} strokeWidth={1.5} />}
            label={`Buy 1 ${ticker} @ ${p} ${buyOrderType(price, tick.ask).toLowerCase()}`}
            hint="Alt + Shift + B"
            onClick={() => {
              onQuickOrder("BUY", buyOrderType(price, tick.ask), price);
              onClose();
            }}
          />
          <MenuItem
            icon={<ChevronDown className={ico} strokeWidth={1.5} />}
            label={`Sell 1 ${ticker} @ ${p} ${sellOrderType(price, tick.bid).toLowerCase()}`}
            onClick={() => {
              onQuickOrder("SELL", sellOrderType(price, tick.bid), price);
              onClose();
            }}
          />
          <MenuItem
            icon={<SquarePlus className={ico} strokeWidth={1.25} />}
            label={`Add order on ${ticker} at ${p}…`}
            hint="Shift + T"
            onClick={() => {
              onQuickOrder("BUY", buyOrderType(price, tick.ask), price);
              onClose();
            }}
          />
        </>
      )}
    </>
  );
}

export function ChartContextMenu(props: ChartContextMenuProps) {
  const {
    x,
    y,
    price,
    pipDigits,
    drawingsCount,
    indicatorsCount,
    onClose,
    onCopyPrice,
    onOpenObjectTree,
    onRemoveAllDrawings,
    onClearIndicators,
    onOpenSettings,
  } = props;

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp into the viewport once the real menu size is known.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* click-away backdrop (also swallows the next right-click) */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        style={{ left: pos.x, top: pos.y }}
        className="tv-scroll fixed z-50 min-w-[312px] rounded-[6px] bg-popover py-[6px] shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
      >
        {price != null && (
          <MenuItem
            label={`Copy price ${price.toFixed(pipDigits)}`}
            onClick={() => {
              onCopyPrice(price);
              onClose();
            }}
          />
        )}
        <MenuItem
          label="Paste"
          hint="Ctrl + V"
          onClick={() => {
            // The drawing layer owns the clipboard; hand it the same shortcut.
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", ctrlKey: true }));
            onClose();
          }}
        />
        {price != null && (
          <>
            <Separator />
            <TradeSection {...props} price={price} />
          </>
        )}
        <Separator />
        <MenuItem
          label="Lock vertical cursor line by time"
          onClick={() => {
            onClose();
            notAvailable("Locking the cursor line");
          }}
        />
        <Separator />
        <MenuItem
          label="Table view"
          onClick={() => {
            onClose();
            notAvailable("Table view");
          }}
        />
        <MenuItem
          label="Object tree"
          onClick={() => {
            onOpenObjectTree();
            onClose();
          }}
        />
        {(drawingsCount > 0 || indicatorsCount > 0) && <Separator />}
        {drawingsCount > 0 && onRemoveAllDrawings && (
          <MenuItem
            label={`Remove ${drawingsCount} drawing${drawingsCount === 1 ? "" : "s"}`}
            onClick={() => {
              onRemoveAllDrawings();
              onClose();
            }}
          />
        )}
        {indicatorsCount > 0 && onClearIndicators && (
          <MenuItem
            label={`Remove ${indicatorsCount} indicator${indicatorsCount === 1 ? "" : "s"}`}
            onClick={() => {
              onClearIndicators();
              onClose();
            }}
          />
        )}
        <Separator />
        <MenuItem
          icon={<Settings className="h-[18px] w-[18px]" strokeWidth={1.25} />}
          label="Settings…"
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
        />
      </div>
    </>
  );
}
