import {
  emptyModuleProgress,
  parseChapterPlan,
  type ChapterPlan,
  type ChapterProgress,
  type GoalStatus,
  type ModuleProgress,
  type QuizAttempt,
} from "@codeeaq/shared-types";
import { readJson, useStored, writeJson } from "./storage";

// Progress per chapter, on this device until accounts and a database arrive.
// Keyed by class, subject and chapter so switching class keeps both histories.

const KEY = "ceeq:progress:v2";
const MAX_ATTEMPTS = 50;

type ProgressMap = Record<string, ChapterProgress>;

const STATUSES: GoalStatus[] = ["todo", "learning", "understood", "practice"];
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);

function parseModule(value: unknown, goalCount: number): ModuleProgress {
  const v = (value ?? {}) as Partial<ModuleProgress>;
  const goals = Array.from({ length: goalCount }, (_, i) => (STATUSES.includes(v.goals?.[i] as GoalStatus) ? v.goals![i] : "todo"));
  const attempts = Array.isArray(v.attempts)
    ? v.attempts
        .filter((a): a is QuizAttempt => count(a?.total) > 0 && count(a?.score) <= a.total && typeof a?.at === "number")
        .slice(-MAX_ATTEMPTS)
    : [];
  return {
    goals,
    explained: v.explained === true,
    learned: v.learned === true,
    attempts,
    correct: count(v.correct),
    incorrect: count(v.incorrect),
    mistakes: Array.isArray(v.mistakes) ? v.mistakes.filter((m) => typeof m === "string").slice(-10) : [],
  };
}

function parseChapter(value: unknown): ChapterProgress | undefined {
  const v = value as Partial<ChapterProgress> | null;
  const plan = parseChapterPlan(v?.plan);
  if (!plan) return undefined;
  const modules: ChapterProgress["modules"] = {};
  for (const m of plan.modules) {
    const stored = (v?.modules as Record<string, unknown> | undefined)?.[m.id];
    if (stored) modules[m.id] = parseModule(stored, m.goals.length);
  }
  return { plan, modules, updatedAt: typeof v?.updatedAt === "number" ? v.updatedAt : 0 };
}

function parseMap(value: unknown): ProgressMap | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: ProgressMap = {};
  for (const [key, chapter] of Object.entries(value)) {
    const parsed = parseChapter(chapter);
    if (parsed) out[key] = parsed;
  }
  return out;
}

export function chapterKey(classKey: string, subjectId: string, chapterId: string) {
  return `${classKey}/${subjectId}/${chapterId}`;
}

const EMPTY: ProgressMap = {};

export function useAllProgress(): ProgressMap {
  return useStored(KEY, parseMap) ?? EMPTY;
}

export function useChapterProgress(key: string): ChapterProgress | undefined {
  return useAllProgress()[key];
}

/** The latest stored progress, read outside render (e.g. in a tool call). */
export function readChapterProgress(key: string): ChapterProgress | undefined {
  return parseMap(readJson(KEY))?.[key];
}

/** Stores a chapter's module plan, keeping any progress on modules that still exist. */
export function savePlan(key: string, plan: ChapterPlan): void {
  const all = parseMap(readJson(KEY)) ?? {};
  const current = all[key];
  writeJson(KEY, { ...all, [key]: { plan, modules: current?.modules ?? {}, updatedAt: current?.updatedAt ?? 0 } });
}

/**
 * Applies a change to one module on top of the latest stored value, so rapid
 * tool calls never lose updates. No-op if the chapter has no plan yet.
 */
export function updateModule(key: string, moduleId: string, change: (current: ModuleProgress) => ModuleProgress): void {
  const all = parseMap(readJson(KEY)) ?? {};
  const chapter = all[key];
  const plan = chapter?.plan.modules.find((m) => m.id === moduleId);
  if (!chapter || !plan) return;
  const current = chapter.modules[moduleId] ?? emptyModuleProgress(plan.goals.length);
  writeJson(KEY, {
    ...all,
    [key]: { ...chapter, modules: { ...chapter.modules, [moduleId]: change(current) }, updatedAt: Date.now() },
  });
}
