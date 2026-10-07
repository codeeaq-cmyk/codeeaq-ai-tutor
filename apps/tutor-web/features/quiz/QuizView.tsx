"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QUIZ_PASS_SHARE, type QuizQuestion } from "@codeeaq/shared-types";
import { MathText } from "@/features/board/MathText";
import { Icon, PrimaryButton, ProgressRing } from "@/features/ui";

export interface QuizResult {
  score: number;
  total: number;
  /** Questions answered wrongly, for Ceeq's feedback. */
  missed: string[];
}

interface Props {
  moduleTitle: string;
  /** Loads the quiz; `fresh` asks for questions the student hasn't seen. */
  load: (fresh: boolean) => Promise<QuizQuestion[]>;
  onFinished: (result: QuizResult) => void;
  onRevisitLesson: () => void;
  /** Where to go next after the quiz: the next module, or back to the chapter. */
  next: { href: string; label: string };
}

type Phase =
  | { name: "loading" }
  | { name: "error" }
  | { name: "asking"; questions: QuizQuestion[]; index: number; picks: number[] }
  | { name: "done"; questions: QuizQuestion[]; picks: number[] };

const LETTERS = ["A", "B", "C", "D"];

export function QuizView({ moduleTitle, load, onFinished, onRevisitLesson, next }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const loadRef = useRef(load);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    loadRef.current = load;
    finishedRef.current = onFinished;
  }, [load, onFinished]);

  const fetchQuestions = useCallback((fresh: boolean) => {
    loadRef
      .current(fresh)
      .then((questions) => setPhase({ name: "asking", questions, index: 0, picks: [] }))
      .catch((err: unknown) => {
        console.warn("Quiz failed to load:", err);
        setPhase({ name: "error" });
      });
  }, []);

  const begin = useCallback(
    (fresh: boolean) => {
      setPhase({ name: "loading" });
      fetchQuestions(fresh);
    },
    [fetchQuestions],
  );

  // The first render already shows the loading state.
  useEffect(() => fetchQuestions(false), [fetchQuestions]);

  const asking = phase.name === "asking" ? phase : null;
  const answered = asking ? asking.picks[asking.index] !== undefined : false;

  const pick = useCallback((option: number) => {
    setPhase((p) => (p.name === "asking" && p.picks[p.index] === undefined ? { ...p, picks: [...p.picks, option] } : p));
  }, []);

  const advance = useCallback(() => {
    if (phase.name !== "asking" || phase.picks[phase.index] === undefined) return;
    const { questions, picks, index } = phase;
    if (index + 1 < questions.length) {
      setPhase({ ...phase, index: index + 1 });
      return;
    }
    const missed = questions.filter((q, i) => picks[i] !== q.answer).map((q) => q.question);
    setPhase({ name: "done", questions, picks });
    finishedRef.current({ score: questions.length - missed.length, total: questions.length, missed });
  }, [phase]);

  // Keyboard: 1–4 or A–D to answer, Enter to continue.
  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const option = "1234".indexOf(e.key) !== -1 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
      if (option !== -1 && e.key.length === 1) pick(option);
      else if (e.key === "Enter") advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking, pick, advance]);

  if (phase.name === "loading") {
    return (
      <Shell title={moduleTitle}>
        <p className="text-muted">Writing your quiz…</p>
        <div className="skeleton mt-6 h-8 w-4/5 rounded-lg" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-14 rounded-xl" />
          ))}
        </div>
      </Shell>
    );
  }

  if (phase.name === "error") {
    return (
      <Shell title={moduleTitle}>
        <p className="text-lg">The quiz couldn’t be written just now.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <PrimaryButton onClick={() => begin(false)}>Try again</PrimaryButton>
          <SecondaryButton onClick={onRevisitLesson}>Back to the lesson</SecondaryButton>
        </div>
      </Shell>
    );
  }

  if (phase.name === "done") {
    const score = phase.questions.filter((q, i) => phase.picks[i] === q.answer).length;
    const total = phase.questions.length;
    const passed = score / total >= QUIZ_PASS_SHARE;
    return (
      <Shell title={moduleTitle}>
        <div className="flex items-center gap-5">
          <div className="relative grid place-items-center">
            <ProgressRing value={score / total} size={84} />
            <span className="absolute text-xl font-semibold tabular-nums">{score}/{total}</span>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {score === total ? "Perfect score!" : passed ? "Module passed" : "Not there yet"}
            </h2>
            <p className="mt-1 text-muted">
              {passed
                ? score === total
                  ? "You’ve got this module."
                  : "Good work. Review what you missed below."
                : "Go through the explanations below, revisit the lesson if you like, then try again."}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {passed ? (
            <Link href={next.href} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg shadow-sm hover:opacity-90">
              {next.label} <Icon name="chevron" className="h-4 w-4" />
            </Link>
          ) : (
            <PrimaryButton onClick={() => setPhase({ name: "asking", questions: phase.questions, index: 0, picks: [] })}>Try again</PrimaryButton>
          )}
          {passed && (
            <SecondaryButton onClick={() => setPhase({ name: "asking", questions: phase.questions, index: 0, picks: [] })}>Retake</SecondaryButton>
          )}
          <SecondaryButton onClick={() => begin(true)}>New questions</SecondaryButton>
          <SecondaryButton onClick={onRevisitLesson}>Revisit lesson</SecondaryButton>
          {!passed && (
            <Link href={next.href} className="inline-flex items-center rounded-xl px-4 py-3 font-medium text-muted hover:text-fg">
              {next.label}
            </Link>
          )}
        </div>

        <ol className="mt-8 space-y-4">
          {phase.questions.map((q, i) => {
            const right = phase.picks[i] === q.answer;
            return (
              <li key={i} className="rounded-2xl border border-line p-4">
                <div className="flex gap-3">
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-white ${right ? "bg-(--ink-green)" : "bg-(--ink-red)"}`}
                  >
                    {right ? <Icon name="check" className="h-3.5 w-3.5" /> : "✕"}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium"><MathText text={q.question} /></p>
                    {!right && (
                      <p className="mt-1.5 text-sm text-muted">
                        You chose: <MathText text={q.options[phase.picks[i]]} />
                      </p>
                    )}
                    <p className="mt-1 text-sm">
                      <span className="text-muted">Answer: </span>
                      <MathText text={q.options[q.answer]} />
                    </p>
                    {q.explanation && <p className="mt-1.5 text-sm text-muted"><MathText text={q.explanation} /></p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Shell>
    );
  }

  const q = phase.questions[phase.index];
  const picked = phase.picks[phase.index];
  const last = phase.index + 1 === phase.questions.length;

  return (
    <Shell title={moduleTitle}>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {phase.questions.map((question, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                phase.picks[i] === undefined ? (i === phase.index ? "bg-accent" : "bg-line") : phase.picks[i] === question.answer ? "bg-(--ink-green)" : "bg-(--ink-red)"
              }`}
            />
          ))}
        </div>
        <span className="text-sm tabular-nums text-muted">
          {phase.index + 1} of {phase.questions.length}
        </span>
      </div>

      <h2 key={phase.index} className="block-in mt-6 text-xl font-medium leading-snug sm:text-2xl">
        <MathText text={q.question} />
      </h2>

      <div key={`o${phase.index}`} className="block-in mt-6 space-y-3" role="radiogroup" aria-label="Answers">
        {q.options.map((option, i) => {
          const isAnswer = i === q.answer;
          const isPicked = i === picked;
          const style = !answered
            ? "border-line hover:border-accent hover:bg-accent-soft"
            : isAnswer
              ? "border-(--ink-green) bg-[color-mix(in_oklab,var(--ink-green)_12%,transparent)]"
              : isPicked
                ? "border-(--ink-red) bg-[color-mix(in_oklab,var(--ink-red)_10%,transparent)]"
                : "border-line opacity-55";
          return (
            <button
              key={i}
              role="radio"
              aria-checked={isPicked}
              disabled={answered}
              onClick={() => pick(i)}
              className={`flex w-full items-center gap-4 rounded-xl border-2 px-4 py-3.5 text-left text-base transition-colors sm:text-lg ${style}`}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm font-semibold ${
                  answered && isAnswer ? "bg-(--ink-green) text-white" : answered && isPicked ? "bg-(--ink-red) text-white" : "bg-surface-2 text-muted"
                }`}
              >
                {answered && isAnswer ? <Icon name="check" className="h-4 w-4" /> : LETTERS[i]}
              </span>
              <span className="min-w-0"><MathText text={option} /></span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 min-h-24" aria-live="polite">
        {answered && (
          <div className="block-in">
            <p className="font-semibold">{picked === q.answer ? "Correct!" : "Not quite."}</p>
            {q.explanation && <p className="mt-1 leading-relaxed text-muted"><MathText text={q.explanation} /></p>}
            <PrimaryButton className="mt-4" onClick={advance} autoFocus>
              {last ? "See results" : "Next question"}
            </PrimaryButton>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-6 sm:px-8 sm:py-10">
      <div className="mb-5 text-sm font-medium text-muted">Quiz · {title}</div>
      {children}
    </div>
  );
}

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="rounded-xl border border-line bg-surface px-4 py-3 font-medium hover:border-muted" {...props} />;
}
