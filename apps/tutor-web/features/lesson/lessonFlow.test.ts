import { describe, expect, it } from "vitest";
import { emptyModuleProgress, markMissed, type ModulePlan, type ModuleProgress } from "@codeeaq/shared-types";
import { carryOnLimit, carryOverNote, Evidence, goalInHand, openingFor, quizReport, quizResultPrompt, revisionOpening, startingMode } from "./lessonFlow";

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

describe("a replaced connection", () => {
  const halfway: ModuleProgress = { ...fresh, goals: ["learning", "todo"] };

  it("tells her where the explanation stands and to wait until asked to carry on", () => {
    const note = carryOverNote(plan, halfway, { at: "explain" }, true);
    expect(note).toContain("Do not greet the student again and do not mention the break.");
    expect(note).toContain("1. State the law — learning; 2. Calculate resistance — todo");
    expect(note).toContain("You are in part 1, explaining");
    expect(note).toContain("The last thing you said to the student follows this note.");
    expect(note).toContain("Say nothing more until you are asked to carry on.");
  });

  it("has her wait for the answer to the practice question she had asked", () => {
    const note = carryOverNote(plan, { ...halfway, explained: true }, { at: "practice" }, true);
    expect(note).toContain("You are in part 2, practising");
    expect(note).toContain("Wait for their answer to it and judge it as usual.");
  });

  it("carries a revision on down its list", () => {
    const note = carryOverNote(plan, halfway, { at: "revision", revised: [2], over: false }, true);
    expect(note).toContain("The student is revising this module with you. Already dealt with: goal 2.");
    expect(note).toContain("then carry on down your revision list");
    expect(note).not.toContain("Goal status");
  });

  it("does not have her wait for an answer when she had not yet asked anything", () => {
    const note = carryOverNote(plan, halfway, { at: "revision", revised: [], over: false }, false);
    expect(note).toContain("You have not said anything to the student yet.");
    expect(note).not.toContain("Wait for their answer");
  });

  it("keeps her quiet while the student takes the quiz", () => {
    const note = carryOverNote(plan, halfway, { at: "quiz", report: null }, true);
    expect(note).toContain("the student is taking the quiz on their screen");
    expect(note).toContain("Stay silent until you are told the result.");
    expect(note).not.toContain("Wait for their answer");
  });

  it("tells her how the quiz went once the student has finished it", () => {
    const report = quizReport(4, 5, ["What is the unit of resistance?"]);
    expect(report).toBe('Quiz result: 4 out of 5. Questions they missed: "What is the unit of resistance?".');
    expect(quizReport(5, 5, [])).toBe("Quiz result: 5 out of 5. They missed nothing.");
    expect(quizResultPrompt(report)).toBe(`(${report} Respond as instructed for a quiz result.)`);
    const note = carryOverNote(plan, halfway, { at: "quiz", report }, true);
    expect(note).toContain(`the student has taken the quiz. ${report}`);
    expect(note).toContain("Do not start teaching another module.");
  });

  it("does not send her back down a revision list that is finished", () => {
    const note = carryOverNote(plan, halfway, { at: "revision", revised: [1, 2], over: true }, true);
    expect(note).toContain("The student has finished revising this module with you");
    expect(note).not.toContain("carry on down your revision list");
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
