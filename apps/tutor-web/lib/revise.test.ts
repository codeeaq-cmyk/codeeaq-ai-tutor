import { describe, expect, it } from "vitest";
import { emptyModuleProgress, markMissed, markRevised, type ChapterProgress, type Syllabus } from "@codeeaq/shared-types";
import { mergeChapters, type ProgressMap } from "./progress";
import { dayLabel, modulesToRevise, reasonFor } from "./revise";

const DAY = 24 * 60 * 60 * 1000;
// Midday, so "a day later" lands on the next calendar day in any time zone.
const NOW = new Date(2026, 9, 12, 12).getTime();

const plan = {
  modules: [
    { id: "current", title: "Electric current", goals: ["Say what current is", "Use I = Q / t"] },
    { id: "ohm", title: "Ohm's law", goals: ["State the law"] },
  ],
};

function chapter(change: Partial<ChapterProgress> = {}): ChapterProgress {
  return { plan, modules: {}, updatedAt: 1, ...change };
}

const syllabus = {
  subjects: [{ id: "science", name: "Science", chapters: [{ id: "electricity", title: "Electricity" }] }],
} as unknown as Syllabus;

describe("modulesToRevise", () => {
  const missed = markMissed(emptyModuleProgress(2), 1, "divided t by Q", NOW - DAY);
  const progress: ProgressMap = {
    "cbse-10/science/electricity": chapter({ modules: { current: missed } }),
    "cbse-9/science/motion": chapter({ modules: { current: missed } }),
  };

  it("lists the weak goals of the student's own class, with a link to revise them", () => {
    const [only, ...rest] = modulesToRevise(progress, "cbse-10", syllabus, NOW);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ subject: "Science", chapter: "Electricity", href: "/learn/science/electricity/current?revise=1" });
    expect(only.module.title).toBe("Electric current");
    expect(only.due.map((g) => g.index)).toEqual([1]);
    expect(only.later).toEqual([]);
  });

  it("keeps a revised goal for its later check instead of listing it as due", () => {
    const revised = markRevised(missed, 1, NOW);
    const [only] = modulesToRevise({ "cbse-10/science/electricity": chapter({ modules: { current: revised } }) }, "cbse-10", syllabus, NOW + DAY);
    expect(only.due).toEqual([]);
    expect(only.later).toHaveLength(1);
  });

  it("puts the module that has waited longest first", () => {
    const recent = markMissed(emptyModuleProgress(1), 0, "note", NOW - 1000);
    const list = modulesToRevise({ "cbse-10/science/electricity": chapter({ modules: { ohm: recent, current: missed } }) }, "cbse-10", syllabus, NOW);
    expect(list.map((m) => m.module.id)).toEqual(["current", "ohm"]);
  });

  it("uses the names stored with a chapter the student typed in, and skips one without names", () => {
    const names = { subject: "Chess", chapter: "Openings & traps" };
    const typed: ProgressMap = {
      "cbse-10/custom/chess-openings": chapter({ modules: { current: missed }, names }),
      "cbse-10/custom/unnamed": chapter({ modules: { current: missed } }),
    };
    const list = modulesToRevise(typed, "cbse-10", syllabus, NOW);
    expect(list).toHaveLength(1);
    expect(list[0].href).toBe("/learn/custom/chess-openings/current?subject=Chess&chapter=Openings+%26+traps&revise=1");
  });
});

describe("reminder wording", () => {
  it("says when a check is due", () => {
    expect(dayLabel(NOW - DAY, NOW)).toBe("today");
    expect(dayLabel(NOW, NOW)).toBe("today");
    expect(dayLabel(NOW + DAY, NOW)).toBe("tomorrow");
    expect(dayLabel(NOW + 3 * DAY, NOW)).toBe("in 3 days");
    expect(dayLabel(NOW + 20 * DAY, NOW)).toMatch(/^on /);
  });

  it("says why a goal is on the list", () => {
    const spot = (notes: string[], misses = 1, step = 0) => ({ index: 0, due: true, spot: { misses, notes, step, dueAt: NOW } });
    expect(reasonFor(spot(["divided t by Q"]))).toBe("Divided t by Q");
    expect(reasonFor(spot(["Quiz question missed: What is 1 A?"]))).toBe("Missed in a quiz");
    expect(reasonFor(spot(["a", "Quiz question missed: What is 1 A?"], 3))).toBe("Missed 3 times, last in a quiz");
    expect(reasonFor(spot(["Did not pass the module quiz"]))).toBe("Quiz not passed yet");
    expect(reasonFor(spot([]))).toBe("Needed more practice");
    // Once revised, what comes due is the check, whatever went wrong originally.
    expect(reasonFor(spot(["divided t by Q"], 2, 1))).toBe("Time for a quick check");
  });
});

describe("mergeChapters", () => {
  const older = chapter({ updatedAt: 10 });
  const newer = chapter({ updatedAt: 20, modules: { ohm: markMissed(emptyModuleProgress(1), 0, "note", NOW) } });

  it("takes the account's copy when it is the later one", () => {
    const { merged, stale } = mergeChapters({ a: older }, { a: newer });
    expect(merged.a).toEqual(newer);
    expect(stale).toEqual([]);
  });

  it("keeps this device's copy when it is the later one, and saves it back", () => {
    const { merged, stale } = mergeChapters({ a: newer }, { a: older });
    expect(merged.a).toEqual(newer);
    expect(stale).toEqual(["a"]);
  });

  it("brings chapters over in both directions", () => {
    const { merged, stale } = mergeChapters({ mine: older }, { theirs: newer });
    expect(Object.keys(merged).sort()).toEqual(["mine", "theirs"]);
    expect(stale).toEqual(["mine"]);
  });

  it("lets the account win a tie, so every device has the same module plan", () => {
    const other = chapter({ plan: { modules: [{ id: "other", title: "Other plan", goals: ["A goal"] }] }, updatedAt: 0 });
    const { merged, stale } = mergeChapters({ a: chapter({ updatedAt: 0 }) }, { a: other });
    expect(merged.a.plan.modules[0].id).toBe("other");
    expect(stale).toEqual([]);
  });

  it("ignores an account copy it cannot read", () => {
    const { merged, stale } = mergeChapters({ a: older }, { a: { plan: "broken" }, b: null });
    expect(merged).toEqual({ a: older });
    expect(stale).toEqual(["a"]);
  });
});
