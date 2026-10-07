import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ChapterRef, StudentProfile } from "@codeeaq/shared-types";
import { classKey, useProfile } from "./profile";
import { chapterKey } from "./progress";
import { useHydrated } from "./storage";
import { findChapter, useSyllabus } from "./syllabus";

export interface ChapterRouteProps {
  subjectId: string;
  chapterId: string;
  /** Names for a chapter the student typed in rather than picked from the syllabus. */
  custom?: { subject: string; chapter: string };
}

/** The chapter a page is about, resolved from the route and the stored syllabus. */
export interface ChapterTarget {
  profile: StudentProfile;
  subject: string;
  subjectId: string;
  chapter: string;
  chapterId: string;
  unit?: string;
  /** Storage key for this chapter's progress and quizzes. */
  key: string;
  /** What the backend needs to know about the chapter. */
  ref: ChapterRef;
  /** Link to the chapter page, or to one of its modules. */
  href: (moduleId?: string, options?: { quiz?: boolean }) => string;
}

export type TargetState = { status: "loading" } | { status: "missing" } | { status: "ready"; target: ChapterTarget };

/** Resolves the route to a chapter; sends students without a profile to setup. */
export function useChapterTarget({ subjectId, chapterId, custom }: ChapterRouteProps): TargetState {
  const router = useRouter();
  const hydrated = useHydrated();
  const profile = useProfile();
  const { state } = useSyllabus(custom ? undefined : profile);

  useEffect(() => {
    if (hydrated && !profile) router.replace("/");
  }, [hydrated, profile, router]);

  return useMemo((): TargetState => {
    if (!profile) return { status: "loading" };
    let names: { subject: string; chapter: string; unit?: string };
    let ids = { subjectId, chapterId };
    if (custom) {
      names = custom;
      ids = { subjectId: "custom", chapterId };
    } else {
      if (state.status === "error") return { status: "missing" };
      if (state.status !== "ready") return { status: "loading" };
      const found = findChapter(state.syllabus, subjectId, chapterId);
      if (!found) return { status: "missing" };
      names = { subject: found.subject.name, chapter: found.chapter.title, unit: found.chapter.unit };
    }

    const query = custom ? new URLSearchParams(custom) : new URLSearchParams();
    const base = `/learn/${encodeURIComponent(ids.subjectId)}/${encodeURIComponent(ids.chapterId)}`;
    return {
      status: "ready",
      target: {
        profile,
        ...names,
        ...ids,
        key: chapterKey(classKey(profile), ids.subjectId, ids.chapterId),
        ref: { profile, subject: names.subject, chapter: names.chapter, ...(names.unit ? { unit: names.unit } : {}) },
        href: (moduleId, options) => {
          const q = new URLSearchParams(query);
          if (options?.quiz) q.set("quiz", "1");
          const qs = q.toString();
          return `${base}${moduleId ? `/${encodeURIComponent(moduleId)}` : ""}${qs ? `?${qs}` : ""}`;
        },
      },
    };
  }, [profile, custom, subjectId, chapterId, state]);
}
