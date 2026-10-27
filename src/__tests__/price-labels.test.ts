import { describe, expect, it } from "vitest";
import { alignLabels } from "../lib/chart-plugins/countdown-label.ts";

describe("price-axis label alignment (TradingView's _fixLabelOverlap)", () => {
  it("leaves labels that do not touch alone", () => {
    const boxes = [{ top: 100, height: 18 }, { top: 300, height: 18 }];
    alignLabels(boxes, 800);
    expect(boxes.map((b) => b.top)).toEqual([100, 300]);
  });

  it("pushes the label further from the centre outwards", () => {
    // Above the centre: the lower one (nearer the centre) stays put.
    const up = [{ top: 200, height: 32 }, { top: 190, height: 18 }];
    alignLabels(up, 800);
    expect(up.map((b) => b.top)).toEqual([200, 182]);
    // Below the centre: the upper one stays, the other moves down.
    const down = [{ top: 600, height: 32 }, { top: 610, height: 18 }];
    alignLabels(down, 800);
    expect(down.map((b) => b.top)).toEqual([600, 632]);
  });

  it("pulls a label hugging an edge inside the scale", () => {
    const boxes = [{ top: -5, height: 18 }];
    alignLabels(boxes, 800);
    expect(boxes[0]!.top).toBe(0);
  });
});
