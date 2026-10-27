import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useIsFeedConnected } from "../components/ConnectionIndicator.tsx";
import { TerminalContext, type TerminalContextValue } from "./use-terminal.ts";
import {
  OrderConfirmDialog,
  OrderModifyDialog,
  PositionModifyDialog,
} from "../components/TradingDialogs.tsx";
import { useChartDrawings } from "../hooks/useChartDrawings.ts";
import {
  getChartPreferencesFromStorage,
  updateChartPreferences,
  useChartPreferences,
} from "../hooks/useChartPreferences.ts";
import { useTradeSound } from "../hooks/useTradeSound.ts";
import { safeStorage } from "../lib/safe-storage.ts";
import type { IndicatorType } from "../lib/indicators.ts";
import type { CreateJournalEntryInput, UpdateJournalEntryInput } from "../services/api/journal.ts";
import { api } from "../services/api.ts";
import {
  useCancelOrder,
  useCandles,
  useCloseAllPositions,
  useClosePosition,
  useCreateJournalEntry,
  useDeleteJournalEntry,
  useJournalEntries,
  useOrders,
  usePositions,
  useSymbols,
  useUpdateJournalEntry,
} from "../services/queries.ts";
import type { Order, PlaceOrderInput, Position, Symbol } from "../services/schemas.ts";
import { useTradingStore } from "../services/store.tsx";
import { toast } from "../services/toast.ts";
import {
  type DrawingTool,
  type MagnetMode,
  isTimeframe,
  type Timeframe,
} from "../pages/trading/constants.ts";
import { getPipDigits } from "../pages/trading/utils.ts";
import type { ClosedTrade } from "../replay/paper.ts";
import { useReplay } from "../replay/useReplay.ts";
import { readChartUrl, writeLastSymbol } from "../routing.ts";
import type { ReplayTradeEvent } from "./use-terminal.ts";

/**
 * Shared terminal state.
 *
 * Everything the panels need — the charted symbol and timeframe, candles,
 * drawings, indicators, positions, orders and the actions that change them —
 * lives here rather than in one page component. That is what makes the panels
 * mountable on their own: an application can render just `<Chart />`, or a
 * chart beside its own order form, instead of taking the whole terminal.
 *
 * Layout belongs to whoever composes the panels, so no panel sizes, tab
 * selections or visibility flags are kept here.
 */

type ConfirmOrderState =
  | (PlaceOrderInput & { _submit: () => Promise<unknown>; stopPrice?: number })
  | null;

/** Chart position ids for the replay's paper positions: `replay:<ticket>`. */
const REPLAY_POSITION_PREFIX = "replay:";

const CLOSE_LABEL: Record<string, string> = { sl: "Stop loss", tp: "Take profit" };

function notifyReplayCloses(trades: ClosedTrade[]): void {
  for (const t of trades) {
    const pnl = `${t.pnl >= 0 ? "+" : "−"}${Math.abs(t.pnl).toFixed(2)}`;
    const title = `${CLOSE_LABEL[t.reason] ?? "Closed"} hit`;
    const detail = `${t.side === "BUY" ? "Long" : "Short"} ${t.volume} closed at ${t.exitPrice} (${pnl})`;
    if (t.pnl >= 0) toast.success(title, detail);
    else toast.warning(title, detail);
  }
}

/** Entry and exit markers for the replay's trades that lie inside the bars shown. */
function replayMarkers(snap: NonNullable<ReturnType<typeof useReplay>["snapshot"]>): ReplayTradeEvent[] {
  const { firstTime, cursorTime, symbol } = snap.state;
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  const out: ReplayTradeEvent[] = [];
  for (const t of snap.trades) {
    if (t.symbol !== symbol || t.exitTime < firstTime || t.entryTime > cursorTime) continue;
    out.push(
      { id: `e${t.ticket}`, type: "entry", timestamp: iso(t.entryTime), symbolName: t.symbol, side: t.side, price: t.entryPrice, pnl: null },
      { id: `x${t.ticket}`, type: "exit", timestamp: iso(t.exitTime), symbolName: t.symbol, side: t.side, price: t.exitPrice, pnl: t.pnl },
    );
  }
  for (const p of snap.positions) {
    out.push({ id: `e${p.ticket}`, type: "entry", timestamp: iso(p.time), symbolName: p.symbol, side: p.side, price: p.priceOpen, pnl: null });
  }
  return out;
}

