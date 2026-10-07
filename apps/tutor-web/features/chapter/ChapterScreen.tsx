"use client";

import Link from "next/link";
import {
  bestAttempt,
  chapterMastery,
  moduleState,
  type ModulePlan,
  type ModuleProgress,
  type ModuleState,
} from "@codeeaq/shared-types";
import { Icon, ProgressRing } from "@/features/ui";
import { useChapterPlan } from "@/lib/course";
import { useChapterProgress } from "@/lib/progress";
import { useChapterTarget, type ChapterRouteProps, type ChapterTarget } from "@/lib/target";

export function ChapterScreen(props: ChapterRouteProps) {
  const state = useChapterTarget(props);
  if (state.status === "missing") return <Missing />;
  if (state.status === "loading") return <main className="skeleton min-h-screen opacity-40" />;
  return <Chapter target={state.target} />;
}

export function Missing() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-muted">This chapter isn’t in your syllabus.</p>
      <Link href="/learn" className="font-medium text-accent">Back to subjects</Link>
    </main>
  );
}

function Chapter({ target }: { target: ChapterTarget }) {
  const { state, retry } = useChapterPlan(target.key, target.ref);
  const progress = useChapterProgress(target.key);

  const modules = state.status === "ready" ? state.plan.modules : [];
  const provisional = state.status === "ready" && state.provisional;
  const states = modules.map((m) => moduleState(progress?.modules[m.id]));
  // The first module not yet passed is where the student should go next.
  const nextIndex = states.findIndex((s) => s !== "passed");
  const passed = states.filter((s) => s === "passed").length;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-16">
      <header className="flex items-start gap-3 py-5">
        <Link href="/learn" className="-ml-1.5 mt-1 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Back to subjects">
          <Icon name="back" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted">{target.subject}{target.unit ? ` · ${target.unit}` : ""}</div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{target.chapter}</h1>
        </div>
        {modules.length > 0 && !provisional && (
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className="tabular-nums">{passed}/{modules.length}</span>
            <ProgressRing value={chapterMastery(progress)} size={26} />
          </div>
        )}
      </header>

      {state.status === "loading" ? (
        <div aria-busy>
          <p className="text-muted">Ceeq is planning this chapter…</p>
          <div className="mt-5 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {state.provisional && (
            <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
              The chapter couldn’t be split into modules just now, so it’s offered as one lesson.{" "}
              <button onClick={retry} className="font-medium text-accent">Try again</button>
            </p>
          )}
          <ol className="space-y-3">
            {modules.map((module, i) => (
              <ModuleCard
                key={module.id}
                number={i + 1}
                module={module}
                progress={progress?.modules[module.id]}
                state={states[i]}
                isNext={i === nextIndex}
                lessonHref={target.href(module.id)}
                quizHref={target.href(module.id, { quiz: true })}
              />
            ))}
          </ol>
          {modules.length > 0 && nextIndex === -1 && (
            <p className="mt-6 rounded-2xl bg-accent-soft px-5 py-4 text-center font-medium">
              Chapter complete. Revisit any module or quiz whenever you like.
            </p>
          )}
        </>
      )}
    </main>
  );
}

const STATE_LABEL: Record<ModuleState, string> = {
  new: "Not started",
  learning: "In progress",
  "quiz-ready": "Quiz ready",
  passed: "Passed",
};

function ModuleCard({
  number,
  module,
  progress,
  state,
  isNext,
  lessonHref,
  quizHref,
}: {
  number: number;
  module: ModulePlan;
  progress: ModuleProgress | undefined;
  state: ModuleState;
  isNext: boolean;
  lessonHref: string;
  quizHref: string;
}) {
  const best = bestAttempt(progress);
  const attempts = progress?.attempts.length ?? 0;
  const primary =
    state === "new"
      ? { href: lessonHref, label: "Start lesson" }
      : state === "learning"
        ? { href: lessonHref, label: "Continue lesson" }
        : state === "quiz-ready"
          ? { href: quizHref, label: best ? "Retry quiz" : "Take quiz" }
          : { href: lessonHref, label: "Revisit lesson" };
  const secondary =
    state === "quiz-ready"
      ? { href: lessonHref, label: "Revisit lesson" }
      : state === "passed"
        ? { href: quizHref, label: "Retake quiz" }
        : { href: quizHref, label: "Skip to quiz" };

  return (
    <li className={`rounded-2xl border bg-surface p-5 transition-colors ${isNext ? "border-accent" : "border-line"}`}>
      <div className="flex items-start gap-4">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold ${
            state === "passed" ? "bg-(--ink-green) text-white" : isNext ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"
          }`}
        >
          {state === "passed" ? <Icon name="check" className="h-4 w-4" /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-lg font-semibold">{module.title}</h2>
            <span className="text-sm text-muted">
              {STATE_LABEL[state]}
              {best ? ` · best ${best.score}/${best.total}` : ""}
              {attempts > 1 ? ` · ${attempts} attempts` : ""}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-[15px] text-muted">
            {module.goals.map((goal, g) => {
              const status = progress?.goals[g] ?? "todo";
              return (
                <li key={g} className="flex gap-2">
                  <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${status === "understood" ? "bg-(--ink-green)" : status === "todo" ? "bg-line" : "bg-accent"}`} />
                  {goal}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={primary.href}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold ${
                isNext || state === "quiz-ready" ? "bg-accent text-accent-fg hover:opacity-90" : "border border-line hover:border-muted"
              }`}
            >
              {primary.label}
            </Link>
            <Link href={secondary.href} className="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg">
              {secondary.label}
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}
