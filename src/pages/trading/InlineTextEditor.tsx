import { useEffect, useRef, useState } from "react";
import { editingText, tableEdit, textBoxes } from "../../lib/chart-plugins/drawing-tools/annotationtools.ts";
import type { DrawingLine } from "./constants.ts";

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

// Each tool's default text colour (its factory textColor / color).
const TEXT_COLOR: Record<string, string> = {
  textnote: "#000000",
  pin: "#000000",
  table: "#000000",
  signpost: "#000000",
  callout: "#ffffff",
  comment: "#ffffff",
};

/**
 * TradingView's in-place text editing: the text is typed right where it is
 * drawn. The canvas leaves the drawing's text out while this transparent
 * text area sits exactly over the box the renderer last drew, in the same
 * font, and follows it as the chart moves. Esc or clicking away finishes.
 */
export function InlineTextEditor({
  drawing,
  cell,
  onChange,
  onClose,
  onRepaint,
}: {
  drawing: DrawingLine;
  cell?: [number, number];
  onChange: (d: DrawingLine) => void;
  onClose: () => void;
  /** Ask the chart to redraw (the canvas must drop / restore the text). */
  onRepaint: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The click that placed the drawing ends after the editor opens; its
  // mouseup must not count as clicking away.
  const [openedAt] = useState(() => performance.now());
  const [box, setBox] = useState(() => textBoxes.get(drawing.id) ?? null);
  const id = drawing.id;
  const [row, col] = cell ?? [-1, -1];

  useEffect(() => {
    editingText.add(id);
    if (row >= 0) tableEdit.set(id, [row, col]);
    onRepaint();
    let raf = 0;
    const follow = () => {
      const b = textBoxes.get(id) ?? null;
      setBox((prev) => (prev && b && prev.x === b.x && prev.y === b.y && prev.w === b.w && prev.h === b.h ? prev : b));
      raf = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(raf);
      editingText.delete(id);
      tableEdit.delete(id);
      onRepaint();
    };
    // The editor lives for one drawing / cell; onRepaint is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, row, col]);

  const cells = drawing.cells ?? [["", "", ""], ["", "", ""], ["", "", ""]];
  const value = row >= 0 ? (cells[row]?.[col] ?? "") : (drawing.text ?? "");
  const setValue = (text: string) => {
    if (row >= 0) {
      const next = cells.map((r) => [...r]);
      next[row]![col] = text;
      onChange({ ...drawing, cells: next });
    } else {
      onChange({ ...drawing, text });
    }
  };
  // The box is known only once the canvas has drawn the new text drawing.
  if (!box) return null;
  const size = box.fontSize;
  const lines = Math.max(1, value.split("\n").length);
  return (
    <textarea
      ref={ref}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
      onBlur={(e) => {
        if (performance.now() - openedAt < 400) {
          const el = e.currentTarget;
          requestAnimationFrame(() => el.focus());
          return;
        }
        onClose();
      }}
      spellCheck={false}
      className="absolute z-20 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        left: box.x,
        top: box.y,
        width: Math.max(box.w, 8) + size,
        height: Math.max(box.h, lines * size),
        font: `${drawing.italic ? "italic " : ""}${drawing.bold ? "bold " : ""}${size}px ${FONT}`,
        lineHeight: `${size}px`,
        color: drawing.textColor ?? TEXT_COLOR[drawing.type] ?? "#000000",
        caretColor: drawing.textColor ?? TEXT_COLOR[drawing.type] ?? "#000000",
      }}
    />
  );
}
