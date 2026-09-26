import type { WhiteboardAction } from "@codeeaq/shared-types";

// Actions that draw something, plus per-target decorations from later actions.
export type Shape = Exclude<
  WhiteboardAction,
  { type: "clear" } | { type: "erase" } | { type: "divide_circle" } | { type: "highlight" }
> & { key: string; parts?: number; highlight?: { color: string; part?: number } };

let counter = 0;

/** Applies application-defined actions to the board. Unknown actions are ignored. */
export function applyActions(shapes: Shape[], actions: WhiteboardAction[]): Shape[] {
  let next = shapes;
  for (const action of actions) {
    switch (action.type) {
      case "clear":
        next = [];
        break;
      case "erase":
        next = next.filter((s) => s.id !== action.targetId);
        break;
      case "divide_circle":
        next = next.map((s) =>
          s.id === action.targetId && s.type === "draw_circle" ? { ...s, parts: action.parts } : s,
        );
        break;
      case "highlight":
        next = next.map((s) =>
          s.id === action.targetId
            ? { ...s, highlight: { color: action.color ?? "#f59e0b", part: action.part } }
            : s,
        );
        break;
      default:
        next = [...next, { ...action, key: action.id ?? `shape-${counter++}` }];
    }
  }
  return next;
}
