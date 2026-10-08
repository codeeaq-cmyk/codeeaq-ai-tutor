import { describe, expect, it } from "vitest";
import { emptyModuleProgress, type ModulePlan } from "@codeeaq/shared-types";
import { carryOnLimit, openingFor, startingMode } from "./lessonFlow";

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

describe("carryOnLimit", () => {
  it("allows more prompts for modules with more goals", () => {
    expect(carryOnLimit(2)).toBe(14);
    expect(carryOnLimit(4)).toBeGreaterThan(carryOnLimit(2));
  });
});
