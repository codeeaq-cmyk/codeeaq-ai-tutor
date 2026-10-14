import { describe, expect, it } from "vitest";
import { emptyModuleProgress, markMissed, type ModulePlan, type ModuleProgress } from "@codeeaq/shared-types";
import { carryOnLimit, carryOverNote, checkIn, Evidence, goalInHand, howLong, openingFor, quizReport, quizResultPrompt, revisionOpening, startingMode, welcomeBack } from "./lessonFlow";

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

  it("goes straight to practice when the student chooses it, even on a new module", () => {
    const opening = openingFor(plan, undefined, Date.now(), "practice");
    expect(opening).toContain("The student just opened this module and has asked to go straight to practice");
    expect(opening).toContain("Begin by calling start_practice");
    const back = openingFor(plan, { ...fresh, goals: ["learning", "todo"] }, Date.now(), "practice");
    expect(back).toContain("The student is back at this module and has asked to go straight to practice");
    expect(back).toContain("1. State the law — learning; 2. Calculate resistance — todo");
  });

  it("explains again when the student chooses it, though they had reached practice", () => {
    const opening = openingFor(plan, { ...fresh, explained: true, goals: ["understood", "learning"] }, Date.now(), "explain");
    expect(opening).toContain("has asked to hear the explanation again before practising");
    expect(opening).toContain("Start with part 1, explaining");
    expect(opening).toContain("Do not ask them anything until you start practice");
  });

  it("opens as usual when the part chosen is the one already reached", () => {
    const reached: ModuleProgress = { ...fresh, explained: true, goals: ["understood", "learning"] };
    expect(openingFor(plan, reached, 5, "practice")).toBe(openingFor(plan, reached, 5));
    expect(openingFor(plan, undefined, 5, "explain")).toBe(openingFor(plan, undefined, 5));
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

describe("the student out of view", () => {
  it("has Ceeq check in, saying what the camera showed, and wait", () => {
    const explaining = checkIn("away", "explain");
    expect(explaining).toContain("has not been in front of the camera");
    expect(explaining).toContain("Do not go on explaining");
    expect(explaining).toContain("wait for them");
    const practising = checkIn("turned", "practice");
    expect(practising).toContain("turned away from the screen");
    expect(practising).toContain("put it to them again");
    for (const note of [explaining, practising]) expect(note).toContain("Do not scold them");
  });

  it("says roughly how long the student was away", () => {
    expect(howLong(4_000)).toBe("about 10 seconds");
    expect(howLong(31_000)).toBe("about 30 seconds");
    expect(howLong(70_000)).toBe("about a minute");
    expect(howLong(150_000)).toBe("about 3 minutes");
  });

  it("has her welcome them back and pick up the thread of the part they are in", () => {
    const explaining = welcomeBack(70_000, "explain", false);
    expect(explaining).toContain("was away from the screen for about a minute");
    expect(explaining).toContain("recap in one sentence");
    expect(explaining).toContain("carry on explaining");
    const practising = welcomeBack(200_000, "practice", true);
    expect(practising).toContain("left the lesson for another app for about 3 minutes");
    expect(practising).toContain("put it to them again");
  });
});
