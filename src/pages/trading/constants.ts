// ── Trading Page Constants ────────────────────────────────────────────────────

import { STANDARD_TIMEFRAMES, timeframeSeconds, type Timeframe } from "../../market/timeframes.ts";

export type { Timeframe };
export { isTimeframe } from "../../market/timeframes.ts";

/** TradingView's standard interval menu: minutes, hours, then days and up. */
export const TIMEFRAMES = STANDARD_TIMEFRAMES;

export const CHART_COLORS = {
  dark: {
    // TradingView's dark chart theme: cold-gray-900 background, cold-gray-300
    // scale text, cold-gray-100 grid at 20 %, cold-gray-400 crosshair.
    background: "#000000",
    text: "#b8b8b8",
    grid: "rgba(242, 242, 242, 0.2)",
    crosshair: "#9c9c9c",
    up: "#089981",
    down: "#f23645",
    volumeUp: "rgba(8, 153, 129, 0.5)",
    volumeDown: "rgba(242, 54, 69, 0.5)",
    bidLine: "#089981",
    askLine: "#f23645",
    bidLabelBg: "#089981",
    askLabelBg: "#f23645",
    watermark: "rgba(255, 255, 255, 0.03)",
    lastPriceUp: "#089981",
    lastPriceDown: "#f23645",
    orderLine: "#2962ff",
    positionLong: "#089981",
    positionShort: "#f23645",
    tpLine: "#089981",
    slLine: "#f23645",
  },
  light: {
    background: "#ffffff",
    // TradingView's light chart theme: cold-gray-900 scale text, cold-gray-800
    // grid at 20 %, cold-gray-400 crosshair.
    text: "#000000",
    grid: "rgba(26, 26, 26, 0.2)",
    crosshair: "#9c9c9c",
    up: "#089981",
    down: "#f23645",
    volumeUp: "rgba(8, 153, 129, 0.5)",
    volumeDown: "rgba(242, 54, 69, 0.5)",
    bidLine: "#089981",
    askLine: "#f23645",
    bidLabelBg: "#089981",
    askLabelBg: "#f23645",
    watermark: "rgba(0, 0, 0, 0.03)",
    lastPriceUp: "#089981",
    lastPriceDown: "#f23645",
    orderLine: "#2962ff",
    positionLong: "#089981",
    positionShort: "#f23645",
    tpLine: "#089981",
    slLine: "#f23645",
  },
};

export type ChartColors = (typeof CHART_COLORS)["dark"];

/**
 * Per-user color overrides (Chart Settings → Colors). Empty string = use the
 * theme default. Keys map 1:1 onto `ChartColors` fields via COLOR_OVERRIDE_MAP.
 */
export interface ChartColorOverrides {
  colorBackground: string;
  colorGrid: string;
  colorScaleText: string;
  colorCrosshair: string;
  colorBidLine: string;
  colorAskLine: string;
  colorPositionLong: string;
  colorPositionShort: string;
  colorOrderLine: string;
  colorTpLine: string;
  colorSlLine: string;
  /** Candle body colors (also drive wicks/borders unless overridden). */
  candleUpColor: string;
  candleDownColor: string;
}

const COLOR_OVERRIDE_MAP: ReadonlyArray<[keyof ChartColorOverrides, keyof ChartColors]> = [
  ["colorBackground", "background"],
  ["colorGrid", "grid"],
  ["colorScaleText", "text"],
  ["colorCrosshair", "crosshair"],
  ["colorBidLine", "bidLine"],
  ["colorAskLine", "askLine"],
  ["colorPositionLong", "positionLong"],
  ["colorPositionShort", "positionShort"],
  ["colorOrderLine", "orderLine"],
  ["colorTpLine", "tpLine"],
  ["colorSlLine", "slLine"],
  ["candleUpColor", "up"],
  ["candleDownColor", "down"],
];

