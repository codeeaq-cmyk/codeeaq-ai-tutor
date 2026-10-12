/** Names of a chapter the student typed in, carried in the query string of /learn/custom/... routes. */
export function customChapter(subjectId: string, query: Record<string, string | string[] | undefined>) {
  const { subject, chapter } = query;
  return subjectId === "custom" && typeof subject === "string" && typeof chapter === "string"
    ? { subject: subject.slice(0, 80), chapter: chapter.slice(0, 150) }
    : undefined;
}

export interface LessonLinkOptions {
  /** Open the module on its quiz. */
  quiz?: boolean;
  /** Open the module as a revision of its weak spots. */
  revise?: boolean;
}

/**
 * Link to a chapter page, or to one of its modules. A chapter the student
 * typed in carries its names in the query string (`custom`).
 */
export function chapterHref(
  ids: { subjectId: string; chapterId: string },
  custom: { subject: string; chapter: string } | undefined,
  moduleId?: string,
  options?: LessonLinkOptions,
): string {
  const query = custom ? new URLSearchParams(custom) : new URLSearchParams();
  if (options?.quiz) query.set("quiz", "1");
  if (options?.revise) query.set("revise", "1");
  const qs = query.toString();
  const base = `/learn/${encodeURIComponent(ids.subjectId)}/${encodeURIComponent(ids.chapterId)}`;
  return `${base}${moduleId ? `/${encodeURIComponent(moduleId)}` : ""}${qs ? `?${qs}` : ""}`;
}

/** Where to send someone after signing in: a page of this app they were heading to, or home. */
export function safeNext(next: string | string[] | undefined): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}
