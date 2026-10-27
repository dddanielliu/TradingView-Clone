import type { IChartApi, Time } from "lightweight-charts";
import { ChevronDown, ChevronUp, Maximize2, Menu, Rewind } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateChartPreferences } from "../hooks/useChartPreferences.ts";
import { toggleTheme, useTheme } from "../hooks/useTheme.ts";
import type { IndicatorType } from "../lib/indicators.ts";
import { safeStorage } from "../lib/safe-storage.ts";
import { uid } from "../lib/uid.ts";
import { useMarketInterest, useQuoteStats } from "../market/index.ts";
import { chartTitle } from "../routing.ts";
import type { PlaceOrderInput } from "../services/schemas.ts";
import { toast } from "../services/toast.ts";
import { notAvailable } from "./chart/notAvailable.ts";
import { useTerminal } from "../terminal/use-terminal.ts";
import { ChartControlsBar, ReplayToolbarRow } from "./chart/ChartControlsBar.tsx";
import { IndicatorsDialog } from "./chart/IndicatorsDialog.tsx";
import { LeftToolbar } from "./chart/LeftToolbar.tsx";
import { NotAvailableDialog } from "./chart/NotAvailableDialog.tsx";
import { ReplayTradingPanel } from "./chart/ReplayTradingPanel.tsx";
import { ObjectTreePage } from "./chart/ObjectTreePage.tsx";
import { RightRail, type SidePage, WatchlistPage } from "./chart/RightSidebar.tsx";
import { toChartTime, utcOffsetLabel } from "../lib/chart-time.ts";
import {
  composeSnapshot,
  copySnapshotImage,
  downloadSnapshot,
  snapshotFileName,
  type LegendLine,
} from "../lib/chart-snapshot.ts";
import { type DateRange, intervalShort, useWatchlist } from "./chart/shared.ts";
import { SymbolSearchDialog } from "./chart/SymbolSearchDialog.tsx";
import { TopToolbar } from "./chart/TopToolbar.tsx";
import { MenuDivider, MenuItem, Modal, Popover, Switch } from "./chart/ui.tsx";
import { OrderTicketPanel } from "./chart/OrderTicketPanel.tsx";
import { PaperTradingPanel } from "./chart/PaperTradingPanel.tsx";
import { ChartPanel, type CrosshairBar, RESET_VIEW_EVENT, SELECT_DRAWING_EVENT } from "./trading/ChartPanel.tsx";
import { MarketClosedBanner } from "./trading/MarketClosedBanner.tsx";

/**
 * The chart page, laid out like tradingview.com/chart: a 38px header row,
 * then — separated by 4px gutters — the 52px drawing toolbar, the chart with
 * its date-range bar, and the right widget page plus its 45px icon rail. The
 * trading panel opens under the chart ("Trade", or automatically for replay).
 *
 * Shared state comes from <TerminalProvider>; this component owns only the
 * layout and the page-level wiring (dialogs, shortcuts, range buttons).
 */

const BOTTOM_H_KEY = "bottomPanelHeight";
const SIDE_PAGE_KEY = "tv_side_page";
const SIDE_W_KEY = "tv_side_width";
/** TradingView's widget page cannot be narrower than this. */
const SIDE_MIN = 202;

function readSidePage(): SidePage | null {
  const v = safeStorage.getItem(SIDE_PAGE_KEY);
  if (v === "none") return null;
  return v === "objtree" || v === "watchlist" ? v : "watchlist";
}

