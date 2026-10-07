"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  boardName,
  chapterMastery,
  languageName,
  moduleState,
  slugify,
  streamName,
  type StudentProfile,
  type Subject,
  type Syllabus,
} from "@codeeaq/shared-types";
import { Icon, PrimaryButton, ProgressRing, Wordmark } from "@/features/ui";
import { classKey, useProfile } from "@/lib/profile";
import { chapterKey, useAllProgress } from "@/lib/progress";
import { useHydrated } from "@/lib/storage";
import { useSyllabus } from "@/lib/syllabus";

export function LearnScreen() {
  const router = useRouter();
  const hydrated = useHydrated();
  const profile = useProfile();

  useEffect(() => {
    if (hydrated && !profile) router.replace("/");
  }, [hydrated, profile, router]);

  if (!profile) return null;
  return <Learn profile={profile} />;
}

function Learn({ profile }: { profile: StudentProfile }) {
  const { state, retry } = useSyllabus(profile);
  const summary = [boardName(profile.board), `Class ${profile.classLevel}`, streamName(profile.stream)].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-16">
      <header className="flex items-center justify-between py-5">
        <Wordmark />
        <Link href="/?edit=1" className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm hover:border-muted">
          {summary} <span className="text-muted">· {languageName(profile.language)}</span>
        </Link>
      </header>

      {state.status === "loading" && <LoadingSyllabus summary={summary} />}
      {state.status === "error" && (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <h1 className="text-lg font-semibold">Couldn’t load the {summary} syllabus</h1>
          <p className="mt-1 text-muted">{state.message}</p>
          <PrimaryButton className="mt-4" onClick={retry}>Try again</PrimaryButton>
          <div className="mt-8 border-t border-line pt-6">
            <CustomChapter />
          </div>
        </div>
      )}
      {state.status === "ready" && <Subjects profile={profile} syllabus={state.syllabus} />}
    </main>
  );
}

function LoadingSyllabus({ summary }: { summary: string }) {
  return (
    <div className="mt-6" aria-busy>
      <p className="text-muted">Getting the latest {summary} syllabus…</p>
      <div className="mt-6 flex gap-2">
        {[80, 96, 72, 88].map((w, i) => (
          <div key={i} className="skeleton h-9 rounded-xl" style={{ width: w }} />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="skeleton h-14 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function Subjects({ profile, syllabus }: { profile: StudentProfile; syllabus: Syllabus }) {
  const cls = classKey(profile);
  const progress = useAllProgress();
  const [subjectId, setSubjectId] = useState(syllabus.subjects[0]?.id);
  const subject = syllabus.subjects.find((s) => s.id === subjectId) ?? syllabus.subjects[0];

  // The chapter touched most recently in this class, to pick up where they left off.
  const resume = useMemo(() => {
    let best: { subject: Subject; chapterId: string; title: string; at: number; done: number; total: number } | null = null;
    for (const s of syllabus.subjects) {
      for (const c of s.chapters) {
        const p = progress[chapterKey(cls, s.id, c.id)];
        if (p?.updatedAt && (!best || p.updatedAt > best.at) && chapterMastery(p) < 1) {
          best = { subject: s, chapterId: c.id, title: c.title, at: p.updatedAt, done: p.plan.modules.filter((m) => moduleState(p.modules[m.id]) === "passed").length, total: p.plan.modules.length };
        }
      }
    }
    return best;
  }, [progress, syllabus, cls]);

  const units = useMemo(() => {
    const groups: { unit?: string; chapters: Subject["chapters"] }[] = [];
    for (const c of subject?.chapters ?? []) {
      const last = groups.at(-1);
      if (last && last.unit === c.unit) last.chapters.push(c);
      else groups.push({ unit: c.unit, chapters: [c] });
    }
    return groups;
  }, [subject]);

  if (!subject) return null;
  let number = 0;

  return (
    <>
      {resume && (
        <Link
          href={`/learn/${resume.subject.id}/${resume.chapterId}`}
          className="mt-2 flex items-center gap-4 rounded-2xl bg-accent p-4 text-accent-fg shadow-sm transition-opacity hover:opacity-95"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm opacity-80">Continue · {resume.subject.name}</div>
            <div className="truncate text-lg font-semibold">{resume.title}</div>
          </div>
          <div className="text-sm opacity-80">{resume.done}/{resume.total || "–"}</div>
          <Icon name="chevron" />
        </Link>
      )}

      <nav className="sticky top-0 z-10 -mx-5 mt-6 flex gap-2 overflow-x-auto bg-bg/90 px-5 py-3 backdrop-blur" aria-label="Subjects">
        {syllabus.subjects.map((s) => (
          <button
            key={s.id}
            onClick={() => setSubjectId(s.id)}
            aria-current={s.id === subject.id}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              s.id === subject.id ? "bg-fg text-bg" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {s.name}
          </button>
        ))}
      </nav>

      <div className="mt-2 space-y-6">
        {units.map((group, g) => (
          <section key={g}>
            {group.unit && <h2 className="mb-2 px-1 text-sm font-medium text-muted">{group.unit}</h2>}
            <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
              {group.chapters.map((c) => {
                number++;
                const p = progress[chapterKey(cls, subject.id, c.id)];
                const mastery = chapterMastery(p);
                return (
                  <li key={c.id} className="border-b border-line last:border-b-0">
                    <Link href={`/learn/${subject.id}/${c.id}`} className="group flex items-center gap-4 px-4 py-3.5 hover:bg-surface-2">
                      <span className="w-6 text-right text-sm tabular-nums text-muted">{number}</span>
                      <span className="line-clamp-2 min-w-0 flex-1">{c.title}</span>
                      {p?.updatedAt ? (
                        <ProgressRing value={mastery} size={24} />
                      ) : (
                        <span className="text-sm text-muted opacity-0 transition-opacity group-hover:opacity-100">Start</span>
                      )}
                      <Icon name="chevron" className="h-4 w-4 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-8 px-1 text-xs text-muted">
        {syllabus.source === "curated" ? "Syllabus" : "Syllabus compiled by AI from official sources — may contain mistakes"}
        {syllabus.edition ? ` · ${syllabus.edition}` : ""}
      </p>
      <details className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Learn something not listed</summary>
        <div className="mt-4">
          <CustomChapter />
        </div>
      </details>
    </>
  );
}

/** Starts a lesson on any subject and chapter the student types in. */
function CustomChapter() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [chapter, setChapter] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const s = subject.trim();
    const c = chapter.trim();
    if (!s || !c) return;
    const query = new URLSearchParams({ subject: s, chapter: c });
    router.push(`/learn/custom/${slugify(`${s}-${c}`)}?${query}`);
  }

  const input = "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 outline-none focus:border-accent";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
      <input className={input} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} />
      <input className={input} placeholder="Chapter or topic" value={chapter} onChange={(e) => setChapter(e.target.value)} maxLength={150} />
      <PrimaryButton type="submit" disabled={!subject.trim() || !chapter.trim()}>Learn</PrimaryButton>
    </form>
  );
}
