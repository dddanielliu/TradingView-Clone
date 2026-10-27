import { dist, distToSegment, type Pt, pointInBox } from "./geometry";
import { imageCorners, textBoxes } from "./annotationtools";
import { hitFibArcs, hitFibCircles, hitRayFan, hitSpeedFan, hitSpiral, pitchfanTargets } from "./fibtools";
import { gannBox, hitGannSquare } from "./gann";
import { hitIconTool } from "./icontools";
import { curvePath, sampleCurve } from "./shapetools";
import { hitSector } from "./measuretools";
import { hitForecast } from "./forecast";
import type { Hit, PriceKey, ResolvedEntry, TimeKey } from "./types";

// TradingView's interaction tolerances (mouse / touch): an anchor is hit
// within its radius (6 / 13) plus 2 / 13; a line or curve within 3 / 13 plus
// half its width.
const MOUSE = { anchorRadius: 6, anchor: 2, line: 3, curve: 3 };
const TOUCH = { anchorRadius: 13, anchor: 13, line: 13, curve: 13 };

/** Pixel tolerances for one drawing. */
interface Tol {
  handle: number;
  line: number;
  curve: number;
}

/**
 * Topmost (last-drawn) drawing wins, matching visual stacking order.
 * `scale` > 1 means touch input.
 */
export function hitTest(entries: ResolvedEntry[], p: Pt, scale = 1): Hit | null {
  const t = scale > 1 ? TOUCH : MOUSE;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    const half = (e.d.width ?? 2) / 2;
    const hit = hitEntry(e, p, { handle: t.anchorRadius + t.anchor, line: t.line + half, curve: t.curve });
    if (hit) return hit;
  }
  return null;
}

