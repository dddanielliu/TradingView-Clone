import { ANNOTATION_TOOLS } from "./annotationtools";
import { ICON_TOOLS } from "./icontools";
import { FIB_TOOLS } from "./fibtools";
import { LINE_TOOLS } from "./linetools";
import { MEASURE_TOOLS } from "./measuretools";
import { SHAPE_TOOLS } from "./shapetools";
import { PATTERNS } from "./patterns";

/**
 * Drawings kept as a list of anchors and placed a click per anchor: the
 * chart patterns, Elliott waves and the extra line tools. Returns how many
 * anchors the tool takes (0: any number, finished by a double-click or
 * Esc) and its default colour, or null for other tools.
 */
export function pointToolSpec(type: string): { points: number; color: string } | null {
  const spec = (PATTERNS as Record<string, { points: number; color: string }>)[type] ??
    (LINE_TOOLS as Record<string, { points: number; color: string }>)[type] ??
    (FIB_TOOLS as Record<string, { points: number; color: string }>)[type] ??
    (MEASURE_TOOLS as Record<string, { points: number; color: string }>)[type] ??
    (SHAPE_TOOLS as Record<string, { points: number; color: string }>)[type] ??
    (ANNOTATION_TOOLS as Record<string, { points: number; color: string }>)[type] ??
    (ICON_TOOLS as Record<string, { points: number; color: string }>)[type];
  return spec ? { points: spec.points, color: spec.color } : null;
}
