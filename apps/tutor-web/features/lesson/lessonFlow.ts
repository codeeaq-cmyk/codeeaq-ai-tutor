import { bestAttempt, moduleState, type LessonMode, type ModulePlan, type ModuleProgress } from "@codeeaq/shared-types";

// The app's side of a lesson. A module runs in three parts: Ceeq explains it,
// then practises it with the student, then the app gives a quiz.
//
// The voice model only speaks when prompted. While Ceeq is explaining, the app
// therefore prompts her to carry on each time she finishes a turn, so the
// student can simply listen. She calls start_practice when the explanation is
// done; from then on the app waits for the student instead.

/** The voice API has no speed setting, so the pace rule is repeated where Ceeq starts talking. */
const PACE_REMINDER = "Speak slowly, with a pause after each sentence.";

/**
 * Which part a lesson starts in. Practice only when the student comes back to
 * a module Ceeq had finished explaining but they had not finished practising.
 * A new module, a half-explained one and a completed one being revisited all
 * start with the explanation.
 */
export function startingMode(progress: ModuleProgress | undefined): LessonMode {
  return progress?.explained && !progress.learned ? "practice" : "explain";
}

/** What Ceeq is told when the lesson connects. */
export function openingFor(module: ModulePlan, progress: ModuleProgress | undefined): string {
  const state = moduleState(progress);
  if (state === "new") {
    return `(The student just opened this module. Start with part 1, explaining. Give your opening turn as instructed: tools first, then greet them, say what this lesson is about, why it is worth learning and how the lesson will go. Do not ask them anything. ${PACE_REMINDER})`;
  }
  const goals = module.goals.map((g, i) => `${i + 1}. ${g} — ${progress?.goals[i] ?? "todo"}`).join("; ");
  if (state === "learning" && startingMode(progress) === "practice") {
    return `(The student is back to continue this module. You have already explained all of it, so you are in part 2, practising. Goal status: ${goals}. Welcome them back in one short sentence, recap the module in two more, and ask a practice question on the first goal that is not understood. ${PACE_REMINDER})`;
  }
  if (state === "learning") {
    return `(The student is back to continue this module. You had not finished explaining it. Goal status: ${goals}. Start with part 1, explaining: tools first, then welcome them back in one short sentence and remind them what this lesson is about and why it matters. Then carry on explaining from the first goal you had not finished. Do not ask them anything. ${PACE_REMINDER})`;
  }
  const best = bestAttempt(progress);
  return `(The student is revisiting this module, which they have completed before.${best ? ` Their best quiz score so far is ${best.score} of ${best.total}.` : ""} Start with part 1, explaining: tools first, then welcome them back in one short sentence and say you will go over it again. Explain the module once more, briefly, in one or two turns per goal. Do not ask them anything until you start practice. ${PACE_REMINDER})`;
}

/** Sent each time Ceeq finishes an explaining turn. */
export const CARRY_ON = "(Carry on: the next step only, tools first, then one short paragraph. If every goal is now explained, give your last explaining turn instead.)";

/** Sent once if the explanation has gone on far longer than the module needs. */
export const WRAP_UP = "(You have explained enough. Give your last explaining turn now: tools first, including start_practice, then a two-sentence recap and your first practice question.)";

/**
 * How many times Ceeq is prompted to carry on before being told to wrap up.
 * Generous: she takes two to four turns per goal, plus the opening and recap.
 */
export function carryOnLimit(goalCount: number): number {
  return 4 + goalCount * 5;
}

/**
 * Once prompted, Ceeq takes a second or two to start speaking. So she is
 * prompted this long before the paragraph she is on finishes playing, and the
 * next one follows after a breath instead of a silence. (Only possible when the
 * audio is slowed: at normal pace nothing is left to play when a turn completes.)
 */
export const LEAD_MS = 1500;
/** After she has answered the student, wait longer so they can follow up. */
export const GAP_AFTER_STUDENT_MS = 2500;
/** If nothing at all happens for this long while she should be explaining, prompt her anyway. */
export const SILENCE_MS = 9000;