function hitEntry(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  switch (e.d.type) {
    case "trendline":
      return hitTrendline(e, p, tol);
    case "horizontal":
      return hitHorizontal(e, p, tol);
    case "rectangle":
      return hitRectangle(e, p, tol);
    case "fibonacci":
      return hitFibonacci(e, p, tol);
    case "position":
      return hitPosition(e, p, tol);
    case "arrow":
      return hitTrendline(e, p, tol);
    case "fibextension":
      return hitFibonacci(e, p, tol);
    case "vertical":
      return hitVertical(e, p, tol);
    case "channel":
      return hitChannel(e, p, tol);
    case "ellipse":
    case "triangle":
      return hitBoxShape(e, p, tol);
    case "text":
      return hitText(e, p, tol);
    case "brush":
    case "highlighter":
      return hitBrush(e, p, tol);
    case "arrowmarker":
    case "arrowup":
    case "arrowdown":
    case "rotatedrect":
    case "path":
    case "circle":
    case "polyline":
    case "arc":
      return hitVertices(e, p, tol) ?? hitBrush(e, p, tol) ?? hitHull(e, p);
    case "curve":
    case "doublecurve": {
      const v = hitVertices(e, p, tol);
      const [a, b, c, d] = e.pts ?? [];
      if (v || !a || !b) return v;
      const line = c ? sampleCurve(curvePath(e.d.type, a, b, c, d)) : [a, b];
      for (let i = 1; i < line.length; i++) {
        if (distToSegment(p, line[i - 1]!, line[i]!) <= tol.line) return { id: e.d.id, region: { kind: "body" } };
      }
      return null;
    }
    case "xabcd":
    case "cypher":
    case "abcd":
    case "headshoulders":
    case "trianglepattern":
    case "threedrives":
    case "elliottimpulse":
    case "elliottcorrection":
    case "elliotttriangle":
    case "elliottdouble":
    case "elliotttriple":
      return hitVertices(e, p, tol) ?? hitBrush(e, p, tol);
    case "horzray": {
      const a = e.pts?.[0];
      if (!a) return null;
      if (dist(p, a) <= tol.handle) return { id: e.d.id, region: { kind: "vertex", index: 0 } };
      return Math.abs(p.y - a.y) <= tol.line && p.x >= a.x - tol.line ? bodyHit(e) : null;
    }
    case "crossline": {
      const a = e.pts?.[0];
      if (!a) return null;
      if (dist(p, a) <= tol.handle) return { id: e.d.id, region: { kind: "vertex", index: 0 } };
      return Math.abs(p.y - a.y) <= tol.line || Math.abs(p.x - a.x) <= tol.line ? bodyHit(e) : null;
    }
    case "trendangle":
    case "flatbottom":
    case "disjointchannel":
    case "regression":
    case "pitchfork":
    case "schiffpitchfork":
    case "modschiffpitchfork":
    case "insidepitchfork":
    case "cycliclines":
    case "timecycles":
    case "sineline":
    case "barspattern":
    case "ghostfeed":
    case "anchoredvwap":
    case "avp":
    case "pricerange":
    case "daterange":
    case "datepricerange":
    case "textnote":
    case "pricenote":
    case "pin":
    case "callout":
    case "comment":
    case "pricelabel":
    case "signpost":
    case "flagmark":
      return hitVertices(e, p, tol) ?? hitTextBox(e, p) ?? hitBrush(e, p, tol) ?? hitHull(e, p);
    case "image": {
      const c = e.pts?.[0];
      const { cssWidth: w, cssHeight: h } = e.d;
      if (!c || !w || !h) return null;
      if (e.state === "selected") {
        const corners = imageCorners(c, w, h);
        for (let i = 0; i < 4; i++) if (dist(p, corners[i]!) <= tol.handle) return { id: e.d.id, region: { kind: "imageCorner", index: i } };
      }
      const inside = p.x >= c.x - w / 2 && p.x <= c.x + w / 2 && p.y >= c.y - h / 2 && p.y <= c.y + h / 2;
      return inside ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "table":
      return hitTextBox(e, p) ?? hitVertices(e, p, tol);
    case "gannbox": {
      // Its two points plus the other two corners; inside the box (filled) is the body.
      const [a, b] = e.pts ?? [];
      if (!a || !b) return hitVertices(e, p, tol);
      const corners = [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }];
      for (let i = 0; i < 4; i++) if (dist(p, corners[i]!) <= tol.handle) return { id: e.d.id, region: { kind: "vertex", index: i } };
      const l = Math.min(a.x, b.x) - tol.line;
      const r = Math.max(a.x, b.x) + tol.line;
      const t = Math.min(a.y, b.y) - tol.line;
      const btm = Math.max(a.y, b.y) + tol.line;
      return p.x >= l && p.x <= r && p.y >= t && p.y <= btm ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "gannfixed":
    case "gannsquare": {
      const [a, b] = e.pts ?? [];
      const v = hitVertices(e, p, tol);
      if (v || !a || !b) return v;
      const box = gannBox(e.d.type, a, b, e.d.reverse === true);
      return box && hitGannSquare(p, box.start, box.end, box.start, tol.line, tol.curve) ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "pitchfan": {
      const [a, b, c] = e.pts ?? [];
      const v = hitVertices(e, p, tol);
      if (v || !a || !b) return v;
      if (!c) return hitRayFan(a, [b], p, tol.line, false) ? { id: e.d.id, region: { kind: "body" } } : null;
      const on = distToSegment(p, b, c) <= tol.line || hitRayFan(a, pitchfanTargets(b, c), p, tol.line, true);
      return on ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "fibspeedfan": {
      const [a, b] = e.pts ?? [];
      const v = hitVertices(e, p, tol);
      if (v || !a || !b) return v;
      return hitSpeedFan(a, b, p, tol.line) ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "fibcircles":
    case "fibarcs": {
      const [a, b] = e.pts ?? [];
      const v = hitVertices(e, p, tol);
      if (v || !a || !b) return v;
      if (distToSegment(p, a, b) <= tol.line) return { id: e.d.id, region: { kind: "body" } };
      const on = e.d.type === "fibarcs" ? hitFibArcs(a, b, p, tol.curve) !== null : hitFibCircles(a, b, p, tol.curve);
      return on ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "forecast": {
      const v = hitVertices(e, p, tol);
      const [a, b] = e.pts ?? [];
      if (v || !a || !b) return v;
      return hitForecast(e.d.id, { source: a, target: b }, p) ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "frvp": {
      // Its anchors are the range's high / low corners; the box between them is filled.
      const v = hitVertices(e, p, tol);
      const [a, b] = e.pts ?? [];
      if (v || !a || !b) return v;
      const inside = p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
      return inside ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "sector": {
      const [a, b, c] = e.pts ?? [];
      const v = hitVertices(e, p, tol);
      if (v || !a || !b) return v;
      const on = distToSegment(p, a, b) <= tol.line || (c !== undefined && (distToSegment(p, a, c) <= tol.line || hitSector(a, b, c, p)));
      return on ? { id: e.d.id, region: { kind: "body" } } : null;
    }
    case "fibspiral": {
      const [a, b] = e.pts ?? [];
      const v = hitVertices(e, p, tol);
      if (v || !a || !b) return v;
      const far = { x: b.x + (b.x - a.x) * 1e4, y: b.y + (b.y - a.y) * 1e4 };
      if (distToSegment(p, a, far) <= tol.line || hitSpiral(a, b, e.d.counterclockwise === true, p, tol.curve)) {
        return { id: e.d.id, region: { kind: "body" } };
      }
      return null;
    }
    case "icon":
    case "emoji":
      return hitIconTool(e, p, tol.handle);
    case "fibextension3":
    case "fibchannel":
    case "fibtimezone":
    case "fibtime":
    case "fibwedge":
    case "gannfan":
      return hitVertices(e, p, tol) ?? hitBrush(e, p, tol) ?? hitHull(e, p);
    default:
      return null;
  }
}

// Text tools are also grabbed by their text box.
function hitTextBox(e: ResolvedEntry, p: Pt): Hit | null {
  const r = textBoxes.get(e.d.id);
  if (!r) return null;
  const pad = e.d.type === "table" ? 9 : 8;
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad ? bodyHit(e) : null;
}

// Area tools (fans, circles, channels) are also grabbed inside their anchors' box.
function hitHull(e: ResolvedEntry, p: Pt): Hit | null {
  const pts = e.pts ?? [];
  if (pts.length < 2) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return pointInBox(p, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 0) ? bodyHit(e) : null;
}

// Any anchor of a point-list drawing drags on its own.
function hitVertices(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  const pts = e.pts ?? [];
  for (let i = pts.length - 1; i >= 0; i--) {
    if (dist(p, pts[i]!) <= tol.handle) return { id: e.d.id, region: { kind: "vertex", index: i } };
  }
  return null;
}

// A brush stroke is grabbed anywhere along it and moves as a whole.
function hitBrush(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  const pts = e.pts ?? [];
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(p, pts[i - 1]!, pts[i]!) <= tol.line) return bodyHit(e);
  }
  return null;
}

function hitVertical(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  if (e.x1 === null || Math.abs(p.x - e.x1) > tol.line) return null;
  return { id: e.d.id, region: { kind: "point", timeKey: "time", priceKey: null } };
}

function hitChannel(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  const anchor = anchorHit(e, p, tol);
  if (anchor) return anchor;
  if (e.x1 !== null && e.y3 != null && dist(p, { x: e.x1, y: e.y3 }) <= tol.handle) {
    return { id: e.d.id, region: { kind: "point", timeKey: "time3", priceKey: "price3" } };
  }
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null || e.y3 == null) return null;
  const dy = e.y3 - e.y1;
  const onMain = distToSegment(p, { x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }) <= tol.line;
  const onOff = distToSegment(p, { x: e.x1, y: e.y3 }, { x: e.x2, y: e.y2 + dy }) <= tol.line;
  return onMain || onOff ? bodyHit(e) : null;
}

// Ellipse / triangle: corner anchors resize, body = inside the bounding box.
function hitBoxShape(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return null;
  const corner = rectCornerHit(e, p, tol);
  if (corner) return corner;
  return pointInBox(p, e.x1, e.y1, e.x2, e.y2, tol.line) ? bodyHit(e) : null;
}

function hitText(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  if (e.x1 === null || e.y1 === null) return null;
  const size = e.d.fontSize ?? 14;
  const lines = (e.d.text ?? "Text").split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 4);
  const w = longest * size * 0.6;
  const h = lines.length * size * 1.3;
  const inside =
    p.x >= e.x1 - tol.line &&
    p.x <= e.x1 + w + tol.line &&
    p.y >= e.y1 - tol.line &&
    p.y <= e.y1 + h + tol.line;
  return inside
    ? { id: e.d.id, region: { kind: "point", timeKey: "time", priceKey: "price" } }
    : null;
}

function pointHit(e: ResolvedEntry, timeKey: TimeKey | null, priceKey: PriceKey | null): Hit {
  return { id: e.d.id, region: { kind: "point", timeKey, priceKey } };
}

// Position handles: target / entry / stop on the left edge; the entry's right
// end resizes the width. Body = anywhere inside the entry↔stop↔target span.
function hitPosition(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  const { x1, x2, y1, yStop, yTarget } = e;
  if (x1 === null || x2 === null || y1 === null) return null;
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  // Handles sit on the left edge (target, entry, stop) and at the entry's
  // right end (width), as on TradingView.
  if (yTarget != null && dist(p, { x: xa, y: yTarget }) <= tol.handle) {
    return pointHit(e, null, "targetPrice");
  }
  if (yStop != null && dist(p, { x: xa, y: yStop }) <= tol.handle) {
    return pointHit(e, null, "stopPrice");
  }
  if (dist(p, { x: xa, y: y1 }) <= tol.handle) return pointHit(e, "time", "price");
  if (dist(p, { x: xb, y: y1 }) <= tol.handle) return pointHit(e, "time2", null);
  const ys = [y1, yStop ?? y1, yTarget ?? y1];
  const top = Math.min(...ys);
  const bot = Math.max(...ys);
  const inside =
    p.x >= xa - tol.line && p.x <= xb + tol.line && p.y >= top - tol.line && p.y <= bot + tol.line;
  return inside ? bodyHit(e) : null;
}

function bodyHit(e: ResolvedEntry): Hit {
  return { id: e.d.id, region: { kind: "body" } };
}

/** Anchor-handle check shared by all two-point drawings. */
function anchorHit(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  if (e.x1 !== null && e.y1 !== null && dist(p, { x: e.x1, y: e.y1 }) <= tol.handle) {
    return { id: e.d.id, region: { kind: "point", timeKey: "time", priceKey: "price" } };
  }
  if (e.x2 !== null && e.y2 !== null && dist(p, { x: e.x2, y: e.y2 }) <= tol.handle) {
    return { id: e.d.id, region: { kind: "point", timeKey: "time2", priceKey: "price2" } };
  }
  return null;
}

function hitTrendline(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  const anchor = anchorHit(e, p, tol);
  if (anchor) return anchor;
  const seg =
    e.seg ??
    (e.x1 !== null && e.y1 !== null && e.x2 !== null && e.y2 !== null
      ? { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }
      : null);
  if (!seg) return null;
  const near = distToSegment(p, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }) <= tol.line;
  return near ? bodyHit(e) : null;
}

// A horizontal line only has a price — dragging it anywhere moves the price.
function hitHorizontal(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  if (e.y1 === null || Math.abs(p.y - e.y1) > tol.line) return null;
  return { id: e.d.id, region: { kind: "point", timeKey: null, priceKey: "price" } };
}

function hitRectangle(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  if (e.x1 === null || e.y1 === null || e.x2 === null || e.y2 === null) return null;
  const corner = rectCornerHit(e, p, tol);
  if (corner) return corner;
  return pointInBox(p, e.x1, e.y1, e.x2, e.y2, tol.line) ? bodyHit(e) : null;
}

// Each corner maps to the time/price keys it controls, so dragging a derived
// corner (e.g. x1,y2) resizes via time + price2 like TradingView.
function rectCornerHit(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  const corners = [
    { x: e.x1!, y: e.y1!, timeKey: "time", priceKey: "price" },
    { x: e.x2!, y: e.y2!, timeKey: "time2", priceKey: "price2" },
    { x: e.x1!, y: e.y2!, timeKey: "time", priceKey: "price2" },
    { x: e.x2!, y: e.y1!, timeKey: "time2", priceKey: "price" },
  ] as const;
  for (const c of corners) {
    if (dist(p, c) <= tol.handle) {
      return { id: e.d.id, region: { kind: "point", timeKey: c.timeKey, priceKey: c.priceKey } };
    }
  }
  return null;
}

function hitFibonacci(e: ResolvedEntry, p: Pt, tol: Tol): Hit | null {
  const anchor = anchorHit(e, p, tol);
  if (anchor) return anchor;
  if (e.x1 === null || e.x2 === null || !e.fibLevels) return null;
  if (p.x < Math.min(e.x1, e.x2) - tol.line) return null;
  if (p.x > Math.max(e.x1, e.x2) + tol.line) return null;
  const onLevel = e.fibLevels.some((lvl) => lvl.y !== null && Math.abs(p.y - lvl.y) <= tol.line);
  return onLevel ? bodyHit(e) : null;
}
