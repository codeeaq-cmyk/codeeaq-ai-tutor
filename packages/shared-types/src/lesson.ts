import type { StudentProfile } from './profile.js';
import { slugify } from './syllabus.js';

// A chapter is taught as a sequence of modules. Each module has a few goals
// Ceeq teaches, then a quiz. Lessons and quizzes can be repeated freely.

// ---------- Chapter plan ----------

export interface ModulePlan {
  id: string;
  title: string;
  /** What the student should be able to do after the module, in teaching order. */
  goals: string[];
}

export interface ChapterPlan {
  modules: ModulePlan[];
}

/** Identifies the chapter being studied in requests to the backend. */
export interface ChapterRef {
  profile: StudentProfile;
  subject: string;
  chapter: string;
  unit?: string;
}

export type GetChapterPlanRequest = ChapterRef;

const MAX_MODULES = 8;
const MAX_GOALS = 5;

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Validates an untrusted plan (model output or device storage), assigning unique ids. */
export function parseChapterPlan(value: unknown): ChapterPlan | null {
  const raw = (value as { modules?: unknown } | null)?.modules;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const modules: ModulePlan[] = [];
  for (const m of raw.slice(0, MAX_MODULES) as { id?: unknown; title?: unknown; goals?: unknown }[]) {
    const title = line(m?.title, 80);
    const goals = Array.isArray(m?.goals) ? m.goals.map((g) => line(g, 140)).filter(Boolean).slice(0, MAX_GOALS) : [];
    if (!title || !goals.length) continue;
    let id = line(m.id, 60) || slugify(title);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    modules.push({ id, title, goals });
  }
  return modules.length ? { modules } : null;
}

/** Used when a plan can't be generated, so the chapter can still be learned. */
export function fallbackChapterPlan(chapter: string): ChapterPlan {
  return {
    modules: [
      {
        id: 'full-chapter',
        title: chapter,
        goals: ['Understand the key ideas of this chapter', 'Apply them to textbook-style questions'],
      },
    ],
  };
}

// ---------- Quiz ----------

export interface QuizQuestion {
  question: string;
  /** Exactly four options. */
  options: string[];
  /** Index of the correct option. */
  answer: number;
  explanation: string;
}

export interface Quiz {
  questions: QuizQuestion[];
  createdAt: number;
}

export interface GetQuizRequest extends ChapterRef {
  module: { title: string; goals: string[] };
  /** Questions the student has already seen, so new ones differ. */
  avoid?: string[];
}

export const QUIZ_LENGTH = 5;
export const QUIZ_PASS_SHARE = 0.6;

/**
 * Validates untrusted quiz questions. With a `random` source, each question's
 * options are shuffled, because models tend to put the right answer first.
 */
export function parseQuizQuestions(value: unknown, random?: () => number): QuizQuestion[] {
  const raw = (value as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw)) return [];
  const out: QuizQuestion[] = [];
  for (const q of raw as { question?: unknown; options?: unknown; answer?: unknown; explanation?: unknown }[]) {
    const question = line(q?.question, 400);
    const options = Array.isArray(q?.options) ? q.options.map((o) => line(o, 200)) : [];
    const answer = typeof q?.answer === 'number' ? Math.round(q.answer) : -1;
    if (!question || options.length !== 4 || options.some((o) => !o) || new Set(options).size !== 4) continue;
    if (answer < 0 || answer > 3) continue;
    const order = [0, 1, 2, 3];
    for (let i = 3; random && i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    out.push({
      question,
      options: order.map((i) => options[i]),
      answer: order.indexOf(answer),
      explanation: line(q.explanation, 400),
    });
    if (out.length === QUIZ_LENGTH) break;
  }
  return out;
}

// ---------- Progress (kept on the student's device) ----------

export type GoalStatus = 'todo' | 'learning' | 'understood' | 'practice';

export interface QuizAttempt {
  score: number;
  total: number;
  at: number;
}