/** Theme colors with the user's non-empty overrides applied on top. */
export function mergeChartColors(theme: ChartColors, overrides: ChartColorOverrides): ChartColors {
  const merged = { ...theme };
  for (const [overrideKey, themeKey] of COLOR_OVERRIDE_MAP) {
    const value = overrides[overrideKey];
    if (value) merged[themeKey] = value;
  }
  return merged;
}

/**
 * Armable tools. Some are placement-only aliases that commit a different stored
 * `type`: "ray"/"extended" store a "trendline" with extend flags;
 * "long-position"/"short-position" store a "position" with `side`; "measure" is
 * a transient gesture that never commits.
 */
/** TradingView's cursor tools (the cursor group's first section). */
export type CursorMode = "cross" | "dot" | "arrow" | "demonstration";

export type DrawingTool =
  | "none"
  | "eraser"
  | "trendline"
  | "horizontal"
  | "fibonacci"
  | "rectangle"
  | "vertical"
  | "ray"
  | "extended"
  | "channel"
  | "text"
  | "fibextension"
  | "ellipse"
  | "arrow"
  | "triangle"
  | "position"
  | "long-position"
  | "short-position"
  | "brush"
  | "xabcd"
  | "cypher"
  | "abcd"
  | "headshoulders"
  | "trianglepattern"
  | "threedrives"
  | "elliottimpulse"
  | "elliottcorrection"
  | "elliotttriangle"
  | "elliottdouble"
  | "elliotttriple"
  | "infoline"
  | "horzray"
  | "crossline"
  | "trendangle"
  | "flatbottom"
  | "disjointchannel"
  | "regression"
  | "pitchfork"
  | "schiffpitchfork"
  | "modschiffpitchfork"
  | "insidepitchfork"
  | "cycliclines"
  | "timecycles"
  | "sineline"
  | "forecast"
  | "barspattern"
  | "ghostfeed"
  | "sector"
  | "anchoredvwap"
  | "frvp"
  | "avp"
  | "pricerange"
  | "daterange"
  | "datepricerange"
  | "arrowmarker"
  | "arrowup"
  | "arrowdown"
  | "rotatedrect"
  | "path"
  | "circle"
  | "polyline"
  | "arc"
  | "curve"
  | "doublecurve"
  | "textnote"
  | "pricenote"
  | "pin"
  | "table"
  | "callout"
  | "comment"
  | "pricelabel"
  | "signpost"
  | "flagmark"
  | "image"
  | "icon"
  | "emoji"
  | "highlighter"
  | "fibextension3"
  | "fibchannel"
  | "fibtimezone"
  | "fibspeedfan"
  | "fibtime"
  | "fibcircles"
  | "fibspiral"
  | "fibarcs"
  | "fibwedge"
  | "pitchfan"
  | "gannbox"
  | "gannfixed"
  | "gannsquare"
  | "gannfan"
  | "measure";

/** Stored drawing kinds (excludes placement-only aliases). */
export type DrawingType = Exclude<
  DrawingTool,
  "none" | "ray" | "extended" | "infoline" | "long-position" | "short-position" | "measure"
>;

export type DrawingLineStyle = "solid" | "dashed" | "dotted";

/** Magnet snapping mode: off, weak (snap within a few px), or strong (always). */
export type MagnetMode = "none" | "weak" | "strong";

