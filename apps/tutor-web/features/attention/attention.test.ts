import { describe, expect, it } from "vitest";
import { BACK_MS, CHECK_IN_MS, PAUSE_MS, sightOf, Watch, type FoundFace, type Sight } from "./attention";

/** A face whose eyes are at 0.4 and 0.6 across the picture, with its nose `turn` eye-widths off the middle. */
const face = (turn: number, size = 0.3): FoundFace => ({
  boundingBox: { width: size, height: size },
  keypoints: [
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.4 },
    { x: 0.5 + turn * 0.2, y: 0.5 },
  ],
});

describe("sightOf", () => {
  it("sees nobody in an empty picture", () => {
    expect(sightOf([])).toBe("away");
  });

  it("takes a face looking at the screen, or not far off it, as the student here", () => {
    expect(sightOf([face(0)])).toBe("here");
    expect(sightOf([face(0.3)])).toBe("here");
    expect(sightOf([face(-0.3)])).toBe("here");
  });

  it("takes a head turned well to either side as turned away", () => {
    expect(sightOf([face(0.6)])).toBe("turned");
    expect(sightOf([face(-0.6)])).toBe("turned");
  });

  it("judges the largest face, which is the student's", () => {
    expect(sightOf([face(0.6, 0.1), face(0, 0.4)])).toBe("here");
    expect(sightOf([face(0, 0.1), face(0.6, 0.4)])).toBe("turned");
  });

  it("gives a face without its eyes and nose the benefit of the doubt", () => {
    expect(sightOf([{ keypoints: [] }])).toBe("here");
  });
});

describe("Watch", () => {
  /** Looks at the camera every half second from `from` to `to`, and returns what changed. */
  function looks(watch: Watch, sight: Sight, from: number, to: number) {
    const changes = [];
    for (let t = from; t <= to; t += 500) {
      const change = watch.look(sight, t);
      if (change) changes.push({ at: t, ...change });
    }
    return changes;
  }

  it("does nothing while the student is in view, or out of it for less than the check-in time", () => {
    const watch = new Watch(0);
    expect(looks(watch, "here", 0, 60_000)).toEqual([]);
    expect(looks(watch, "away", 60_500, 60_000 + CHECK_IN_MS - 500)).toEqual([]);
    expect(looks(watch, "here", 60_000 + CHECK_IN_MS, 90_000)).toEqual([]);
  });

  it("checks in, then pauses, the longer the student is out of view", () => {
    const watch = new Watch(0);
    looks(watch, "here", 0, 10_000);
    expect(looks(watch, "turned", 10_500, 10_000 + PAUSE_MS)).toEqual([
      { at: 10_000 + CHECK_IN_MS, kind: "check-in", why: "turned" },
      { at: 10_000 + PAUSE_MS, kind: "pause", why: "turned" },
    ]);
  });

  it("is not fooled by a moment in which the face was missed", () => {
    const watch = new Watch(0);
    for (let t = 0; t <= 120_000; t += 500) expect(watch.look(t % 5000 === 0 ? "away" : "here", t)).toBeNull();
  });

  it("welcomes the student back once they have been in view a moment, saying how long they were gone", () => {
    const watch = new Watch(0);
    looks(watch, "away", 500, 30_000);
    // Caught in view for less than a moment: not back yet.
    expect(watch.look("here", 30_500)).toBeNull();
    expect(watch.look("away", 31_000)).toBeNull();
    expect(looks(watch, "here", 40_000, 40_000 + BACK_MS)).toEqual([{ at: 40_000 + BACK_MS, kind: "back", from: "checked", awayMs: 40_000 }]);
    expect(watch.with).toBe(true);
  });

  it("says when the student is back to a lesson that was paused for them", () => {
    const watch = new Watch(0);
    looks(watch, "away", 500, 100_000);
    expect(looks(watch, "here", 100_500, 103_000)[0]).toEqual({ at: 102_000, kind: "back", from: "paused", awayMs: 100_500 });
  });

  it("takes the student speaking or typing as being there, whatever the camera shows", () => {
    const watch = new Watch(0);
    looks(watch, "away", 500, 15_000);
    expect(watch.heard(15_000)).toBeNull();
    // The time out of view counts again from when they spoke.
    expect(looks(watch, "away", 15_500, 15_000 + CHECK_IN_MS)).toEqual([{ at: 15_000 + CHECK_IN_MS, kind: "check-in", why: "away" }]);
    expect(watch.heard(36_000)).toEqual({ kind: "back", from: "checked", awayMs: 21_000 });
  });

  it("starts afresh after a pause the student chose", () => {
    const watch = new Watch(0);
    looks(watch, "away", 500, 25_000);
    watch.reset(200_000);
    expect(watch.with).toBe(true);
    expect(looks(watch, "away", 200_500, 200_000 + CHECK_IN_MS - 500)).toEqual([]);
  });
});