/** Stored timeframe for a symbol, or the 15m default. */
function readStoredTimeframe(symbol: string): Timeframe {
  const saved = safeStorage.getItem(`tf_${symbol}`);
  return isTimeframe(saved) ? saved : "15m";
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Request failed";
}

/** How many bars to request once the first paint has landed. */
function deepLimitFor(timeframe: Timeframe): number {
  switch (timeframe) {
    case "1m":
      return 3_000;
    case "5m":
      return 5_000;
    case "15m":
      return 12_000;
    case "30m":
      return 8_000;
    case "1h":
      return 8_000;
    case "4h":
      return 4_000;
    case "1d":
      return 2_000;
    case "1w":
      return 520;
    default:
      return 5_000;
  }
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Field by field: subscribing to the whole store re-rendered the terminal
  // (and everything under it) on every tick of every symbol.
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useTradingStore((s) => s.setSelectedSymbol);
  const updateTick = useTradingStore((s) => s.updateTick);
  const activeAccountId = useTradingStore((s) => s.activeAccountId);

  // ── Timeframe, held per symbol so switching reads the stored one in render
  // The URL's ?interval= applies to the symbol the page opened on.
  const [timeframeBySymbol, setTimeframeBySymbol] = useState<Partial<Record<string, Timeframe>>>(
    () => {
      const url = readChartUrl();
      return url.timeframe ? { [selectedSymbol]: url.timeframe } : {};
    },
  );
  const timeframe: Timeframe =
    timeframeBySymbol[selectedSymbol] ?? readStoredTimeframe(selectedSymbol);
  const setTimeframe = useCallback(
    (tf: Timeframe) => {
      setTimeframeBySymbol((prev) => ({ ...prev, [selectedSymbol]: tf }));
      safeStorage.setItem(`tf_${selectedSymbol}`, tf);
    },
    [selectedSymbol],
  );

  // A bare /chart/ reopens the last symbol, as TradingView does.
  useEffect(() => {
    writeLastSymbol(selectedSymbol);
  }, [selectedSymbol]);

  // ── Chart configuration
  const chartPrefs = useChartPreferences();
  const [activeIndicators, setActiveIndicators] = useState<IndicatorType[]>([]);
  const toggleIndicator = useCallback((type: IndicatorType) => {
    setActiveIndicators((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);
  const clearIndicators = useCallback(() => setActiveIndicators([]), []);

  const [activePlugins, setActivePlugins] = useState<string[]>(
    () => getChartPreferencesFromStorage().activePlugins,
  );
  const togglePlugin = useCallback((id: string) => {
    setActivePlugins((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      updateChartPreferences({ activePlugins: next });
      return next;
    });
  }, []);
  const setPlugins = useCallback((ids: string[]) => {
    setActivePlugins(ids);
    updateChartPreferences({ activePlugins: ids });
  }, []);
  const cycleMagnetMode = useCallback(() => {
    const order: MagnetMode[] = ["none", "weak", "strong"];
    const next = order[(order.indexOf(chartPrefs.magnetMode) + 1) % order.length] ?? "none";
    updateChartPreferences({ magnetMode: next });
  }, [chartPrefs.magnetMode]);

  // ── Drawings
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("none");
  const {
    drawings,
    addDrawing,
    updateDrawing,
    removeDrawing,
    clearDrawings,
    undo: undoDrawing,
    redo: redoDrawing,
  } = useChartDrawings(selectedSymbol, timeframe);

  // ── Trading preferences
  const [oneClick, setOneClick] = useState(
    () => safeStorage.getItem("oneClickTrading") === "true",
  );
  const toggleOneClick = useCallback(() => {
    setOneClick((prev) => {
      const next = !prev;
      safeStorage.setItem("oneClickTrading", String(next));
      return next;
    });
  }, []);
  const { muted: soundMuted, toggleMute: toggleSoundMute, playTradeSound } = useTradeSound();

  // No analytics: a library must not ship telemetry into the host's bundle.
  // Hosts that want to track fills can listen for "order.filled" on their own
  // adapter's trading.subscribe().
  const onOrderSuccess = useCallback(() => {
    playTradeSound();
  }, [playTradeSound]);

  // ── Dialogs, owned here so any composition of panels gets them
  const [modifyingPosition, setModifyingPosition] = useState<Position | null>(null);
  const [modifyingOrder, setModifyingOrder] = useState<Order | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<ConfirmOrderState>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const { data: symbols = [] } = useSymbols();
  const isFeedConnected = useIsFeedConnected();
  const symbolInfo = symbols.find((s) => s.name === selectedSymbol) as Symbol | undefined;

  // Prime the active symbol with a fresh snapshot on switch so bid/ask appears
  // without waiting for the next tick.
  useEffect(() => {
    let cancelled = false;
    void api
      .getTick(selectedSymbol)
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        updateTick(
          selectedSymbol,
          Number(snapshot.bid),
          Number(snapshot.ask),
          typeof snapshot.timestamp === "number" ? snapshot.timestamp : Date.now(),
        );
      })
      .catch(() => {
        // Ignore snapshot misses; the stream remains authoritative.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, updateTick]);

  const invalidateTrading = useCallback(() => {
    if (!activeAccountId) return;
    queryClient.invalidateQueries({ queryKey: ["orders", activeAccountId] });
    queryClient.invalidateQueries({ queryKey: ["positions", activeAccountId] });
  }, [activeAccountId, queryClient]);

  // Single submit path for the flows that bypass the usePlaceOrder mutation.
  // Toasts the reason and rethrows so callers can skip their success effects.
  const submitOrderDirect = useCallback(
    async (input: PlaceOrderInput) => {
      try {
        const order = await api.placeOrder(input);
        invalidateTrading();
        return order;
      } catch (err) {
        toast.error("Order Failed", getErrorMessage(err));
        throw err;
      }
    },
    [invalidateTrading],
  );

  const modifyLivePositionLevels = useCallback(
    async (positionId: string, mods: { takeProfit?: number | null; stopLoss?: number | null }) => {
      if (!isFeedConnected) {
        toast.warning(
          "No Data Feed",
          "Cannot modify positions while disconnected from the data feed",
        );
        invalidateTrading();
        return;
      }
      try {
        await api.modifyPosition(positionId, mods);
        const field = mods.takeProfit !== undefined ? "TP" : "SL";
        const price = mods.takeProfit !== undefined ? mods.takeProfit : mods.stopLoss;
        toast.success(`${field} Updated`, `${field} set to ${price}`);
        invalidateTrading();
      } catch (err) {
        toast.error("Modify Failed", getErrorMessage(err));
        invalidateTrading();
      }
    },
    [invalidateTrading, isFeedConnected],
  );

  // Chart context-menu orders always route through the confirm dialog, so a
  // stray right-click can never place one directly.
  const quickOrder = useCallback(
    (side: "BUY" | "SELL", type: "LIMIT" | "STOP", price: number) => {
      if (!activeAccountId) {
        toast.warning("No Account", "Select an account before placing orders");
        return;
      }
      const input: PlaceOrderInput = {
        accountId: activeAccountId,
        symbol: selectedSymbol,
        side,
        type,
        quantity: 1,
        ...(type === "LIMIT" ? { price } : { stopPrice: price }),
      };
      setConfirmOrder({ ...input, _submit: () => submitOrderDirect(input) });
    },
    [activeAccountId, selectedSymbol, submitOrderDirect],
  );

  // ── Candles: small first paint, deeper history a beat later
  const chartKey = `${selectedSymbol}:${timeframe}`;
  const firstPaintCandleLimit = useMemo(
    () => (typeof window !== "undefined" && window.innerWidth < 768 ? 500 : 400),
    [],
  );
  const [deepenedFor, setDeepenedFor] = useState<string | null>(null);
  const candleLimit =
    deepenedFor === chartKey ? deepLimitFor(timeframe) : firstPaintCandleLimit;
  useEffect(() => {
    const timer = window.setTimeout(() => setDeepenedFor(chartKey), 400);
    return () => window.clearTimeout(timer);
  }, [chartKey]);

  const candlesQuery = useCandles(selectedSymbol, timeframe, candleLimit);
  const candles = useMemo(() => candlesQuery.data ?? [], [candlesQuery.data]);
  // While a new timeframe loads, the query shows the previous one's bars as a
  // placeholder; the replay must never rebase onto those.
  const confirmedCandles =
    candlesQuery.isPlaceholderData || candles.length === 0 ? null : candles;

  // ── Bar replay (browser-only, CheapTrader-style paper account)
  const replay = useReplay({
    symbol: selectedSymbol,
    timeframe,
    candles: confirmedCandles,
    contractSize: symbolInfo?.contractSize || 1,
    onClosed: notifyReplayCloses,
  });
  const isReplaying = replay.mode === "running";
  const replayCandles = replay.snapshot?.candles ?? null;
  const replayTradeEvents = useMemo(
    () => (replay.snapshot ? replayMarkers(replay.snapshot) : undefined),
    [replay.snapshot],
  );
  const replayPositions = useMemo<Position[]>(
    () =>
      (replay.snapshot?.positions ?? []).map((p) => ({
        id: `${REPLAY_POSITION_PREFIX}${p.ticket}`,
        accountId: "replay",
        symbolName: p.symbol,
        side: p.side === "BUY" ? "LONG" : "SHORT",
        quantity: p.volume,
        entryPrice: p.priceOpen,
        currentPrice: replay.snapshot?.price,
        unrealizedPnl: p.pnl,
        margin: 0,
        contractSize: p.contractSize,
        openedAt: new Date(p.time * 1000).toISOString(),
        takeProfit: p.tp || null,
        stopLoss: p.sl || null,
      })),
    [replay.snapshot],
  );

  // SL/TP drags on the chart reach the paper account while replaying.
  const replayModify = replay.modifyPosition;
  const modifyPositionLevels = useCallback(
    async (positionId: string, mods: { takeProfit?: number | null; stopLoss?: number | null }) => {
      if (!positionId.startsWith(REPLAY_POSITION_PREFIX)) {
        await modifyLivePositionLevels(positionId, mods);
        return;
      }
      const ticket = Number(positionId.slice(REPLAY_POSITION_PREFIX.length));
      const r = replayModify(ticket, mods.stopLoss, mods.takeProfit);
      if (!r.ok) toast.error("Modify Failed", r.error);
    },
    [modifyLivePositionLevels, replayModify],
  );

  const { data: positions = [] } = usePositions(activeAccountId);
  const { data: orders = [] } = useOrders(activeAccountId);
  const positionPnl = useMemo(
    () => positions.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0),
    [positions],
  );
  // In replay the chart shows the paper account's positions, not the live ones.
  const chartPositions = !chartPrefs.overlayPositionsOnChart
    ? []
    : isReplaying
      ? replayPositions
      : positions;
  const chartOrders = chartPrefs.overlayPositionsOnChart && !isReplaying ? orders : [];

  const { data: journalData, isLoading: journalLoading } = useJournalEntries(activeAccountId);
  const createJournalMutation = useCreateJournalEntry();
  const updateJournalMutation = useUpdateJournalEntry();
  const deleteJournalMutation = useDeleteJournalEntry();

  const createJournal = useCallback(
    (data: CreateJournalEntryInput) =>
      createJournalMutation.mutate(data, {
        onSuccess: () => toast.success("Journal", "Entry saved"),
        onError: (err: unknown) => toast.error("Journal", getErrorMessage(err)),
      }),
    [createJournalMutation],
  );
  const updateJournal = useCallback(
    (id: string, data: UpdateJournalEntryInput) =>
      updateJournalMutation.mutate(
        { id, accountId: activeAccountId ?? "", ...data },
        {
          onSuccess: () => toast.success("Journal", "Entry updated"),
          onError: (err: unknown) => toast.error("Journal", getErrorMessage(err)),
        },
      ),
    [activeAccountId, updateJournalMutation],
  );
  const deleteJournal = useCallback(
    (id: string) =>
      deleteJournalMutation.mutate(
        { id, accountId: activeAccountId ?? "" },
        {
          onSuccess: () => toast.success("Journal", "Entry deleted"),
          onError: (err: unknown) => toast.error("Journal", getErrorMessage(err)),
        },
      ),
    [activeAccountId, deleteJournalMutation],
  );

  // ── Position and order actions, so a standalone table can act on its own
  const closePositionMutation = useClosePosition();
  const closeAllMutation = useCloseAllPositions();
  const cancelOrderMutation = useCancelOrder();

  const requireTradingReady = useCallback((): string | null => {
    if (!activeAccountId) {
      toast.warning("No Account", "Select an account first");
      return null;
    }
    if (!isFeedConnected) {
      toast.warning("No Data Feed", "Cannot trade while disconnected from the data feed");
      return null;
    }
    return activeAccountId;
  }, [activeAccountId, isFeedConnected]);

  const closePosition = useCallback(
    (positionId: string, quantity?: number) => {
      const accountId = requireTradingReady();
      if (!accountId || closePositionMutation.isPending) return;
      closePositionMutation.mutate(
        { positionId, accountId, ...(quantity != null ? { quantity } : {}) },
        {
          onSuccess: () =>
            toast.success(
              quantity != null ? "Partial Close" : "Position Closed",
              quantity != null ? `Closed ${quantity} lot(s)` : "Position has been closed",
            ),
          onError: (err: unknown) => toast.error("Close Failed", getErrorMessage(err)),
        },
      );
    },
    [closePositionMutation, requireTradingReady],
  );

  const closeAllPositions = useCallback(() => {
    const accountId = requireTradingReady();
    if (!accountId || closeAllMutation.isPending) return;
    closeAllMutation.mutate(accountId, {
      onSuccess: () => toast.success("Positions Closed", "All positions have been closed"),
      onError: (err: unknown) => toast.error("Close All Failed", getErrorMessage(err)),
    });
  }, [closeAllMutation, requireTradingReady]);

  const cancelOrder = useCallback(
    (orderId: string) => {
      const accountId = requireTradingReady();
      if (!accountId || cancelOrderMutation.isPending) return;
      cancelOrderMutation.mutate(
        { orderId, accountId },
        {
          onSuccess: () => toast.info("Order Cancelled", "Pending order has been cancelled"),
          onError: (err: unknown) => toast.error("Cancel Failed", getErrorMessage(err)),
        },
      );
    },
    [cancelOrderMutation, requireTradingReady],
  );

  const account = useTradingStore((s) => s.accounts.find((a) => a.id === activeAccountId));
  const liveCandleUpdates = useTradingStore((s) => s.liveCandleUpdates);
  const liveCandle = liveCandleUpdates[chartKey];
  const tick = useTradingStore((s) => s.ticks[selectedSymbol]);
  const pipDigits = useMemo(
    () => getPipDigits(symbolInfo, selectedSymbol),
    [symbolInfo, selectedSymbol],
  );
  const isDark =
    typeof document === "undefined"
      ? true
      : !document.documentElement.classList.contains("light");

  const value: TerminalContextValue = {
    selectedSymbol,
    setSelectedSymbol,
    symbols,
    symbolInfo,
    pipDigits,
    tick,
    isDark,

    timeframe,
    setTimeframe,

    candles,
    liveCandle,
    replayCandles,
    replayTradeEvents,
    isReplaying,
    replay,

    chartPrefs,
    activeIndicators,
    toggleIndicator,
    clearIndicators,
    activePlugins,
    togglePlugin,
    setPlugins,
    cycleMagnetMode,

    drawingTool,
    setDrawingTool,
    drawings,
    addDrawing,
    updateDrawing,
    removeDrawing,
    clearDrawings,
    undoDrawing,
    redoDrawing,

    activeAccountId,
    account,
    positions,
    orders,
    positionPnl,
    chartPositions,
    chartOrders,
    isFeedConnected,

    oneClick,
    toggleOneClick,
    soundMuted,
    toggleSoundMute,
    onOrderSuccess,
    requestOrderConfirmation: setConfirmOrder,
    submitOrderDirect,
    quickOrder,
    modifyPositionLevels,
    editPosition: setModifyingPosition,
    editOrder: setModifyingOrder,
    closePosition,
    closeAllPositions,
    cancelOrder,

    journalEntries: (journalData?.entries ?? []) as TerminalContextValue["journalEntries"],
    journalLoading,
    createJournal,
    updateJournal,
    deleteJournal,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}

      {/* Dialogs live with the state so any composition of panels gets them. */}
      <PositionModifyDialog
        key={modifyingPosition?.id ?? "no-position"}
        position={modifyingPosition}
        onClose={() => setModifyingPosition(null)}
        onSaved={() => setModifyingPosition(null)}
        tick={tick}
        isFeedConnected={isFeedConnected}
      />
      <OrderModifyDialog
        key={modifyingOrder?.id ?? "no-order"}
        order={modifyingOrder}
        onClose={() => setModifyingOrder(null)}
        onSaved={() => setModifyingOrder(null)}
        tick={tick}
      />
      <OrderConfirmDialog
        isOpen={!!confirmOrder}
        order={confirmOrder}
        onConfirm={() => {
          if (!confirmOrder?._submit) return;
          setConfirmLoading(true);
          confirmOrder
            ._submit()
            .then(() => onOrderSuccess())
            .catch(() => {
              // Submit paths toast their own reason; swallow so the rejection
              // never escapes as an unhandled promise.
            })
            .finally(() => {
              setConfirmLoading(false);
              setConfirmOrder(null);
            });
        }}
        onCancel={() => setConfirmOrder(null)}
        loading={confirmLoading}
        tick={tick}
        symbolInfo={symbolInfo}
      />
    </TerminalContext.Provider>
  );
}
