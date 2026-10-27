import type { BitmapCoordinatesRenderingScope, CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

/**
 * TradingView's Demonstration cursor: a translucent red disc follows the
 * mouse, and Alt + drag leaves a wide red trail (its "Presentation
 * highlighter") that fades out over four seconds once the button is released.
 * Trails are anchored to bar / price like any drawing, so they move with
 * the chart while they fade.
 */

// The crosshair demonstration constants (LineWidth, CircleBorderWidth, AnimationDuration).
const LINE_WIDTH = 36;
const CIRCLE_BORDER = 1;
const FADE_MS = 4000;
const BACK = "rgba(242, 54, 69, 0.25)"; // ripe-red-500 at .25
const BORDER = "rgba(242, 54, 69, 0.03)"; // ripe-red-500 at .03

type Anchor = { logical: number; price: number };
interface Trail {
  pts: Anchor[];
  finishedAt: number | null;
}

class View implements ISeriesPrimitivePaneView {
  constructor(private readonly src: DemonstrationPrimitive) {}
  zOrder() {
    return "top" as const;
  }
  renderer(): ISeriesPrimitivePaneRenderer {
    return { draw: (target: CanvasRenderingTarget2D) => target.useBitmapCoordinateSpace((s) => this.src.draw(s)) };
  }
}

export class DemonstrationPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views = [new View(this)];
  private enabled = false;
  private origin: { x: number; y: number } | null = null;
  private trails: Trail[] = [];
  private active: Trail | null = null;
  private raf = 0;

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    cancelAnimationFrame(this.raf);
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.origin = null;
    this.requestUpdate?.();
  }

  /** The pointer (pane px), or null when it leaves the pane. */
  setOrigin(p: { x: number; y: number } | null): void {
    if (!this.enabled) return;
    this.origin = p;
    if (this.active && p) this.addPoint(p);
    this.requestUpdate?.();
  }

  isDrawing(): boolean {
    return this.active !== null;
  }

  start(p: { x: number; y: number }): void {
    this.active = { pts: [], finishedAt: null };
    this.trails.push(this.active);
    this.addPoint(p);
    this.requestUpdate?.();
  }

  finish(): void {
    if (!this.active) return;
    this.active.finishedAt = performance.now();
    this.active = null;
    this.animate();
  }

  private addPoint(p: { x: number; y: number }): void {
    const logical = this.chart?.timeScale().coordinateToLogical(p.x);
    const price = this.series?.coordinateToPrice(p.y);
    if (logical == null || price == null) return;
    this.active?.pts.push({ logical, price });
  }

  // Repaint while any trail is fading; drop the ones that are gone.
  private animate(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      const now = performance.now();
      this.trails = this.trails.filter((t) => t.finishedAt === null || now - t.finishedAt < FADE_MS);
      this.requestUpdate?.();
      if (this.trails.some((t) => t.finishedAt !== null)) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  draw(scope: BitmapCoordinatesRenderingScope): void {
    const ctx = scope.context;
    const ts = this.chart?.timeScale();
    const series = this.series;
    if (!ts || !series) return;
    ctx.save();
    ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
    const now = performance.now();
    for (const t of this.trails) {
      const pts: { x: number; y: number }[] = [];
      for (const a of t.pts) {
        const x = ts.logicalToCoordinate(a.logical as Logical);
        const y = series.priceToCoordinate(a.price);
        if (x !== null && y !== null) pts.push({ x, y });
      }
      if (pts.length === 0) continue;
      ctx.globalAlpha = 1 - (t.finishedAt === null ? 0 : Math.min(1, (now - t.finishedAt) / FADE_MS));
      ctx.strokeStyle = BACK;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      if (pts.length === 1) ctx.lineTo(pts[0]!.x + 0.01, pts[0]!.y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (this.enabled && this.origin) {
      ctx.beginPath();
      ctx.arc(this.origin.x, this.origin.y, LINE_WIDTH / 2, 0, 2 * Math.PI);
      ctx.fillStyle = BACK;
      ctx.fill();
      ctx.lineWidth = CIRCLE_BORDER;
      ctx.strokeStyle = BORDER;
      ctx.stroke();
    }
    ctx.restore();
  }
}
