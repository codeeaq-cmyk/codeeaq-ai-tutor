import { describe, expect, it } from "vitest";
import { emptyModuleProgress, markMissed, type ModulePlan } from "@codeeaq/shared-types";
import { carryOnLimit, Evidence, goalInHand, openingFor, revisionOpening, startingMode } from "./lessonFlow";

const plan: ModulePlan = { id: "m", title: "Ohm's law", goals: ["State the law", "Calculate resistance"] };
const fresh = emptyModuleProgress(2);

describe("startingMode", () => {
  it("starts with the explanation for a new, half-explained or completed module", () => {
    expect(startingMode(undefined)).toBe("explain");
    expect(startingMode(fresh)).toBe("explain");
    expect(startingMode({ ...fresh, goals: ["learning", "todo"] })).toBe("explain");
    expect(startingMode({ ...fresh, explained: true, learned: true })).toBe("explain");
  });

  it("goes straight to practice only when the explanation was finished but the module was not", () => {
    expect(startingMode({ ...fresh, explained: true, goals: ["understood", "learning"] })).toBe("practice");
  });
});

describe("openingFor", () => {
  it("opens a new module with the explanation and no questions", () => {
    const opening = openingFor(plan, undefined);
    expect(opening).toContain("Start with part 1, explaining");
    expect(opening).toContain("Do not ask them anything");
  });

  it("resumes a half-explained module where the explanation stopped", () => {
    const opening = openingFor(plan, { ...fresh, goals: ["learning", "todo"] });
    expect(opening).toContain("You had not finished explaining it");
    expect(opening).toContain("1. State the law — learning; 2. Calculate resistance — todo");
    expect(opening).toContain("Do not ask them anything");
  });

  it("resumes practice when the explanation was already finished", () => {
    const opening = openingFor(plan, { ...fresh, explained: true, goals: ["understood", "learning"] });
    expect(opening).toContain("you are in part 2, practising");
    expect(opening).toContain("first goal that is not understood");
  });

  it("explains again, briefly, on a revisit", () => {
    const opening = openingFor(plan, { ...fresh, explained: true, learned: true, attempts: [{ score: 4, total: 5, at: 1 }] });
    expect(opening).toContain("revisiting this module");
    expect(opening).toContain("best quiz score so far is 4 of 5");
    expect(opening).toContain("Explain the module once more, briefly");
  });
});

describe("weak spots", () => {
  const NOW = 1_000_000_000_000;
  const done = { ...fresh, explained: true, learned: true };

  it("tells Ceeq what the student got wrong before when they repeat a lesson", () => {
    const opening = openingFor(plan, markMissed(done, 1, "divided I by V", NOW), NOW);
    expect(opening).toContain("They got these wrong before: goal 2 (divided I by V).");
    expect(opening).toContain("Take extra care over them");
  });

  it("says nothing about weak spots when there are none", () => {
    expect(openingFor(plan, done, NOW)).not.toContain("wrong before");
    expect(openingFor(plan, undefined, NOW)).not.toContain("wrong before");
  });

  it("starts a revision at the top of the list, or where a dropped connection left it", () => {
    expect(revisionOpening()).toContain("start the first topic on your revision list");
    const resumed = revisionOpening([2, 3]);
    expect(resumed).toContain("Already dealt with: goal 2, goal 3.");
    expect(resumed).toContain("carry on with the next topic");
  });

  it("takes an answer with no goal to be about the first goal not yet settled", () => {
    expect(goalInHand([0, 1, 2], new Set())).toBe(0);
    expect(goalInHand([0, 1, 2], new Set([0]))).toBe(1);
    expect(goalInHand([2, 0], new Set([2]))).toBe(0);
    expect(goalInHand([0, 1], new Set([0, 1]))).toBe(1);
  });
});

describe("Evidence", () => {
  it("lets nothing be recorded before the student has said anything", () => {
    const evidence = new Evidence();
    expect(evidence.allowAnswer()).toBe(false);
    expect(evidence.allowResult()).toBe(false);
    expect(evidence.practised).toBe(false);
  });

  it("lets one answer and one result rest on what the student said", () => {
    const evidence = new Evidence();
    evidence.studentSpoke();
    evidence.studentSpoke(); // the rest of the same sentence arriving
    expect(evidence.allowAnswer()).toBe(true);
    expect(evidence.allowResult()).toBe(true);
    // A second answer or result needs the student to speak again.
    expect(evidence.allowAnswer()).toBe(false);
    expect(evidence.allowResult()).toBe(false);
    evidence.studentSpoke();
    expect(evidence.allowAnswer()).toBe(true);
    expect(evidence.allowResult()).toBe(true);
  });

  it("counts practice only from when it began", () => {
    const evidence = new Evidence();
    evidence.studentSpoke(); // a question during the explanation
    evidence.practiceBegan();
    expect(evidence.practised).toBe(false);
    evidence.studentSpoke();
    expect(evidence.practised).toBe(true);
  });
});

describe("carryOnLimit", () => {
  it("allows more prompts for modules with more goals", () => {
    expect(carryOnLimit(2)).toBe(14);
    expect(carryOnLimit(4)).toBeGreaterThan(carryOnLimit(2));
  });
});
