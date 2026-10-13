import type { DiagramShape } from "@codeeaq/shared-types";
import { DIAGRAM_HEIGHT } from "@codeeaq/shared-types";

// A diagram is laid out on a canvas of a fixed size, and seldom fills it. The
// empty band above and below what is drawn is left off, so that a small
// drawing does not push the rest of the board down the page. The width is
// kept, and with it the scale: nothing is drawn larger or smaller for it.

const MARGIN = 14;
/** A band is never shallower than this, however little is drawn. */
const LEAST = 56;

/** The top and the bottom of one shape. */
function reach(shape: DiagramShape): [number, number] {
  switch (shape.type) {
    case "circle":
    case "pie":
      return [shape.y - shape.r, shape.y + shape.r];
    case "rect":
    case "bar":
      return [shape.y, shape.y + shape.h];
    case "line":
      return [Math.min(shape.y1, shape.y2), Math.max(shape.y1, shape.y2)];
    case "polygon":
      return [Math.min(...shape.points.map((p) => p.y)), Math.max(...shape.points.map((p) => p.y))];
    case "text": {
      const half = (shape.size ?? 14) * 0.7;
      return [shape.y - half, shape.y + half];
    }
    case "picture": {
      const size = shape.size ?? 40;
      // Its label, if it has one, is written underneath.
      return [shape.y - size * 0.6, shape.y + size * 0.62 + (shape.label ? 18 : 0)];
    }
  }
}

/** The part of the canvas that the shapes take up: where it starts and how deep it is. */
export function band(shapes: DiagramShape[]): { top: number; height: number } {
  const reaches = shapes.map(reach).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!reaches.length) return { top: 0, height: DIAGRAM_HEIGHT };
  const within = (y: number) => Math.max(0, Math.min(DIAGRAM_HEIGHT, y));
  let top = within(Math.min(...reaches.map(([a]) => a)) - MARGIN);
  let bottom = within(Math.max(...reaches.map(([, b]) => b)) + MARGIN);
  if (bottom - top < LEAST) {
    top = Math.max(0, Math.min(DIAGRAM_HEIGHT - LEAST, (top + bottom - LEAST) / 2));
    bottom = top + LEAST;
  }
  return { top: Math.round(top), height: Math.round(bottom - top) };
}
