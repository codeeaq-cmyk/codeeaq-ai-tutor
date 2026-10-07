/** Names of a chapter the student typed in, carried in the query string of /learn/custom/... routes. */
export function customChapter(subjectId: string, query: Record<string, string | string[] | undefined>) {
  const { subject, chapter } = query;
  return subjectId === "custom" && typeof subject === "string" && typeof chapter === "string"
    ? { subject: subject.slice(0, 80), chapter: chapter.slice(0, 150) }
    : undefined;
}
