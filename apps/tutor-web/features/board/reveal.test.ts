import { describe, expect, it } from "vitest";
import { applyBoardUpdate, EMPTY_BOARD, type BoardBlock } from "@codeeaq/shared-types";
import { drawMs, drawTimes, writeMs, WORD_MS } from "./reveal";

const heading: BoardBlock = { kind: "heading", id: "h", text: "The water cycle" };
const panels: BoardBlock = { kind: "panels", id: "p", panels: [{ title: "Solid" }, { title: "Liquid" }, { title: "Gas" }] };
const note: BoardBlock = { kind: "text", id: "t", text: "Matter exists in three forms." };

describe("drawing the board", () => {
  it("takes longer to write more words", () => {
    expect(writeMs("one two three four") - writeMs("one two")).toBe(2 * WORD_MS);
    expect(drawMs({ kind: "text", id: "a", text: "a much longer sentence than the other" })).toBeGreaterThan(drawMs({ kind: "text", id: "b", text: "short" }));
  });

  it("draws the blocks of one update one after another, each when the one before is done", () => {
    const board = applyBoardUpdate(EMPTY_BOARD, { add: [heading, panels, note] });
    const times = drawTimes(board);
    expect(times.h).toBe(0);
    expect(times.p).toBe(drawMs(heading));
    expect(times.t).toBe(drawMs(heading) + drawMs(panels));
  });

  it("starts a later update at once, whatever is still being drawn", () => {
    const first = applyBoardUpdate(EMPTY_BOARD, { add: [heading, panels] });
    const second = applyBoardUpdate(first, { add: [note] });
    const times = drawTimes(second);
    expect(times.p).toBe(drawMs(heading));
    expect(times.t).toBe(0);
  });

  it("never makes a block that is already drawn wait longer when another is replaced", () => {
    const first = applyBoardUpdate(EMPTY_BOARD, { add: [heading, panels] });
    const before = drawTimes(first).p;
    const replaced = applyBoardUpdate(first, { add: [{ ...heading, text: "The water cycle, again" }] });
    expect(drawTimes(replaced).p).toBeLessThanOrEqual(before);
  });
});