export interface DrawingLine {
  id: string;
  type: DrawingType;
  price: number;
  price2?: number;
  time?: number;
  time2?: number;
  /** Third anchor — parallel-channel offset line. */
  price3?: number;
  time3?: number;
  /**
   * Brush, patterns and waves: every anchor, oldest first (time / price
   * mirror the first, time2 / price2 the last).
   */
  points?: { time: number; price: number }[];
  color: string;
  // v2 style/behavior fields — all optional so v1 drawings load unchanged
  /** Line width in px (default 2). */
  width?: number;
  lineStyle?: DrawingLineStyle;
  /** Locked drawings can be selected but not moved or resized. */
  locked?: boolean;
  /** Signpost: the label's height, percent of the way from the bar to the pane edge (negative: below). */
  signpostPos?: number;
  /** Image: the picture (a data URL) and its size on the chart in CSS px. */
  imageUrl?: string;
  cssWidth?: number;
  cssHeight?: number;
  /** Image: the picture's natural size (resizing keeps its aspect). */
  naturalWidth?: number;
  naturalHeight?: number;
  /** Icon (a Font Awesome code point) / Emoji (the character), its size in px and angle (rad, π/2 upright). */
  icon?: number;
  emoji?: string;
  iconSize?: number;
  angle?: number;
  /** Ghost feed: each leg's generated bars (price offsets), their average high−low and variance (%). */
  ghostBars?: [number, number, number, number][][];
  averageHL?: number;
  variance?: number;
  /** Bars pattern: the copied bars [open, high, low, close], how they draw, mirrored / flipped. */
  pattern?: [number, number, number, number][];
  barsMode?: "bars" | "openclose" | "line" | "lineopen" | "linehigh" | "linelow" | "linehl2";
  mirrored?: boolean;
  flipped?: boolean;
  /** Trend angle: its length on screen (px); its angle is `angle`. */
  distance?: number;
  /** Gann square: the price-per-bar ratio its box keeps. */
  scaleRatio?: number;
  /** Gann box: measure the levels from the second point. */
  reverse?: boolean;
  /** Fib spiral: turn counterclockwise. */
  counterclockwise?: boolean;
  /** Table: cell texts, row by row. */
  cells?: string[][];
  /** Info line: the trend line's stats stay shown, not just while selected. */
  alwaysShowStats?: boolean;
  /** Trendline only: extend the line to the pane edges. */
  extendLeft?: boolean;
  extendRight?: boolean;
  /** Hidden drawings stay in the object tree but don't render or hit-test. */
  hidden?: boolean;
  /** Render order — higher draws on top. Defaults to creation order. */
  zIndex?: number;
  /** Timeframe the drawing was created on (used by visibility "tf"). */
  createdTf?: string;
  /** "all" (default) shows on every timeframe; "tf" only on createdTf. */
  visibility?: "all" | "tf";
  // ── Styling depth (Tier 4) ──
  /** Fill colour for shapes / channel / fib bands (defaults to `color`). */
  fillColor?: string;
  /** Fill opacity 0–1 (defaults per drawing kind). */
  fillOpacity?: number;
  /** Arrowheads on line ends (trendline / arrow). */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** Text content + size for text/callout drawings and attachable labels. */
  text?: string;
  fontSize?: number;
  /** Bold / italic styling for text drawings. */
  bold?: boolean;
  italic?: boolean;
  /** Optional text-box background (text drawings). */
  /** Colour of a line tool's text label (defaults to the line colour). */
  textColor?: string;
  textBg?: boolean;
  textBgColor?: string;
  /** Optional text-box border (text drawings). */
  textBorder?: boolean;
  textBorderColor?: string;
  /** Trend line Δprice / % / bars / angle readout (TradingView default off). */
  showStats?: boolean;
  /** Custom fibonacci levels (fractions); defaults applied when absent. */
  fibLevels?: number[];
  // ── Position tool (long/short risk-reward) ──
  side?: "long" | "short";
  /** Stop-loss price (position tool). */
  stopPrice?: number;
  /** Take-profit price (position tool). */
  targetPrice?: number;
  /** % of the account risked (TradingView default 25). */
  riskPct?: number;
  /** Position tool account size (TradingView default 1000). */
  accountSize?: number;
  /** Position tool lot size (default 1). */
  lotSize?: number;
  /** Position tool leverage cap on quantity (default 10 000). */
  leverage?: number;
  // ── Price alerts on lines ──
  /** When set, the platform alerts when price crosses this line. */
  alertEnabled?: boolean;
  alertMessage?: string;
}

