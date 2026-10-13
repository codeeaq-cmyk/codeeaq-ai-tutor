import type { CSSProperties } from "react";
import type { BoardBlock, BoardState } from "@codeeaq/shared-types";

// The board is drawn in front of the student as Ceeq speaks: words are
// written one after another, pictures pop up, arrows and outlines draw
// themselves. Every piece has a moment at which it starts to appear, counted
// in milliseconds from when its block was put on the board. The drawing itself
// is done by the ink-… classes in globals.css, which read that moment from the
// `--at` property set here.

/** From one written word to the next. */
export const WORD_MS = 55;
/** From one panel, step, label, table row or diagram shape to the next. */
export const PANEL_MS = 1000;
export const STEP_MS = 850;
export const LABEL_MS = 650;
export const ROW_MS = 280;
export const SHAPE_MS = 170;

/** The style that starts a piece `ms` after its block arrived. */
export const startAt = (ms: number) => ({ "--at": Math.round(ms) }) as CSSProperties;

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** How long a piece of text takes to be written. */
export const writeMs = (text: string) => countWords(text) * WORD_MS + 250;

/**
 * How long a block takes to draw. The next block of the same update starts
 * when it is done. `kept` is how many of its lines were on the board already
 * (see BoardState.kept): those take no time.
 */
export function drawMs(block: BoardBlock, kept = 0): number {
  switch (block.kind) {
    case "heading":
      return writeMs(block.text) + 150;
    case "text":
      return writeMs(block.text);
    case "math":
      return 700;
    case "list":
      return block.items.slice(kept).reduce((total, item) => total + writeMs(item), 0);
    case "notes":
      return block.points.slice(kept).reduce((total, point) => total + writeMs(point), kept ? 0 : 250);
    case "callout":
      return 250 + writeMs(block.text);
    case "table":
      return 350 + block.rows.length * ROW_MS;
    case "number_line":
    case "graph":
      return 900;
    case "diagram":
      return Math.min(4000, 300 + block.shapes.length * SHAPE_MS);
    case "panels":
      return block.panels.length * PANEL_MS;
    case "flow":
      return block.steps.length * STEP_MS + (block.loop ? 600 : 0);
    case "labelled":
      return 600 + block.labels.length * LABEL_MS;
  }
}

/**
 * When each block on the board starts to be drawn. Blocks that arrived in one
 * update follow one another down the board; a later update starts at once.
 */
export function drawTimes(board: BoardState): Record<string, number> {
  const free: Record<number, number> = {};
  const times: Record<string, number> = {};
  for (const block of board.blocks) {
    const update = board.born?.[block.id] ?? 0;
    times[block.id] = free[update] ?? 0;
    free[update] = times[block.id] + drawMs(block, board.kept?.[block.id] ?? 0);
  }
  return times;
}