export interface ModuleProgress {
  /** One status per goal in the module plan. */
  goals: GoalStatus[];
  /** Ceeq finished teaching the module at least once. */
  learned: boolean;
  attempts: QuizAttempt[];
  /** Answers to Ceeq's spoken check questions. */
  correct: number;
  incorrect: number;
  mistakes: string[];
}

export interface ChapterProgress {
  plan: ChapterPlan;
  modules: Record<string, ModuleProgress>;
  updatedAt: number;
}

export function emptyModuleProgress(goalCount: number): ModuleProgress {
  return { goals: Array.from({ length: goalCount }, () => 'todo'), learned: false, attempts: [], correct: 0, incorrect: 0, mistakes: [] };
}

export function bestAttempt(module: ModuleProgress | undefined): QuizAttempt | undefined {
  return module?.attempts.reduce<QuizAttempt | undefined>(
    (best, a) => (!best || a.score / a.total > best.score / best.total ? a : best),
    undefined,
  );
}

export type ModuleState = 'new' | 'learning' | 'quiz-ready' | 'passed';

export function moduleState(module: ModuleProgress | undefined): ModuleState {
  const best = bestAttempt(module);
  if (best && best.score / best.total >= QUIZ_PASS_SHARE) return 'passed';
  if (module?.learned || best) return 'quiz-ready';
  if (module?.goals.some((g) => g !== 'todo')) return 'learning';
  return 'new';
}

/** Share of the chapter's modules passed, 0 to 1. */
export function chapterMastery(progress: ChapterProgress | undefined): number {
  const modules = progress?.plan.modules ?? [];
  if (!modules.length) return 0;
  return modules.filter((m) => moduleState(progress!.modules[m.id]) === 'passed').length / modules.length;
}

// ---------- Voice session ----------

export interface StartVoiceRequest extends ChapterRef {
  module: { title: string; goals: string[] };
  /** Titles of every module in the chapter, in order, so Ceeq knows what is taught elsewhere. */
  chapterModules: string[];
}

export interface StartVoiceResponse {
  /** One-use ephemeral Gemini Live token. */
  token: string;
  model: string;
}

// ---------- Lesson tools (what the voice model sees) ----------

export const PROGRESS_TOOL = {
  name: 'update_progress',
  description:
    'Update one goal on the student\'s checklist. "learning" when you start teaching it, "understood" once the student answered a check question correctly on their own, "practice" if they still struggle after re-explaining.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      goal: { type: 'integer', description: 'Goal number from the module, starting at 1.' },
      status: { type: 'string', enum: ['learning', 'understood', 'practice'] },
    },
    required: ['goal', 'status'],
  },
};

export const ANSWER_TOOL = {
  name: 'record_answer',
  description: "Record the student's answer to a question you asked. Call right after judging each answer.",
  parametersJsonSchema: {
    type: 'object',
    properties: {
      correct: { type: 'boolean' },
      mistake: {
        type: 'string',
        description: 'If incorrect: the misconception in a few words, e.g. "confused numerator and denominator".',
      },
    },
    required: ['correct'],
  },
};

export const FINISH_MODULE_TOOL = {
  name: 'finish_module',
  description:
    'Call once every goal of the module has been taught and checked. The app then shows the student the module quiz on screen.',
  parametersJsonSchema: { type: 'object', properties: {} },
};

// ---------- Tool argument validation ----------

export function parseProgressUpdate(args: unknown, goalCount: number): { index: number; status: GoalStatus } | null {
  const a = args as { goal?: unknown; status?: unknown } | null;
  const index = typeof a?.goal === 'number' ? Math.round(a.goal) - 1 : -1;
  const status = (['learning', 'understood', 'practice'] as const).find((s) => s === a?.status);
  return index >= 0 && index < goalCount && status ? { index, status } : null;
}

export function parseAnswer(args: unknown): { correct: boolean; mistake?: string } | null {
  const a = args as { correct?: unknown; mistake?: unknown } | null;
  if (typeof a?.correct !== 'boolean') return null;
  const mistake = typeof a.mistake === 'string' ? a.mistake.trim().slice(0, 80) : '';
  return a.correct || !mistake ? { correct: a.correct } : { correct: false, mistake };
}
