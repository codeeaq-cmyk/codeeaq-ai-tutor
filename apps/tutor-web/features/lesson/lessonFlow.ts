import { bestAttempt, moduleState, weakGoals, type LessonMode, type ModulePlan, type ModuleProgress } from "@codeeaq/shared-types";

// The app's side of a lesson. A module runs in three parts: Ceeq explains it,
// then practises it with the student, then the app gives a quiz.
//
// The voice model only speaks when prompted. While Ceeq is explaining, the app
// therefore prompts her to carry on each time she finishes a turn, so the
// student can simply listen. She calls start_practice when the explanation is
// done; from then on the app waits for the student instead.
//
// A revision lesson has no explaining part: Ceeq goes over the student's weak
// spots one at a time, each ending in a question, so the app waits throughout.

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

/** Tells Ceeq which goals the student got wrong before, so that a repeat lesson takes more care over them. */
function weakNote(progress: ModuleProgress | undefined, now: number): string {
  const weak = weakGoals(progress, now);
  if (!weak.length) return "";
  const items = weak.map(({ index, spot }) => `goal ${index + 1}${spot.notes.length ? ` (${spot.notes.at(-1)})` : ""}`);
  return ` They got these wrong before: ${items.join("; ")}. Take extra care over them, without mentioning that they got them wrong, and check them when you practise.`;
}

/** What Ceeq is told when the lesson connects. */
export function openingFor(module: ModulePlan, progress: ModuleProgress | undefined, now = Date.now()): string {
  const state = moduleState(progress);
  if (state === "new") {
    return `(The student just opened this module. Start with part 1, explaining. Give your opening turn as instructed: tools first, then greet them, say what this lesson is about, why it is worth learning and how the lesson will go. Do not ask them anything. ${PACE_REMINDER})`;
  }
  const goals = module.goals.map((g, i) => `${i + 1}. ${g} — ${progress?.goals[i] ?? "todo"}`).join("; ");
  const weak = weakNote(progress, now);
  if (state === "learning" && startingMode(progress) === "practice") {
    return `(The student is back to continue this module. You have already explained all of it, so you are in part 2, practising. Goal status: ${goals}.${weak} Welcome them back in one short sentence, recap the module in two more, and ask a practice question on the first goal that is not understood. ${PACE_REMINDER})`;
  }
  if (state === "learning") {
    return `(The student is back to continue this module. You had not finished explaining it. Goal status: ${goals}.${weak} Start with part 1, explaining: tools first, then welcome them back in one short sentence and remind them what this lesson is about and why it matters. Then carry on explaining from the first goal you had not finished. Do not ask them anything. ${PACE_REMINDER})`;
  }
  const best = bestAttempt(progress);
  return `(The student is revisiting this module, which they have completed before.${best ? ` Their best quiz score so far is ${best.score} of ${best.total}.` : ""}${weak} Start with part 1, explaining: tools first, then welcome them back in one short sentence and say you will go over it again. Explain the module once more, briefly, in one or two turns per goal. Do not ask them anything until you start practice. ${PACE_REMINDER})`;
}

/**
 * What Ceeq is told when a revision lesson connects. Her instructions already
 * list the topics; `done` names the goals (numbered from 1) dealt with before a
 * dropped connection, so she does not start the list again.
 */
export function revisionOpening(done: number[] = []): string {
  const start = done.length
    ? `You were cut off part-way. Already dealt with: goal ${done.join(", goal ")}. Welcome them back in one short sentence and carry on with the next topic on your revision list.`
    : "Give your opening turn as instructed: tools first, then welcome them back and start the first topic on your revision list.";
  return `(The student is here to revise this module. ${start} ${PACE_REMINDER})`;
}

/**
 * The goal an answer is about when Ceeq does not say. She works through the
 * goals in `order`, so it is the first one she has not yet settled (marked
 * understood, or left for another day) in this sitting.
 */
export function goalInHand(order: number[], settled: ReadonlySet<number>): number {
  return order.find((index) => !settled.has(index)) ?? order.at(-1) ?? 0;
}

/**
 * What the student has actually said, which is all Ceeq's judgements can rest
 * on. Now and then she reports answers and results nobody gave (once, a whole
 * revision in her opening turn), and those would put goals on, or take them
 * off, the student's list of things to revise. So each thing the student says
 * backs at most one recorded answer and one goal marked understood or left for
 * later, and a lesson cannot be finished before they have practised.
 */
export class Evidence {
  private said = 0;
  private answerAt = 0;
  private resultAt = 0;
  private practiceAt = 0;

  /** The student spoke or typed. Called as their words arrive, so often several times for one answer. */
  studentSpoke(): void {
    this.said++;
  }

  /** Practice has begun: finishing the lesson needs the student to say something after this. */
  practiceBegan(): void {
    this.practiceAt = this.said;
  }

  /** Whether an answer may be recorded: true once for what the student has said since the last one. */
  allowAnswer(): boolean {
    if (this.answerAt === this.said) return false;
    this.answerAt = this.said;
    return true;
  }

  /** Whether a goal may be marked understood or left for later: true once for what the student has said since the last. */
  allowResult(): boolean {
    if (this.resultAt === this.said) return false;
    this.resultAt = this.said;
    return true;
  }

  /** Whether the student has said anything since practice began. */
  get practised(): boolean {
    return this.said > this.practiceAt;
  }
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
