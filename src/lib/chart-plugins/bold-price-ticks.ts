import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView } from "lightweight-charts";
import { PluginBase } from "./plugin-base";

/**
 * TradingView prints its "round" price-scale labels in bold (350.00 among
 * 346 … 352, 300.00 among 260 … 320). lightweight-charts draws every label
 * the same, so this rebuilds its tick marks with the same algorithm, picks
 * the bold ones by TradingView's rule and redraws those labels in bold over
 * the regular ones.
 */

// lightweight-charts' price-axis metrics for a 12px font.
const FONT_SIZE = 12;
const TICK_MARK_HEIGHT = Math.ceil(FONT_SIZE * 2.5);
const TEXT_LEFT = 5 + (FONT_SIZE / 12) * 5; // tick length + inner padding
const EPS = 1e-14;

const ge = (a: number, b: number) => a - b > -EPS;

/** lightweight-charts' PriceTickSpanCalculator.tickSpan. */
function spanFor(base: number, integral: number[], high: number, low: number, maxSpan: number): number {
  const minMove = base === 0 ? 0 : 1 / base;
  let span = Math.pow(10, Math.max(0, Math.ceil(Math.log10(high - low))));
  let i = 0;
  let c = integral[0]!;
  while (ge(span, minMove) && span > minMove + EPS && ge(span, maxSpan * c) && ge(span, 1)) {
    span /= c;
    c = integral[++i % integral.length]!;
  }
  if (span <= minMove + EPS) span = minMove;
  span = Math.max(1, span);
  const fractional = fractionalDividers(base);
  if (fractional.length > 0 && Math.abs(span - 1) < EPS) {
    i = 0;
    c = fractional[0]!;
    while (ge(span, maxSpan * c) && span > minMove + EPS) {
      span /= c;
      c = fractional[++i % fractional.length]!;
    }
  }
  return span;
}

function fractionalDividers(base: number): number[] {
  if (Math.log10(base) % 1 === 0) return [2, 2.5, 2];
  const out: number[] = [];
  for (let rest = base; rest !== 1 && out.length < 100; ) {
    if (rest % 2 === 0) {
      out.push(2);
      rest /= 2;
    } else if (rest % 5 === 0) {
      out.push(2, 2.5);
      rest /= 5;
    } else break;
  }
  return out;
}

/** The tick values lightweight-charts labels, top to bottom. */
export function priceTicks(high: number, low: number, height: number, base: number): number[] {
  if (!(high > low) || height <= 0) return [];
  const maxSpan = ((high - low) * TICK_MARK_HEIGHT) / height;
  const span = Math.min(
    spanFor(base, [2, 2.5, 2], high, low, maxSpan),
    spanFor(base, [2, 2, 2.5], high, low, maxSpan),
    spanFor(base, [2.5, 2, 2], high, low, maxSpan),
  );
  let mod = high % span;
  mod += mod < 0 ? span : 0;
  const out: number[] = [];
  for (let v = high - mod; v > low; v -= span) out.push(v);
  return out;
}

/**
 * TradingView's choice of bold ticks among `ticks` (its tick-mark builder):
 * in whole units of the price scale's `base`, keep the ticks divisible by
 * 10 or 5, else 2, until at most half of them are left.
 */
export function boldTicks(ticks: number[], base: number): number[] {
  if (ticks.length <= 1) return [];
  const span = Math.abs(ticks[0]! - ticks[1]!);
  const scale = base || Math.pow(10, -Math.ceil(Math.log10(span)));
  let ints = ticks.map((v) => Math.round(v * scale));
  let mult = 1;
  const enough = (c: number[]) => ticks.length > 6 && (ticks.length + 1) / c.length >= 2;
  const back = (c: number[]) => c.map((v) => (v * mult) / scale);
  for (let step = 0; step < 30; step++) {
    if (enough(ints)) return back(ints);
    let found = false;
    for (const group of [[10, 5], [2]]) {
      const options = group.map((divider) => ({ divider, values: ints.filter((v) => Math.abs(v) % divider === 0) }));
      const good = options.filter((o) => enough(o.values));
      const pick =
        good.length > 0
          ? good.reduce((a, b) => (b.values.length > a.values.length ? b : a))
          : (options.find((o) => o.values.length > 0) ?? options[0]!);
      if (pick.values.length > 0) {
        ints = pick.values.map((v) => v / pick.divider);
        mult *= pick.divider;
        found = true;
        break;
      }
    }
    if (!found) return ints.length === ticks.length ? [] : back(ints);
  }
  return [];
}

class BoldTicksView implements ISeriesPrimitivePaneView {
  constructor(private readonly _source: BoldPriceTicks) {}

  // After lightweight-charts' tick labels, before the price labels.
  zOrder(): "normal" {
    return "normal";
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    const src = this._source;
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        const series = src.series;
        const height = src.chart.paneSize().height;
        const top = series.coordinateToPrice(0);
        const bottom = series.coordinateToPrice(height - 1);
        if (top === null || bottom === null) return;
        const ticks = priceTicks(Math.max(top, bottom), Math.min(top, bottom), height, src.base);
        const bold = boldTicks(ticks, src.base);
        if (bold.length === 0) return;
        const format = series.priceFormatter();
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          for (const v of bold) {
            const y = series.priceToCoordinate(v);
            if (y === null) continue;
            const label = format.format(v);
            ctx.font = `${FONT_SIZE}px ${src.fontFamily}`;
            const m = ctx.measureText(label);
            const yMid = ((m.actualBoundingBoxAscent || 0) - (m.actualBoundingBoxDescent || 0)) / 2;
            ctx.fillStyle = src.background;
            ctx.fillRect(TEXT_LEFT - 1, y - FONT_SIZE / 2 - 2, mediaSize.width - TEXT_LEFT + 1, FONT_SIZE + 4);
            ctx.font = `bold ${FONT_SIZE}px ${src.fontFamily}`;
            ctx.fillStyle = src.textColor;
            ctx.fillText(label, TEXT_LEFT, y + yMid);
          }
        });
      },
    };
  }
}

export class BoldPriceTicks extends PluginBase {
  private readonly _views = [new BoldTicksView(this)];

  constructor(
    readonly fontFamily: string,
    public textColor: string,
    public background: string,
    /** 1 / minMove, as lightweight-charts' price scale uses it. */
    readonly base: number,
  ) {
    super();
  }

  /** A theme change recolours the ticks in place. */
  setColors(textColor: string, background: string): void {
    this.textColor = textColor;
    this.background = background;
    this.requestUpdate();
  }

  priceAxisPaneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._views;
  }
}