/** Swatch palette for the floating drawing toolbar (TradingView-style). */
export const DRAWING_COLORS = [
  "#2962ff",
  "#f0b90b",
  "#089981",
  "#f23645",
  "#9c27b0",
  "#ff9800",
  "#787b86",
  "#ffffff",
] as const;

export const DRAWING_WIDTHS = [1, 2, 3, 4] as const;

/** One bar of `tf` in milliseconds (months count as 30 days). */
export function timeframeMs(tf: string): number {
  return timeframeSeconds(tf) * 1000;
}

export const KNOWN_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "JPY",
  "AUD",
  "NZD",
  "CAD",
  "CHF",
  "CNY",
  "HKD",
  "SGD",
  "SEK",
  "NOK",
  "MXN",
  "ZAR",
  "TRY",
  "PLN",
  "CZK",
  "HUF",
  "DKK",
];

export interface NewsOverlayConfig {
  enabled: boolean;
  lineColor: string;
  showPast: boolean;
  showFuture: boolean;
  showHigh: boolean;
  showMedium: boolean;
  showLow: boolean;
}

export interface EconomicEvent {
  time: string;
  currency: string;
  impact: "low" | "medium" | "high";
  event: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

/**
 * Placeholder economic events for the fallback calendar view. The default
 * calendar is TradingView's live widget; this table is what the toggle shows
 * when that is turned off, and is labelled as sample data in the UI.
 */
export const MOCK_EVENTS: EconomicEvent[] = [
  {
    time: "08:30",
    currency: "USD",
    impact: "high",
    event: "Non-Farm Payrolls",
    forecast: "180K",
    previous: "175K",
  },
  {
    time: "10:00",
    currency: "USD",
    impact: "medium",
    event: "ISM Manufacturing PMI",
    forecast: "49.8",
    previous: "49.2",
  },
  {
    time: "14:00",
    currency: "EUR",
    impact: "high",
    event: "ECB Interest Rate Decision",
    forecast: "4.50%",
    previous: "4.50%",
  },
  {
    time: "08:00",
    currency: "GBP",
    impact: "medium",
    event: "GDP m/m",
    forecast: "0.2%",
    previous: "0.1%",
  },
  {
    time: "21:30",
    currency: "JPY",
    impact: "low",
    event: "Unemployment Rate",
    forecast: "2.5%",
    previous: "2.5%",
  },
  { time: "15:30", currency: "USD", impact: "high", event: "FOMC Statement" },
  {
    time: "02:00",
    currency: "CNY",
    impact: "medium",
    event: "CPI y/y",
    forecast: "0.3%",
    previous: "0.2%",
  },
];

export interface NewsItem {
  time: string;
  title: string;
  source: string;
  impact: "bullish" | "bearish" | "neutral";
}

/**
 * Placeholder headlines for the News tab. OpenCharts ships no news feed, so
 * these exist only to show the panel's shape — they carry a "Sample" source
 * rather than a real outlet's name, and the tab labels them as sample data.
 */
export const MOCK_NEWS: NewsItem[] = [
  {
    time: "2m ago",
    title: "Fed signals potential rate cut in September meeting",
    source: "Sample",
    impact: "bullish",
  },
  {
    time: "15m ago",
    title: "EUR/USD breaks above key resistance at 1.0950",
    source: "Sample",
    impact: "bullish",
  },
  {
    time: "32m ago",
    title: "Oil prices surge on OPEC+ production cut extension",
    source: "Sample",
    impact: "neutral",
  },
  {
    time: "1h ago",
    title: "Bank of Japan maintains ultra-loose monetary policy",
    source: "Sample",
    impact: "bearish",
  },
  {
    time: "2h ago",
    title: "US Treasury yields climb ahead of jobs data",
    source: "Sample",
    impact: "bearish",
  },
  {
    time: "3h ago",
    title: "Gold hits record high amid geopolitical tensions",
    source: "Sample",
    impact: "bullish",
  },
];
