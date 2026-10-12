import { QUIZ_PASS_SHARE, type ModuleProgress } from './lesson.js';

// Weak spots: the goals a student got wrong, in spoken practice or in a quiz.
// Each one stays on the student's "to revise" list until Ceeq has taught it
// again and the student has answered it correctly, and then once more a few
// days later, to check that it stuck.

export interface WeakSpot {
  /** Wrong answers on this goal since it was last cleared. */
  misses: number;
  /** What went wrong, most recent last: the misconception Ceeq noticed, or the quiz question missed. */
  notes: string[];
  /** Revisions passed so far. 0 means the goal still has to be taught again. */
  step: number;
  /** When to remind the student. Now or earlier means it is due. */
  dueAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How many days after each passed revision Ceeq checks the goal again. When a
 * check is passed and no gap is left, the goal is no longer a weak spot.
 */
export const REVIEW_GAPS_DAYS = [3];
const MAX_NOTES = 4;
const NOTE_LENGTH = 160;

const tidy = (note: string | undefined) => (note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_LENGTH);

/** The student got the goal wrong: it is due for revision now, from the start. */
export function missSpot(spot: WeakSpot | null | undefined, note: string | undefined, now: number): WeakSpot {
  const text = tidy(note);
  const notes = spot?.notes ?? [];
  return {
    misses: (spot?.misses ?? 0) + 1,
    notes: text && !notes.includes(text) ? [...notes, text].slice(-MAX_NOTES) : notes,
    step: 0,
    dueAt: now,
  };
}

/**
 * The student showed they have the goal. Counts only when the spot is due, so
 * being told twice in one sitting does not clear it. Returns null once cleared.
 */
export function passSpot(spot: WeakSpot | null | undefined, now: number): WeakSpot | null {
  if (!spot) return null;
  if (spot.dueAt > now) return spot;
  const gap = REVIEW_GAPS_DAYS[spot.step];
  return gap === undefined ? null : { ...spot, step: spot.step + 1, dueAt: now + gap * DAY_MS };
}

function withSpot(module: ModuleProgress, index: number, change: (spot: WeakSpot | null) => WeakSpot | null): ModuleProgress {
  if (!Number.isInteger(index) || index < 0 || index >= module.goals.length) return module;
  const weak = module.goals.map((_, i) => module.weak[i] ?? null);
  weak[index] = change(weak[index]);
  return { ...module, weak };
}

/** Records a wrong answer on one goal (by index). */
export function markMissed(module: ModuleProgress, index: number, note: string | undefined, now: number): ModuleProgress {
  return withSpot(module, index, (spot) => missSpot(spot, note, now));
}

/** Records that the student has shown they understand one goal (by index). */
export function markRevised(module: ModuleProgress, index: number, now: number): ModuleProgress {
  return withSpot(module, index, (spot) => passSpot(spot, now));
}

/** One answer from a finished quiz. `goal` is the goal number the question tested, starting at 1. */
export interface QuizAnswer {
  question: string;
  goal?: number;
  correct: boolean;
}

/**
 * Turns a finished quiz into weak spots: each missed question marks the goal
 * it tested. If the quiz was not passed and no missed question names a goal,
 * the whole module is marked, so a failed quiz always leaves something to revise.
 * Right answers never clear a weak spot: a quiz can be retaken from memory.
 */
export function applyQuizAnswers(module: ModuleProgress, answers: QuizAnswer[], now: number): ModuleProgress {
  let next = module;
  let placed = 0;
  for (const a of answers) {
    if (a.correct) continue;
    const index = typeof a.goal === 'number' ? a.goal - 1 : -1;
    if (index < 0 || index >= module.goals.length) continue;
    next = markMissed(next, index, `Quiz question missed: ${a.question}`, now);
    placed++;
  }
  const wrong = answers.filter((a) => !a.correct).length;
  const passed = answers.length > 0 && (answers.length - wrong) / answers.length >= QUIZ_PASS_SHARE;
  if (!passed && wrong > 0 && placed === 0) {
    module.goals.forEach((_, i) => {
      next = markMissed(next, i, 'Did not pass the module quiz', now);
    });
  }
  return next;
}

export interface WeakGoal {
  /** Index of the goal in the module plan. */
  index: number;
  spot: WeakSpot;
  /** True when it is time to revise it; false when a later check is scheduled. */
  due: boolean;
}

/** A module's weak spots, in goal order. */
export function weakGoals(module: ModuleProgress | undefined, now: number): WeakGoal[] {
  const out: WeakGoal[] = [];
  module?.weak.forEach((spot, index) => {
    if (spot && index < module.goals.length) out.push({ index, spot, due: spot.dueAt <= now });
  });
  return out;
}

/** The weak spots that are due for revision now. */
export function dueGoals(module: ModuleProgress | undefined, now: number): WeakGoal[] {
  return weakGoals(module, now).filter((g) => g.due);
}

/** Validates a weak spot read from storage. */
export function parseWeakSpot(value: unknown): WeakSpot | null {
  const v = value as Partial<WeakSpot> | null;
  if (typeof v !== 'object' || v === null || typeof v.dueAt !== 'number' || !Number.isFinite(v.dueAt)) return null;
  const whole = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0);
  return {
    misses: Math.max(1, whole(v.misses)),
    notes: Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === 'string').map(tidy).filter(Boolean).slice(-MAX_NOTES) : [],
    step: Math.min(whole(v.step), REVIEW_GAPS_DAYS.length),
    dueAt: v.dueAt,
  };
}

// ---------- Revision lessons ----------

/** One weak spot Ceeq is asked to go over in a revision lesson. */
export interface RevisionTopic {
  /** Goal number in the module, starting at 1. */
  goal: number;
  /** What went wrong before, most recent last. */
  notes: string[];
  /** True when the student has already revised this goal once and it only needs checking. */
  check: boolean;
}

/** What a revision lesson is asked to cover, from a module's due weak spots. */
export function revisionTopics(due: WeakGoal[]): RevisionTopic[] {
  return due.map(({ index, spot }) => ({ goal: index + 1, notes: spot.notes, check: spot.step > 0 }));
}

/** Validates untrusted revision topics (a callable's data). Null if any is unusable. */
export function parseRevisionTopics(value: unknown, goalCount: number): RevisionTopic[] | null {
  if (!Array.isArray(value) || !value.length || value.length > goalCount) return null;
  const seen = new Set<number>();
  const out: RevisionTopic[] = [];
  for (const raw of value as { goal?: unknown; notes?: unknown; check?: unknown }[]) {
    const goal = typeof raw?.goal === 'number' && Number.isInteger(raw.goal) ? raw.goal : 0;
    if (goal < 1 || goal > goalCount || seen.has(goal)) return null;
    if (raw.notes !== undefined && !Array.isArray(raw.notes)) return null;
    seen.add(goal);
    const notes = ((raw.notes as unknown[] | undefined) ?? []).filter((n): n is string => typeof n === 'string').map(tidy).filter(Boolean);
    out.push({ goal, notes: notes.slice(-MAX_NOTES), check: raw.check === true });
  }
  return out;
}
