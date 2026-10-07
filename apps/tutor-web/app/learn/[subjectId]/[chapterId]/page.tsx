import { ChapterScreen } from "@/features/chapter/ChapterScreen";
import { customChapter } from "@/lib/route";

export default async function Page({ params, searchParams }: PageProps<"/learn/[subjectId]/[chapterId]">) {
  const { subjectId, chapterId } = await params;
  return (
    <ChapterScreen
      subjectId={decodeURIComponent(subjectId)}
      chapterId={decodeURIComponent(chapterId)}
      custom={customChapter(subjectId, await searchParams)}
    />
  );
}
