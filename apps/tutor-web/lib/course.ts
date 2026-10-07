import { useCallback, useEffect, useRef, useState } from "react";
import {
  fallbackChapterPlan,
  parseQuizQuestions,
  type ChapterPlan,
  type ChapterRef,
  type ModulePlan,
  type Quiz,
} from "@codeeaq/shared-types";
import { fetchChapterPlan, fetchQuiz } from "./firebase";
import { savePlan, useChapterProgress } from "./progress";
import { readJson, writeJson } from "./storage";

// ---------- Chapter plan ----------

export type PlanState =
  | { status: "loading" }
  /** `provisional` means planning failed and the whole chapter is offered as one module. */
  | { status: "ready"; plan: ChapterPlan; provisional: boolean };

const planRequests = new Map<string, Promise<ChapterPlan>>();
const FALLBACK_ID = fallbackChapterPlan("").modules[0].id;

/**
 * The chapter's modules. Stored with the chapter's progress once generated, so
 * later visits are instant and module ids stay stable.
 */
export function useChapterPlan(key: string | undefined, ref: ChapterRef | undefined) {
  const stored = useChapterProgress(key ?? "")?.plan;
  // A stored single-lesson fallback (kept so progress can be saved) is retried once per visit.
  const storedIsFallback = stored?.modules[0]?.id === FALLBACK_ID;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tried = useRef<string | null>(null);

  useEffect(() => {
    if (!key || !ref || (stored && !storedIsFallback)) return;
    const attemptKey = `${key}#${attempt}`;
    if (tried.current === attemptKey) return;
    tried.current = attemptKey;
    let request = planRequests.get(key);
    if (!request) {
      request = fetchChapterPlan(ref);
      planRequests.set(key, request);
      void request.finally(() => planRequests.delete(key)).catch(() => {});
    }
    // Not cancelled on cleanup: the result is saved to storage for whoever views the chapter next.
    request
      .then((plan) => savePlan(key, plan))
      .catch((err: unknown) => {
        console.warn("Chapter plan failed:", err);
        setFailed(true);
      });
    // `ref` is rebuilt each render; the key identifies the chapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stored, storedIsFallback, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const state: PlanState = stored
    ? { status: "ready", plan: stored, provisional: storedIsFallback }
    : failed && ref
      ? { status: "ready", plan: fallbackChapterPlan(ref.chapter), provisional: true }
      : { status: "loading" };
  return { state, retry };
}

// ---------- Quizzes ----------

interface StoredQuiz {
  quiz: Quiz;
  /** Every question shown so far, so a fresh quiz can avoid them. */
  seen: string[];
}

const MAX_SEEN = 30;
const quizStorageKey = (chapterKey: string, moduleId: string) => `ceeq:quiz:v1:${chapterKey}/${moduleId}`;

function readStoredQuiz(chapterKey: string, moduleId: string): StoredQuiz | undefined {
  const stored = readJson<StoredQuiz>(quizStorageKey(chapterKey, moduleId));
  const questions = parseQuizQuestions(stored?.quiz);
  if (!questions.length) return undefined;
  return {
    quiz: { questions, createdAt: typeof stored?.quiz?.createdAt === "number" ? stored.quiz.createdAt : 0 },
    seen: Array.isArray(stored?.seen) ? stored.seen.filter((s) => typeof s === "string").slice(-MAX_SEEN) : [],
  };
}

const quizRequests = new Map<string, Promise<Quiz>>();

/**
 * Returns the module's quiz: the stored one, or a newly written one. With
 * `fresh`, always writes new questions that differ from those already seen.
 * Concurrent calls share one request, so prefetching during the lesson and
 * opening the quiz afterwards never generate twice.
 */
export function loadQuiz(chapterKey: string, ref: ChapterRef, module: ModulePlan, fresh = false): Promise<Quiz> {
  const stored = readStoredQuiz(chapterKey, module.id);
  if (stored && !fresh) return Promise.resolve(stored.quiz);

  const requestKey = `${chapterKey}/${module.id}`;
  let request = quizRequests.get(requestKey);
  if (!request) {
    const seen = stored?.seen ?? [];
    request = fetchQuiz({ ...ref, module: { title: module.title, goals: module.goals }, ...(seen.length ? { avoid: seen } : {}) }).then(
      (quiz) => {
        const all = [...seen, ...quiz.questions.map((q) => q.question)].slice(-MAX_SEEN);
        writeJson(quizStorageKey(chapterKey, module.id), { quiz, seen: all } satisfies StoredQuiz);
        return quiz;
      },
    );
    quizRequests.set(requestKey, request);
    void request.finally(() => quizRequests.delete(requestKey)).catch(() => {});
  }
  return request;
}

/** Starts writing the quiz in the background so it is ready when the lesson ends. */
export function prefetchQuiz(chapterKey: string, ref: ChapterRef, module: ModulePlan): void {
  loadQuiz(chapterKey, ref, module).catch((err: unknown) => console.warn("Quiz prefetch failed:", err));
}
