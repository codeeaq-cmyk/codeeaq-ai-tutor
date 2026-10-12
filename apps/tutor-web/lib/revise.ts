import { weakGoals, type ModulePlan, type Syllabus, type WeakGoal } from "@codeeaq/shared-types";
import type { ProgressMap } from "./progress";
import { chapterHref } from "./route";

// What a student has to revise, gathered from every chapter of their class:
// the goals they got wrong in practice or in a quiz (see revision.ts in
// shared-types). Shown as a reminder on the home page.

export interface ModuleToRevise {
  /** Unique across chapters. */
  id: string;
  subject: string;
  chapter: string;
  module: ModulePlan;
  /** Opens the revision lesson for this module. */
  href: string;
  /** Weak spots to revise now, in goal order. */
  due: WeakGoal[];
  /** Weak spots already revised once, waiting for their check on a later day. */
  later: WeakGoal[];
}

/** Every module of the class with something to revise, the longest-waiting first. */
export function modulesToRevise(progress: ProgressMap, classKey: string, syllabus: Syllabus | undefined, now: number): ModuleToRevise[] {
  const out: ModuleToRevise[] = [];
  for (const [key, chapter] of Object.entries(progress)) {
    const [cls, subjectId, chapterId] = key.split("/");
    if (cls !== classKey || !subjectId || !chapterId) continue;
    const custom = subjectId === "custom";
    const subject = custom ? undefined : syllabus?.subjects.find((s) => s.id === subjectId);
    const listed = subject?.chapters.find((c) => c.id === chapterId);
    const names = chapter.names ?? (subject && listed ? { subject: subject.name, chapter: listed.title } : undefined);
    // A chapter the student typed in can only be reopened with its names.
    if (!names) continue;
    for (const mod of chapter.plan.modules) {
      const weak = weakGoals(chapter.modules[mod.id], now);
      if (!weak.length) continue;
      out.push({
        id: `${key}/${mod.id}`,
        ...names,
        module: mod,
        href: chapterHref({ subjectId, chapterId }, custom ? names : undefined, mod.id, { revise: true }),
        due: weak.filter((g) => g.due),
        later: weak.filter((g) => !g.due),
      });
    }
  }
  const waitingSince = (m: ModuleToRevise) => Math.min(...[...m.due, ...m.later].map((g) => g.spot.dueAt));
  return out.sort((a, b) => waitingSince(a) - waitingSince(b));
}

/** "today", "tomorrow" or a short date, for when a check is due. */
export function dayLabel(at: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(at) - day(now)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return `on ${new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** Why a goal is on the list, in a few words for the student. */
export function reasonFor({ spot }: WeakGoal): string {
  // Revised once already: what is due now is the check that it stuck.
  if (spot.step > 0) return "Time for a quick check";
  const note = spot.notes.at(-1) ?? "";
  if (note.startsWith("Quiz question missed")) return spot.misses > 1 ? `Missed ${spot.misses} times, last in a quiz` : "Missed in a quiz";
  if (note === "Did not pass the module quiz") return "Quiz not passed yet";
  return note ? note.charAt(0).toUpperCase() + note.slice(1) : "Needed more practice";
}