/** Typing outside inputs, like TradingView: letters open symbol search. */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function TradingPage() {
  const t = useTerminal();
  const { replay } = t;
  const theme = useTheme();

  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [search, setSearch] = useState<{ open: boolean; query: string; mode: "change" | "add" }>({
    open: false,
    query: "",
    mode: "change",
  });
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsRequest, setSettingsRequest] = useState(0);
  const [sidePage, setSidePageState] = useState<SidePage | null>(readSidePage);
  const setSidePage = (p: SidePage | null) => {
    setSidePageState(p);
    safeStorage.setItem(SIDE_PAGE_KEY, p ?? "none");
  };
  const [tradeOpen, setTradeOpen] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(() => Number(safeStorage.getItem(BOTTOM_H_KEY)) || 260);
  const watchlist = useWatchlist();
  const [crosshairBar, setCrosshairBar] = useState<CrosshairBar | null>(null);

  // The bottom panel shows Replay Trading while a replay is on.
  const replayOn = replay.mode !== "off";
  // TradingView shows "Replay Trading" as a collapsed bar under the chart;
  // it opens to full height from that bar.
  const [replayPanelOpen, setReplayPanelOpen] = useState(false);
  const [paperCollapsed, setPaperCollapsed] = useState(false);
  const bottomOpen = (tradeOpen && !replayOn && !paperCollapsed) || (replayOn && replayPanelOpen);

  // ── Live prices for the charted symbol; TradingView-style tab title
  useMarketInterest([t.selectedSymbol]);
  const stats = useQuoteStats([t.selectedSymbol])[t.selectedSymbol];
  const titlePrice = stats?.last ?? (t.tick ? (t.tick.bid + t.tick.ask) / 2 : undefined);
  useEffect(() => {
    document.title = chartTitle(t.selectedSymbol, titlePrice, stats?.changePct, t.pipDigits);
  }, [t.selectedSymbol, titlePrice, stats?.changePct, t.pipDigits]);

  // ── Date ranges: switch interval, then show the span once its bars load
  const pendingRange = useRef<DateRange | null>(null);
  const onRange = (r: DateRange) => {
    pendingRange.current = r;
    if (r.timeframe !== t.timeframe) t.setTimeframe(r.timeframe);
    else applyRange();
  };
  const applyRange = useCallback(() => {
    const r = pendingRange.current;
    const candles = t.replayCandles ?? t.candles ?? [];
    if (!r || !chartApi || r.timeframe !== t.timeframe || candles.length === 0) return;
    pendingRange.current = null;
    const toSec = (c: { time: number }) => (c.time > 1e12 ? Math.floor(c.time / 1000) : c.time);
    const last = toSec(candles[candles.length - 1]!);
    const first = toSec(candles[0]!);
    const ts = chartApi.timeScale();
    if (r.seconds === "all") {
      // Every real bar; fitContent would also fit the future time scale.
      ts.setVisibleLogicalRange({ from: 0, to: candles.length - 1 + 6 });
      return;
    }
    const from =
      r.seconds === "ytd" ? Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000 : last - r.seconds;
    ts.setVisibleRange({ from: toChartTime(Math.max(from, first)) as Time, to: toChartTime(last) as Time });
  }, [chartApi, t.candles, t.replayCandles, t.timeframe]);
  useEffect(() => {
    // Runs again whenever new bars land, until the requested span is shown.
    const id = window.setTimeout(applyRange, 50);
    return () => window.clearTimeout(id);
  }, [applyRange]);

  const goTo = (timeSec: number) => {
    if (!chartApi) return;
    const ts = chartApi.timeScale();
    const vis = ts.getVisibleRange();
    const half = vis ? ((vis.to as number) - (vis.from as number)) / 2 : 86_400 * 30;
    const at = toChartTime(timeSec);
    ts.setVisibleRange({ from: (at - half) as Time, to: (at + half) as Time });
  };

  // ── Header actions
  const zoomIn = () => {
    const ts = chartApi?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2;
    const half = ((r.to - r.from) / 2) * 0.7;
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  };

  // ── Chart snapshot (TradingView's client snapshot: download / copy the image)
  const snapshotLegendRef = useRef<(() => LegendLine[]) | null>(null);
  const snapshotCanvas = (): HTMLCanvasElement | null => {
    if (!chartApi) return null;
    const bg = chartApi.options().layout.background;
    const background = (bg.type === "solid" ? bg.color : bg.topColor) ?? "#ffffff";
    const dark = isDarkColor(background);
    // "Created with TradingView-Clone, Oct 27, 2026 09:13 UTC+8": the time in the chart's zone.
    const now = new Date();
    const date = `${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} ${utcOffsetLabel()}`;
    return composeSnapshot(chartApi, {
      header: [`Created with TradingView-Clone, ${date}`],
      legend: snapshotLegendRef.current?.() ?? [],
      colors: dark
        ? { background, border: "#2b2b2b", text: "#dbdbdb" }
        : { background, border: "#ebebeb", text: "#000000" },
      brand: "OpenCharts",
    });
  };
  const snapshot = (action: "download" | "copy") => {
    const canvas = snapshotCanvas();
    if (!canvas) return;
    if (action === "download") downloadSnapshot(canvas, snapshotFileName(t.selectedSymbol));
    else void copySnapshotImage(canvas).then((ok) => ok && toast.info("Chart image copied to clipboard 👍", ""));
  };
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  });
  // TradingView's hotkeys: Mod + Alt + S downloads, Mod + Shift + S copies,
  // Alt + S copies a link (which needs image hosting: Oops here).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyS" || isTextInput(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.altKey && !e.shiftKey) snapshotRef.current("download");
      else if (mod && e.shiftKey && !e.altKey) snapshotRef.current("copy");
      else if (e.altKey && !mod && !e.shiftKey) notAvailable("Copy link");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  const lastPrice = (): number | null => {
    if (replay.snapshot) return replay.snapshot.price;
    if (t.tick) return (t.tick.bid + t.tick.ask) / 2;
    const c = t.candles?.[t.candles.length - 1];
    return c ? c.close : null;
  };

  const addAlert = () => {
    const price = lastPrice();
    if (price == null) return;
    const rounded = Number(price.toFixed(t.pipDigits));
    t.addDrawing({ id: uid(), type: "horizontal", price: rounded, color: "#2962ff", alertEnabled: true, createdTf: t.timeframe });
    toast.info("Alert created", `${t.selectedSymbol} crossing ${rounded}`);
  };

  const setIndicators = useCallback(
    (next: IndicatorType[]) => {
      for (const type of next) if (!t.activeIndicators.includes(type)) t.toggleIndicator(type);
      for (const type of t.activeIndicators) if (!next.includes(type)) t.toggleIndicator(type);
    },
    [t],
  );

  // ── Replay
  const toggleReplay = () => {
    if (replayOn) {
      replay.exit();
      return;
    }
    if (!replay.canStart) {
      toast.warning("Bar replay", "The chart has no bars to replay yet.");
      return;
    }
    t.setDrawingTool("none");
    replay.open();
    window.dispatchEvent(new Event(RESET_VIEW_EVENT));
  };
  const candleSec = (i: number) => {
    const c = t.candles?.[i];
    return c ? (c.time > 1e12 ? Math.floor(c.time / 1000) : c.time) : null;
  };
  const replayFirst = () => {
    const s = candleSec(0);
    if (s != null) replay.startAt(s);
  };
  const replayRandom = () => {
    const n = t.candles?.length ?? 0;
    if (n < 2) return;
    // Anywhere but the very start and the last stretch: context before, bars after.
    const s = candleSec(Math.floor(n * (0.05 + Math.random() * 0.85)));
    if (s != null) replay.startAt(s);
  };

  // ── Market orders from the legend's SELL / BUY boxes
  const marketOrder = (side: "BUY" | "SELL") => {
    if (replay.mode === "running") {
      const r = replay.order(side, 1);
      if (r.ok) toast.success(`${side === "BUY" ? "Bought" : "Sold"} 1`, `Filled at ${r.price.toFixed(t.pipDigits)}`);
      else toast.error("Order rejected", r.error);
      return;
    }
    if (!t.activeAccountId) {
      toast.warning("No account", "The paper account is still loading.");
      return;
    }
    const input: PlaceOrderInput = {
      accountId: t.activeAccountId,
      symbol: t.selectedSymbol,
      side,
      type: "MARKET",
      quantity: 1,
    };
    if (t.oneClick) {
      void t.submitOrderDirect(input).then(t.onOrderSuccess).catch(() => undefined);
    } else {
      t.requestOrderConfirmation({ ...input, _submit: () => t.submitOrderDirect(input) });
    }
  };

  // ── Keyboard: TradingView's page-level shortcuts
  const keyStateRef = useRef({ replay, t, search });
  const chartApiRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    keyStateRef.current = { replay, t, search };
    chartApiRef.current = chartApi;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || keyStateRef.current.search.open) return;
      const r = keyStateRef.current.replay;
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && r.mode === "running") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          r.toggle();
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          r.step(1);
          return;
        }
      }
      if (e.key === "Escape" && r.mode === "picking") {
        r.exit();
        return;
      }
      if (e.altKey && !e.shiftKey && e.code === "KeyR") {
        // Alt+R: reset the chart view (time scale, and price scale back to auto).
        e.preventDefault();
        window.dispatchEvent(new Event(RESET_VIEW_EVENT));
        return;
      }
      // Start typing a ticker anywhere on the page to search for it.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z0-9]$/i.test(e.key)) {
        e.preventDefault();
        setSearch({ open: true, query: e.key.toUpperCase(), mode: "change" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Resizable widget page (TradingView: drag the gutter; min 202px)
  const [sideWidth, setSideWidth] = useState(() => Math.max(SIDE_MIN, Number(safeStorage.getItem(SIDE_W_KEY)) || 302));
  const startSideResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sideWidth;
    const max = Math.max(SIDE_MIN, window.innerWidth - 600);
    const move = (ev: PointerEvent) => setSideWidth(Math.max(SIDE_MIN, Math.min(max, startW + startX - ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSideWidth((w) => {
        safeStorage.setItem(SIDE_W_KEY, String(Math.round(w)));
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ── Resizable bottom panel
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomHeight;
    const move = (ev: PointerEvent) => setBottomHeight(Math.max(120, Math.min(window.innerHeight * 0.7, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBottomHeight((h) => {
        safeStorage.setItem(BOTTOM_H_KEY, String(Math.round(h)));
        return h;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const positionsShown = t.chartPrefs.overlayPositionsOnChart;
  const replayPicking = replay.mode === "picking";

  const sidePageBody = useMemo(() => {
    switch (sidePage) {
      case "watchlist":
        return (
          <WatchlistPage
            selected={t.selectedSymbol}
            symbolInfo={t.symbolInfo}
            onSelect={t.setSelectedSymbol}
            onAdd={() => setSearch({ open: true, query: "", mode: "add" })}
            watchlist={watchlist}
          />
        );
      case "objtree":
        return (
          <ObjectTreePage
            symbol={t.selectedSymbol}
            intervalLabel={intervalShort(t.timeframe).replace(/m$/, "")}
            indicators={t.activeIndicators}
            onRemoveIndicator={t.toggleIndicator}
            drawings={t.drawings}
            onUpdateDrawing={t.updateDrawing}
            onRemoveDrawing={t.removeDrawing}
            onSelectDrawing={(id) => window.dispatchEvent(new CustomEvent(SELECT_DRAWING_EVENT, { detail: id }))}
            bar={crosshairBar}
            intraday={!["1d", "1w"].includes(t.timeframe)}
            dayChange={stats ? { change: stats.change, changePct: stats.changePct } : null}
          />
        );
      default:
        return null;
    }
  }, [sidePage, t, watchlist, crosshairBar, stats]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* ── Header row ───────────────────────────────────── */}
      <div className="flex h-[38px] shrink-0 items-center bg-card">
        <MainMenu
          dark={theme === "dark"}
          onToggleTheme={toggleTheme}
          onShortcuts={() => setShortcutsOpen(true)}
          onSettings={() => setSettingsRequest((n) => n + 1)}
        />
        <TopToolbar
          symbol={t.selectedSymbol}
          timeframe={t.timeframe}
          onTimeframe={t.setTimeframe}
          onOpenSymbolSearch={() => setSearch({ open: true, query: "", mode: "change" })}
          onOpenIndicators={() => setIndicatorsOpen(true)}
          activeIndicators={t.activeIndicators}
          onSetIndicators={setIndicators}
          activePlugins={t.activePlugins}
          onTogglePlugin={t.togglePlugin}
          onSetPlugins={t.setPlugins}
          onAddAlert={addAlert}
          replayOn={replayOn}
          onToggleReplay={toggleReplay}
          onUndo={t.undoDrawing}
          onRedo={t.redoDrawing}
          onOpenSettings={() => setSettingsRequest((n) => n + 1)}
          onFullscreen={fullscreen}
          onSnapshot={snapshot}
          tradeOpen={bottomOpen}
          onToggleTrade={() => setTradeOpen((v) => !v)}
        />
      </div>

      <MarketClosedBanner symbolInfo={t.symbolInfo} />

      {/* ── Body: toolbar · chart · widgets, 4px gutters ─────────────── */}
      <div className="mt-[4px] flex min-h-0 flex-1 gap-[4px]">
        <div className="hidden w-[52px] shrink-0 rounded-tr-[4px] bg-card md:block">
          <LeftToolbar
            drawingTool={t.drawingTool}
            onDrawingTool={t.setDrawingTool}
            cursorMode={t.chartPrefs.cursorMode}
            onCursorMode={(m) => {
              updateChartPreferences({ cursorMode: m });
              t.setDrawingTool("none");
            }}
            magnetMode={t.chartPrefs.magnetMode}
            onMagnetMode={(m) => updateChartPreferences({ magnetMode: m })}
            stayInDrawingMode={t.chartPrefs.stayInDrawingMode}
            onToggleStayInDrawingMode={() => updateChartPreferences({ stayInDrawingMode: !t.chartPrefs.stayInDrawingMode })}
            drawings={t.drawings}
            onUpdateDrawing={t.updateDrawing}
            onClearDrawings={t.clearDrawings}
            indicatorCount={t.activeIndicators.length}
            onClearIndicators={t.clearIndicators}
            positionsShown={positionsShown}
            onTogglePositions={() => updateChartPreferences({ overlayPositionsOnChart: !positionsShown })}
            onZoomIn={zoomIn}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <div className="flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-t-[4px] bg-card md:rounded-tl-[4px]">
            <div className={`relative min-h-0 flex-1 ${replayPicking ? "cursor-crosshair" : ""}`}>
              <ChartPanel
                candles={t.replayCandles ?? t.candles ?? []}
                selectedSymbol={t.selectedSymbol}
                timeframe={t.timeframe}
                isDark={theme === "dark"}
                activeIndicators={t.activeIndicators}
                drawingTool={t.drawingTool}
                cursorMode={t.chartPrefs.cursorMode}
                drawings={t.drawings}
                onAddDrawing={t.addDrawing}
                onUpdateDrawing={t.updateDrawing}
                onRemoveDrawing={t.removeDrawing}
                onDrawingComplete={() => t.setDrawingTool("none")}
                onDrawingToolSelect={t.setDrawingTool}
                onUndoDrawing={t.undoDrawing}
                onRedoDrawing={t.redoDrawing}
                magnetMode={t.chartPrefs.magnetMode}
                stayInDrawingMode={t.chartPrefs.stayInDrawingMode}
                positions={t.chartPositions}
                orders={t.chartOrders}
                tick={t.replayCandles ? undefined : t.tick}
                liveCandle={t.replayCandles ? undefined : t.liveCandle}
                pipDigits={t.pipDigits}
                symbolInfo={t.symbolInfo}
                onModifyPosition={t.modifyPositionLevels}
                replayTradeEvents={t.replayTradeEvents}
                isReplaying={t.isReplaying}
                activePlugins={t.activePlugins}
                onTogglePlugin={t.togglePlugin}
                accountEquity={replay.snapshot?.metrics.equity ?? t.account?.equity ?? t.account?.balance ?? 0}
                accountId={t.activeAccountId}
                onQuickOrder={t.quickOrder}
                onClearDrawings={t.clearDrawings}
                onClearIndicators={t.clearIndicators}
                replayPicking={replayPicking}
                onReplayPick={replay.startAt}
                onMarketOrder={marketOrder}
                onChartApi={setChartApi}
                snapshotLegendRef={snapshotLegendRef}
                settingsRequest={settingsRequest}
                // Only while the Data window can show it: this fires on every mouse move.
                onCrosshairBar={sidePage === "objtree" ? setCrosshairBar : undefined}
                onOpenObjectTree={() => setSidePage("objtree")}
                tradingConnected={tradeOpen || replay.mode === "running"}
              />
            </div>
            {replayOn && (
              <ReplayToolbarRow
                replay={replay}
                timeframe={t.timeframe}
                onTimeframe={t.setTimeframe}
                onFirst={replayFirst}
                onRandom={replayRandom}
                onDate={(s) => replay.startAt(s)}
              />
            )}
            <ChartControlsBar onRange={onRange} onGoTo={goTo} />
          </div>

          {replayOn && !replayPanelOpen && (
            <ReplayTradingBar onOpen={() => setReplayPanelOpen(true)} />
          )}
          {!replayOn && tradeOpen && paperCollapsed && (
            <PaperTradingBar onOpen={() => setPaperCollapsed(false)} />
          )}
          {bottomOpen && (
            <div className="relative flex shrink-0 flex-col rounded-t-[4px] bg-card" style={{ height: bottomHeight }}>
              <div
                onPointerDown={startResize}
                // TradingView's bottom-widgetbar handle: the 4px gutter, ns-resize.
                className="absolute -top-[4px] left-0 right-0 z-10 h-[4px] cursor-ns-resize"
                aria-label="Resize panel"
              />
              {replayOn ? (
                <ReplayTradingPanel replay={replay} digits={t.pipDigits} onCollapse={() => setReplayPanelOpen(false)} />
              ) : (
                <PaperTradingPanel
                  account={t.account}
                  positions={t.positions}
                  orders={t.orders}
                  accountId={t.activeAccountId}
                  onClosePosition={(id) => t.closePosition(id)}
                  onEditPosition={(p) => t.editPosition(p)}
                  onCancelOrder={(id) => t.cancelOrder(id)}
                  onEditOrder={(o) => t.editOrder(o)}
                  onBuy={() => marketOrder("BUY")}
                  onSell={() => marketOrder("SELL")}
                  onMinimize={() => setPaperCollapsed(true)}
                  onMaximize={() => setBottomHeight(Math.round(window.innerHeight * 0.6))}
                />
              )}
            </div>
          )}
        </div>

        {tradeOpen && !replayOn && (
          <div className="hidden shrink-0 overflow-hidden rounded-t-[4px] md:block">
            <OrderTicketPanel
              symbol={t.selectedSymbol}
              tick={t.tick}
              tickSize={t.symbolInfo?.tickSize || 0.01}
              accountId={t.activeAccountId}
              onPlace={(input) => {
                void t.submitOrderDirect(input).then(t.onOrderSuccess).catch(() => undefined);
              }}
              onClose={() => setTradeOpen(false)}
            />
          </div>
        )}

        <div className="relative hidden shrink-0 md:flex">
          {sidePage && (
            <>
              {/* TradingView's widgetbar handle: a 5px ew-resize strip over the gutter. */}
              <div
                onPointerDown={startSideResize}
                className="absolute -left-[4px] top-0 z-10 h-full w-[5px] cursor-ew-resize"
                aria-label="Resize panel"
              />
              <div className="overflow-hidden rounded-tl-[4px] bg-card" style={{ width: sideWidth }}>
                {sidePageBody}
              </div>
            </>
          )}
          <div className="w-[45px] border-l border-background bg-card">
            <RightRail page={sidePage} onPage={setSidePage} />
          </div>
        </div>
      </div>

      <SymbolSearchDialog
        open={search.open}
        initialQuery={search.query}
        title={search.mode === "add" ? "Add symbol" : "Symbol Search"}
        onClose={() => setSearch((s) => ({ ...s, open: false }))}
        onPick={(s) => (search.mode === "add" ? watchlist.add(s) : t.setSelectedSymbol(s))}
      />
      <IndicatorsDialog
        open={indicatorsOpen}
        active={t.activeIndicators}
        onToggle={t.toggleIndicator}
        onClose={() => setIndicatorsOpen(false)}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <NotAvailableDialog />
    </div>
  );
}

/** The collapsed "Replay Trading" bar TradingView shows under the chart during replay. */
function ReplayTradingBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex h-[40px] shrink-0 items-center rounded-t-[4px] bg-card pl-3 pr-2 text-[14px]">
      <button type="button" onClick={onOpen} className="flex h-[32px] items-center gap-2 rounded px-2 hover:bg-secondary">
        <Rewind className="h-[18px] w-[18px]" strokeWidth={1.25} />
        Replay Trading
        <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <div className="flex-1" />
      <button type="button" title="Open panel" onClick={onOpen} className="flex h-[32px] w-[32px] items-center justify-center rounded hover:bg-secondary">
        <ChevronUp className="h-5 w-5" strokeWidth={1.25} />
      </button>
      <button type="button" title="Maximize panel" onClick={onOpen} className="flex h-[32px] w-[32px] items-center justify-center rounded hover:bg-secondary">
        <Maximize2 className="h-[18px] w-[18px]" strokeWidth={1.25} />
      </button>
    </div>
  );
}

/** The minimized Paper Trading panel: its tab bar alone. */
function PaperTradingBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex h-[40px] shrink-0 items-center rounded-t-[4px] bg-card pl-3 pr-2 text-[14px]">
      <button type="button" onClick={onOpen} className="flex h-[32px] items-center gap-2 rounded px-2 hover:bg-secondary">
        <span className="flex h-[18px] w-[22px] items-center justify-center rounded-[3px] bg-tv-active text-[9px] font-bold text-tv-active-foreground">TV</span>
        Paper Trading
        <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <div className="flex-1" />
      <button type="button" title="Open panel" onClick={onOpen} className="flex h-[32px] w-[32px] items-center justify-center rounded hover:bg-secondary">
        <ChevronUp className="h-5 w-5" strokeWidth={1.25} />
      </button>
    </div>
  );
}

/** TradingView's top-left menu: theme switch, shortcuts, settings. */
function MainMenu({
  dark,
  onToggleTheme,
  onShortcuts,
  onSettings,
}: {
  dark: boolean;
  onToggleTheme: () => void;
  onShortcuts: () => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-[52px] shrink-0 justify-center">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        className="min-w-[260px]"
        trigger={
          <button
            type="button"
            title="Open menu"
            aria-label="Open menu"
            onClick={() => setOpen((v) => !v)}
            className="group flex h-[38px] w-[52px] items-center justify-center"
          >
            {/* The whole 52 × 38 cell is the button, as TradingView's user-menu cell. */}
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded group-hover:bg-secondary">
              <Menu className="h-[22px] w-[22px]" strokeWidth={1.4} />
            </span>
          </button>
        }
      >
        <div className="flex h-9 items-center justify-between px-4 text-[14px]">
          Dark theme
          <Switch checked={dark} onChange={onToggleTheme} />
        </div>
        <MenuDivider />
        <MenuItem onClick={() => { onSettings(); setOpen(false); }}>Chart settings</MenuItem>
        <MenuItem hint="Ctrl + /" onClick={() => { onShortcuts(); setOpen(false); }}>
          Keyboard shortcuts
        </MenuItem>
      </Popover>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Symbol search", "Start typing"],
  ["Keyboard shortcuts", "Ctrl + /"],
  ["Reset chart view", "Alt + R"],
  ["Trend line", "Alt + T"],
  ["Horizontal line", "Alt + H"],
  ["Vertical line", "Alt + V"],
  ["Fib retracement", "Alt + F"],
  ["Rectangle", "Alt + Shift + R"],
  ["Undo / redo", "Ctrl + Z / Ctrl + Y"],
  ["Copy / paste / duplicate drawing", "Ctrl + C / V / D"],
  ["Bar replay: play / pause", "Shift + ↓"],
  ["Bar replay: forward", "Shift + →"],
  ["Bar replay: cancel select bar", "Esc"],
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Keyboard shortcuts" onClose={onClose} width={520}>
      <div className="overflow-y-auto border-t border-border px-5 py-3">
        {SHORTCUTS.map(([what, keys]) => (
          <div key={what} className="flex h-9 items-center justify-between text-[14px]">
            <span>{what}</span>
            <kbd className="rounded bg-pill px-2 py-0.5 text-[13px]">{keys}</kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** True for a dark colour (#rgb / #rrggbb / rgb(a)). */
function isDarkColor(color: string): boolean {
  let r = 255;
  let g = 255;
  let b = 255;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.replace(/./g, (c) => c + c) : hex[1]!;
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  } else {
    const m = /rgba?\(([^)]+)\)/i.exec(color);
    if (m) [r, g, b] = m[1]!.split(",").map((v) => parseFloat(v)) as [number, number, number];
  }
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Typing in a field keeps its own keys. */
function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}
