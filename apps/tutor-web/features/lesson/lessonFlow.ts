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

/**
 * What Ceeq is told when the lesson connects. `part` is the part to start in:
 * the one the student has reached, unless they chose the other with its button.
 */
export function openingFor(module: ModulePlan, progress: ModuleProgress | undefined, now = Date.now(), part: LessonMode = startingMode(progress)): string {
  const state = moduleState(progress);
  const goals = module.goals.map((g, i) => `${i + 1}. ${g} — ${progress?.goals[i] ?? "todo"}`).join("; ");
  const weak = weakNote(progress, now);
  const reached = startingMode(progress);
  if (part === "practice") {
    if (state === "learning" && reached === "practice") {
      return `(The student is back to continue this module. You have already explained all of it, so you are in part 2, practising. Goal status: ${goals}.${weak} Welcome them back in one short sentence, recap the module in two more, and ask a practice question on the first goal that is not understood. ${PACE_REMINDER})`;
    }
    // They chose to practise without the explanation, or without the rest of it.
    const arrived = state === "new" ? "The student just opened this module" : "The student is back at this module";
    return `(${arrived} and has asked to go straight to practice, without the explanation. Goal status: ${goals}.${weak} You are in part 2, practising. Begin by calling start_practice. Then ${state === "new" ? "greet them" : "welcome them back"} in one short sentence and ask a practice question on the first goal that is not understood. ${PACE_REMINDER})`;
  }
  if (state === "new") {
    return `(The student just opened this module. Start with part 1, explaining. Give your opening turn as instructed: tools first, then greet them, say what this lesson is about, why it is worth learning and how the lesson will go. Do not ask them anything. ${PACE_REMINDER})`;
  }
  if (state === "learning" && reached === "practice") {
    // They had heard the whole explanation, and have asked for it again.
    return `(The student is back to continue this module and has asked to hear the explanation again before practising. Goal status: ${goals}.${weak} Start with part 1, explaining: tools first, then welcome them back in one short sentence and say you will go over it again. Explain the module once more, in one or two turns per goal. Do not ask them anything until you start practice. ${PACE_REMINDER})`;
  }
  if (state === "learning") {
    return `(The student is back to continue this module. You had not finished explaining it. Goal status: ${goals}.${weak} Start with part 1, explaining: tools first, then welcome them back in one short sentence and remind them what this lesson is about and why it matters. Then carry on explaining from the first goal you had not finished. Do not ask them anything. ${PACE_REMINDER})`;
  }
  const best = bestAttempt(progress);
  return `(The student is revisiting this module, which they have completed before.${best ? ` Their best quiz score so far is ${best.score} of ${best.total}.` : ""}${weak} Start with part 1, explaining: tools first, then welcome them back in one short sentence and say you will go over it again. Explain the module once more, briefly, in one or two turns per goal. Do not ask them anything until you start practice. ${PACE_REMINDER})`;
}

// What Ceeq is told when the student moves a running lesson to another part with its button.

/** Back to the explanation, from practice or from the quiz. */
export const EXPLAIN_AGAIN = `(The student has pressed the button to go back to the explanation. You are in part 1 again. Explain this module once more from its first goal, in short turns as before: tools first, then one short paragraph, after which the app asks you to carry on. Do not ask them anything. When every goal has been explained again, give your last explaining turn as usual, starting with start_practice. ${PACE_REMINDER})`;

/** On to practice, from the explanation or from the quiz. */
export const PRACTISE_NOW = `(The student has pressed the button to go to practice. You are in part 2 now. Begin this turn by calling start_practice. Then say in one short sentence that you will practise together, ask one practice question on the first goal they have not yet shown they understand, and wait for their answer. ${PACE_REMINDER})`;

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

// ---------- Carrying a lesson over to a new connection ----------
//
// A connection to the voice service lasts about ten minutes, can drop sooner,
// and now and then goes dead. The lesson then carries on over a new one. The
// Ceeq on it remembers nothing, so she is told where the lesson stands and
// what she last said, and the student should not notice the join.

/** Where a lesson has got to, as far as a Ceeq who has just been connected needs to know. */
export type Stage =
  | { at: LessonMode }
  /** The quiz is on the student's screen. `report` is how they did, once they have finished it. */
  | { at: "quiz"; report: string | null }
  /** A revision: the goals (numbered from 1) dealt with so far, and whether the revision is over. */
  | { at: "revision"; revised: number[]; over: boolean };

/**
 * Where the lesson stands, for a Ceeq who has just been connected in the
 * middle of it. Her own last words are put to her straight after this note.
 * `spoken` says whether she had said anything to the student yet.
 */
