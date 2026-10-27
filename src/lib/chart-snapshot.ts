import type { IChartApi } from "lightweight-charts";

/**
 * Chart snapshots as TradingView takes them (take-chart-image-impl and the
 * chart widget collection's client snapshot): the chart's panes and axes in
 * a padded frame, a header line, the legend drawn over the pane, and a
 * footer with the logo, to download or copy as a PNG. (The link, new-tab
 * and post options need TradingView's image hosting and are not offered.)
 */

// SnapshotConstants
const LEGEND_TOP_MARGIN = 10;
const LEGEND_LEFT_MARGIN = 8;
const LINE_SPACING = 1.4;
const FONT_SIZE = 12;
const PADDING = 10;
const FOOTER_HEIGHT = 60;
const LOGO_HEIGHT = 28;

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

/** One legend value: an optional title ("O") in the text colour, then the value in its colour. */
export interface LegendValue {
  title?: string;
  value: string;
  color?: string;
}

/** A legend line: the source's text, then its values. */
export interface LegendLine {
  text: string;
  values: LegendValue[];
}

export interface SnapshotOptions {
  /** The header lines (TradingView: "<user> created with <site>, <date>"). */
  header: string[];
  /** The main pane's legend: the series, then the studies. */
  legend: LegendLine[];
  colors: { background: string; border: string; text: string };
  /** The footer's wordmark. */
  brand: string;
}

type Run = { text: string; color?: string };

/** Xt: the source text, then for each value "  " + title + value. */
function legendRuns(line: LegendLine): Run[] {
  const runs: Run[] = [{ text: line.text.trim() }];
  for (const v of line.values) {
    if (runs[runs.length - 1]!.text !== "") runs.push({ text: "  " });
    if (v.title) runs.push({ text: v.title });
    runs.push({ text: v.value, color: v.color });
  }
  return runs;
}

/**
 * drawLegendLine: draws the runs from `at`, elided with "..." when they pass
 * `maxX`. Returns where the text ended.
 */
function drawLegendLine(ctx: CanvasRenderingContext2D, pr: number, at: { x: number; y: number }, maxX: number, runs: Run[]): number {
  const all = runs.map((r) => r.text).join("");
  let text = all;
  let elided = false;
  if (ctx.measureText(all).width * pr > maxX - at.x) {
    const dots = ctx.measureText("...").width * pr;
    let n = all.length;
    while (n > 0 && ctx.measureText(all.slice(0, n)).width * pr + dots > maxX - at.x) n--;
    text = all.slice(0, n).trim();
    elided = true;
  }
  let x = at.x;
  const put = (s: string) => {
    ctx.save();
    ctx.scale(pr, pr);
    ctx.fillText(s, x / pr, at.y / pr);
    ctx.restore();
    x += ctx.measureText(s).width * pr;
  };
  let used = 0;
  for (const r of runs) {
    if (used + r.text.length > text.length) break;
    if (r.color) {
      ctx.save();
      ctx.fillStyle = r.color;
      put(r.text);
      ctx.restore();
    } else put(r.text);
    used += r.text.length;
  }
  if (elided) put("...");
  return x;
}

/** The client snapshot: header, chart (with its legend and a border), footer. */
export function composeSnapshot(chart: IChartApi, o: SnapshotOptions): HTMLCanvasElement {
  const shot = chart.takeScreenshot();
  const pr = window.devicePixelRatio || 1;
  const pad = Math.round(PADDING * pr);
  const lineH = Math.ceil(FONT_SIZE * LINE_SPACING * pr);
  const headerH = lineH * o.header.length;
  const footerH = Math.round(FOOTER_HEIGHT * pr);
  const width = pad + shot.width + pad;
  const height = headerH + pad + shot.height + footerH;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = o.colors.background;
  ctx.fillRect(0, 0, width, height);
  // Header lines, from the padding corner.
  ctx.fillStyle = o.colors.text;
  o.header.forEach((h, i) => drawLegendLine(ctx, pr, { x: pad, y: pad + lineH * i }, width, [{ text: h }]));
  // The chart, its legend over the main pane, and its border.
  const chartTop = headerH;
  ctx.save();
  ctx.translate(pad, chartTop + pad);
  ctx.drawImage(shot, 0, 0);
  ctx.fillStyle = o.colors.text;
  const paneW = chart.timeScale().width() * pr;
  const priceAxisLeft = chart.priceScale("left").width() * pr;
  let y = Math.round(LEGEND_TOP_MARGIN * pr);
  const x = priceAxisLeft + Math.round(LEGEND_LEFT_MARGIN * pr);
  const paneH = chart.paneSize().height * pr;
  for (const line of o.legend) {
    if (y + lineH >= paneH) break;
    drawLegendLine(ctx, pr, { x, y }, priceAxisLeft + paneW, legendRuns(line));
    y += lineH;
  }
  ctx.strokeStyle = o.colors.border;
  ctx.strokeRect(0, 0, shot.width, shot.height);
  ctx.restore();
  // Footer: the wordmark, vertically centred in it.
  const logoH = Math.round(LOGO_HEIGHT * pr);
  ctx.save();
  ctx.fillStyle = o.colors.text;
  ctx.font = `bold ${Math.round(20 * pr)}px ${FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.fillText(o.brand, pad, chartTop + pad + shot.height + Math.round(footerH / 2 - logoH / 2) + logoH / 2);
  ctx.restore();
  return canvas;
}

/** "BTCUSDT_2026-10-27_09-13-18.png": the short symbol and the local date and time. */
export function snapshotFileName(symbol: string, now = new Date()): string {
  const short = symbol.slice(symbol.indexOf(":") + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  return `${short}_${date}_${time}.png`;
}

/** downloadFile: a hidden link to the data URL, clicked. */
export function downloadSnapshot(canvas: HTMLCanvasElement, name: string): void {
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = canvas.toDataURL();
  a.download = name;
  a.click();
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Unable to generate blob")))));

/**
 * copyToClipboardClientScreenshot: the PNG to the clipboard; if that is not
 * allowed, it opens in a new tab instead.
 */
export async function copySnapshotImage(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(canvas) })]);
    return true;
  } catch {
    window.open()?.document.write(`<img width="100%" src="${canvas.toDataURL()}"/>`);
    return false;
  }
}
