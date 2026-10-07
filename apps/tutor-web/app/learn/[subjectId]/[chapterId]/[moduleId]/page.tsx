import { LessonScreen } from "@/features/lesson/LessonScreen";
import { customChapter } from "@/lib/route";

export default async function Page({ params, searchParams }: PageProps<"/learn/[subjectId]/[chapterId]/[moduleId]">) {
  const { subjectId, chapterId, moduleId } = await params;
  const query = await searchParams;
  return (
    <LessonScreen
      subjectId={decodeURIComponent(subjectId)}
      chapterId={decodeURIComponent(chapterId)}
      moduleId={decodeURIComponent(moduleId)}
      custom={customChapter(subjectId, query)}
      startWithQuiz={query.quiz === "1"}
    />
  );
}