export function carryOverNote(module: ModulePlan, progress: ModuleProgress | undefined, stage: Stage, spoken: boolean): string {
  const joined = "The line dropped for a moment and you are connected again. Do not greet the student again and do not mention the break.";
  const last = spoken ? "The last thing you said to the student follows this note." : "You have not said anything to the student yet.";
  const quiet = "Say nothing more now. If the student asks you something, answer it briefly.";
  if (stage.at === "revision") {
    if (stage.over) return `(${joined} The student has finished revising this module with you and can see how it went. ${last} ${quiet} ${PACE_REMINDER})`;
    const dealtWith = stage.revised.length ? ` Already dealt with: goal ${stage.revised.join(", goal ")}.` : "";
    return `(${joined} The student is revising this module with you.${dealtWith} ${last}${spoken ? " Wait for their answer to it and judge it as usual, then carry on down your revision list." : ""} ${PACE_REMINDER})`;
  }
  if (stage.at === "quiz") {
    return stage.report
      ? `(${joined} You are in part 3: the student has taken the quiz. ${stage.report} ${last} ${quiet} Do not start teaching another module. ${PACE_REMINDER})`
      : `(${joined} You are in part 3: the module has been explained and practised, and the student is taking the quiz on their screen. ${last} Stay silent until you are told the result. ${PACE_REMINDER})`;
  }
  const goals = module.goals.map((g, i) => `${i + 1}. ${g} — ${progress?.goals[i] ?? "todo"}`).join("; ");
  return stage.at === "explain"
    ? `(${joined} You are in part 1, explaining this module. Goal status: ${goals}. Goals marked "learning" have been explained, except perhaps the last of them, which you were in the middle of. ${last} Say nothing more until you are asked to carry on. ${PACE_REMINDER})`
    : `(${joined} You are in part 2, practising with the student; the whole module has been explained. Goal status: ${goals}. ${last}${spoken ? " Wait for their answer to it and judge it as usual." : ""} ${PACE_REMINDER})`;
}

// What is asked of Ceeq on a new connection when something was waiting on her
// as the old one was lost, outside the explanation (where it is CARRY_ON).

/** In practice or a revision. */
export const GO_ON = "(Go on from where you were: tools first, then speak.)";
/** The quiz had just been put on the student's screen. */
export const QUIZ_SHOWN = "(The quiz is now on the student's screen. Wish them luck in one short sentence, then stay silent until you are told the result.)";
/** The last topic of a revision had just been settled. */
export const REVISION_OVER = "(The revision is finished and the student can see how it went. Say in two sentences what they did well, say goodbye, and stop.)";

/** How the student did in the quiz, as Ceeq is told it. */
export function quizReport(score: number, total: number, missed: string[]): string {
  return `Quiz result: ${score} out of ${total}. ${missed.length ? `Questions they missed: ${missed.map((q) => `"${q}"`).join("; ")}.` : "They missed nothing."}`;
}

/** Sent when the student finishes the quiz, and again if Ceeq says nothing to it. */
export function quizResultPrompt(report: string): string {
  return `(${report} Respond as instructed for a quiz result.)`;
}

/** How many times in a row a connection is replaced without Ceeq managing a turn before the lesson is paused instead. */
export const MAX_RECONNECTS = 3;

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
 * Sent when a reply was due from Ceeq and none came: the voice service
 * sometimes returns an empty turn, or calls a tool and then says nothing.
 */
export const SPEAK_UP = "(Nothing was heard from you. Say your reply to the student now: tools first, then speak.)";

/** How many empty turns in a row are answered with SPEAK_UP before the app stops asking. */
export const MAX_SILENT_TURNS = 3;

/**
 * Once prompted, Ceeq takes a second or two to start speaking. So she is
 * prompted this long before the paragraph she is on finishes playing, and the
 * next one follows after a breath instead of a silence. Her speech arrives
 * several times faster than it is spoken, so there is always time to do this.
 */
export const LEAD_MS = 1500;
/**
 * A prompt to carry on is held back while the mic hears a voice, so that a
 * question asked between two paragraphs is heard out and answered instead of
 * being talked over. It is looked at again this often, for at most this long:
 * a room that is simply loud must not hold the lesson up.
 */
export const HOLD_STEP_MS = 300;
export const MAX_HOLD_MS = 6000;
/** After she has answered the student, wait longer so they can follow up. */
export const GAP_AFTER_STUDENT_MS = 2500;
/** If nothing at all happens for this long while she should be explaining, prompt her anyway. */
export const SILENCE_MS = 9000;
