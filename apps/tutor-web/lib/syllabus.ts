import { useCallback, useEffect, useState } from "react";
import type { StudentProfile, Syllabus } from "@codeeaq/shared-types";
import { fetchSyllabus } from "./firebase";
import { classKey } from "./profile";
import { readJson, writeJson } from "./storage";

// Syllabi rarely change, so each class's copy is kept on the device and shown
// instantly on later visits, while a fresh copy loads quietly in the background.

const VERSION = 1;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface Cached {
  version: number;
  savedAt: number;
  syllabus: Syllabus;
}

const storageKey = (key: string) => `ceeq:syllabus:${key}`;

function readCached(key: string): Cached | undefined {
  const cached = readJson<Cached>(storageKey(key));
  return cached?.version === VERSION && Array.isArray(cached.syllabus?.subjects) ? cached : undefined;
}

export type SyllabusState =
  | { status: "loading" }
  | { status: "ready"; syllabus: Syllabus }
  | { status: "error"; message: string };

export function useSyllabus(profile: StudentProfile | undefined) {
  const key = profile ? classKey(profile) : undefined;
  const [state, setState] = useState<SyllabusState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!profile || !key) return;
    let cancelled = false;
    const cached = readCached(key);
    // Showing the stored copy is synchronising with an external store (device storage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(cached ? { status: "ready", syllabus: cached.syllabus } : { status: "loading" });
    if (cached && Date.now() - cached.savedAt < REFRESH_AFTER_MS && attempt === 0) return;

    fetchSyllabus({ board: profile.board, classLevel: profile.classLevel, stream: profile.stream })
      .then((syllabus) => {
        writeJson(storageKey(key), { version: VERSION, savedAt: Date.now(), syllabus } satisfies Cached);
        if (!cancelled) setState({ status: "ready", syllabus });
      })
      .catch((err: unknown) => {
        if (cancelled || cached) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "Could not load the syllabus." });
      });
    return () => {
      cancelled = true;
    };
    // The profile object is re-created on storage changes; its key captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state: profile ? state : ({ status: "loading" } as const), retry };
}

/** Finds a subject and chapter in the stored syllabus, for deep links. */
export function findChapter(syllabus: Syllabus, subjectId: string, chapterId: string) {
  const subject = syllabus.subjects.find((s) => s.id === subjectId);
  const chapter = subject?.chapters.find((c) => c.id === chapterId);
  return subject && chapter ? { subject, chapter } : undefined;
}
