import {
  emptyModuleProgress,
  parseChapterPlan,
  parseWeakSpot,
  type ChapterPlan,
  type ChapterProgress,
  type GoalStatus,
  type ModuleProgress,
  type QuizAttempt,
} from "@codeeaq/shared-types";
import { readJson, studentKey, useStored, writeJson } from "./storage";

// A student's progress per chapter: its module plan, what they have learned,
// their quiz attempts and the goals they still have to revise. Kept on the
// device under the student's id and saved to their account (see sync.ts).
// Keyed by class, subject and chapter so switching class keeps both histories.

const NAME = "progress:v2";
/** Where progress was kept before students signed in. */
const DEVICE_KEY = "ceeq:progress:v2";
const MAX_ATTEMPTS = 50;

export type ProgressMap = Record<string, ChapterProgress>;
export type ChapterNames = NonNullable<ChapterProgress["names"]>;

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
    weak: Array.from({ length: goalCount }, (_, i) => parseWeakSpot(Array.isArray(v.weak) ? v.weak[i] : null)),
  };
}

function parseNames(value: unknown): ChapterNames | undefined {
  const v = value as Partial<ChapterNames> | null;
  return typeof v?.subject === "string" && v.subject && typeof v.chapter === "string" && v.chapter
    ? { subject: v.subject.slice(0, 80), chapter: v.chapter.slice(0, 160) }
    : undefined;
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
  const names = parseNames(v?.names);
  return { plan, modules, updatedAt: typeof v?.updatedAt === "number" ? v.updatedAt : 0, ...(names ? { names } : {}) };
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

const readAll = (): ProgressMap => parseMap(readJson(studentKey(NAME))) ?? {};

let onSaved: ((key: string) => void) | undefined;

/** Lets the account sync hear which chapter changed without this module depending on it. */
export function onProgressSaved(listener: (key: string) => void): void {
  onSaved = listener;
}

function save(all: ProgressMap, key: string, chapter: ChapterProgress): void {
  writeJson(studentKey(NAME), { ...all, [key]: chapter });
  onSaved?.(key);
}

export function useAllProgress(): ProgressMap {
  return useStored(studentKey(NAME), parseMap) ?? EMPTY;
}

export function useChapterProgress(key: string): ChapterProgress | undefined {
  return useAllProgress()[key];
}

/** The latest stored progress, read outside render (e.g. in a tool call). */
export function readChapterProgress(key: string): ChapterProgress | undefined {
  return readAll()[key];
}

/**
 * Stores a chapter's module plan, keeping any progress on modules that still
 * exist. The chapter's names are stored with it when given.
 */
export function savePlan(key: string, plan: ChapterPlan, names?: ChapterNames): void {
  const all = readAll();
  const current = all[key];
  const kept = names ?? current?.names;
  save(all, key, { plan, modules: current?.modules ?? {}, updatedAt: current?.updatedAt ?? 0, ...(kept ? { names: kept } : {}) });
}

/**
 * Applies a change to one module on top of the latest stored value, so rapid
 * tool calls never lose updates. No-op if the chapter has no plan yet.
 */
export function updateModule(key: string, moduleId: string, change: (current: ModuleProgress) => ModuleProgress): void {
  const all = readAll();
  const chapter = all[key];
  const plan = chapter?.plan.modules.find((m) => m.id === moduleId);
  if (!chapter || !plan) return;
  const current = chapter.modules[moduleId] ?? emptyModuleProgress(plan.goals.length);
  save(all, key, { ...chapter, modules: { ...chapter.modules, [moduleId]: change(current) }, updatedAt: Date.now() });
}

// ---------- Keeping the device and the account in step ----------

/**
 * Combines this device's progress with the account's copy, chapter by
 * chapter: whichever was changed later wins, and the account wins a tie, so
 * every device ends up with the same module plan. `stale` lists the chapters
 * whose account copy is missing or older and should be saved again.
 */
export function mergeChapters(local: ProgressMap, cloud: Record<string, unknown>): { merged: ProgressMap; stale: string[] } {
  const merged: ProgressMap = { ...local };
  const theirs: ProgressMap = {};
  for (const [key, value] of Object.entries(cloud)) {
    const chapter = parseChapter(value);
    if (!chapter) continue;
    theirs[key] = chapter;
    if (!local[key] || chapter.updatedAt >= local[key].updatedAt) merged[key] = chapter;
  }
  const stale = Object.keys(local).filter((key) => !theirs[key] || local[key].updatedAt > theirs[key].updatedAt);
  return { merged, stale };
}

/** Brings the account's progress onto this device. Returns the chapters to save back to the account. */
export function mergeProgress(cloud: Record<string, unknown>): string[] {
  const { merged, stale } = mergeChapters(readAll(), cloud);
  writeJson(studentKey(NAME), merged);
  return stale;
}

/** Progress made on this device before sign-in existed goes to the first student who signs in. */
export function adoptDeviceProgress(): void {
  const old = parseMap(readJson(DEVICE_KEY));
  if (readJson(DEVICE_KEY) === undefined) return;
  if (old && Object.keys(old).length) writeJson(studentKey(NAME), mergeChapters(readAll(), old).merged);
  writeJson(DEVICE_KEY, undefined);
}
