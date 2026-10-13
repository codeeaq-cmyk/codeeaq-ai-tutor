import { describe, expect, it } from "vitest";
import { DIAGRAM_HEIGHT } from "@codeeaq/shared-types";
import { band } from "./band";

describe("band", () => {
  it("keeps the whole canvas for a diagram that fills it, or has nothing on it", () => {
    expect(band([])).toEqual({ top: 0, height: DIAGRAM_HEIGHT });
    expect(band([{ type: "rect", x: 10, y: 5, w: 380, h: 230 }])).toEqual({ top: 0, height: DIAGRAM_HEIGHT });
  });

  it("leaves off the empty band above and below a small drawing", () => {
    // One picture in the middle of the canvas, with its label underneath.
    expect(band([{ type: "picture", x: 200, y: 120, picture: "🧩", label: "A puzzle" }])).toEqual({ top: 82, height: 95 });
    // A line and the text above it.
    expect(
      band([
        { type: "line", x1: 40, y1: 150, x2: 360, y2: 150, arrow: true },
        { type: "text", x: 200, y: 120, text: "Current" },
      ]),
    ).toEqual({ top: 96, height: 68 });
  });

  it("is never too shallow to hold a line of text, and never leaves the canvas", () => {
    expect(band([{ type: "line", x1: 40, y1: 120, x2: 360, y2: 120 }])).toEqual({ top: 92, height: 56 });
    expect(band([{ type: "line", x1: 40, y1: 238, x2: 360, y2: 238 }])).toEqual({ top: DIAGRAM_HEIGHT - 56, height: 56 });
    expect(band([{ type: "circle", x: 200, y: 20, r: 60 }])).toEqual({ top: 0, height: 94 });
  });
});
