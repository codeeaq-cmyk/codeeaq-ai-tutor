"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  applyBoardUpdate,
  bestAttempt,
  EMPTY_BOARD,
  moduleState,
  parseAnswer,
  parseProgressUpdate,
  validateBoardUpdate,
  type BoardState,
  type ChapterPlan,
  type GoalStatus,
  type ModulePlan,
  type ModuleProgress,
} from "@codeeaq/shared-types";
import { Board } from "@/features/board/Board";
import { Missing } from "@/features/chapter/ChapterScreen";
import { QuizView, type QuizResult } from "@/features/quiz/QuizView";
import { Icon, PrimaryButton } from "@/features/ui";
import { CeeqOrb } from "@/features/voice/CeeqOrb";
import { useCeeqVoice, type ToolHandler } from "@/features/voice/useCeeqVoice";
import { loadQuiz, prefetchQuiz, useChapterPlan } from "@/lib/course";
import { startVoice } from "@/lib/firebase";
import { readChapterProgress, savePlan, updateModule, useChapterProgress } from "@/lib/progress";
import { useChapterTarget, type ChapterRouteProps, type ChapterTarget } from "@/lib/target";

interface Props extends ChapterRouteProps {
  moduleId: string;
  /** Open straight on the quiz instead of the lesson. */
  startWithQuiz: boolean;
}

export function LessonScreen({ moduleId, startWithQuiz, ...route }: Props) {
  const state = useChapterTarget(route);
  const target = state.status === "ready" ? state.target : undefined;
  const { state: planState } = useChapterPlan(target?.key, target?.ref);

  if (state.status === "missing") return <Missing />;
  if (!target || planState.status === "loading") return <main className="skeleton min-h-screen opacity-40" />;

  const index = planState.plan.modules.findIndex((m) => m.id === moduleId);
  if (index === -1) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted">This module isn’t part of the chapter.</p>
        <Link href={target.href()} className="font-medium text-accent">Back to the chapter</Link>
      </main>
    );
  }
  return (
    <ModuleLesson
      key={`${target.key}/${moduleId}`}
      target={target}
      plan={planState.plan}
      index={index}
      provisional={planState.provisional}
      startWithQuiz={startWithQuiz}
    />
  );
}

function openingFor(module: ModulePlan, progress: ModuleProgress | undefined): string {
  const state = moduleState(progress);
  if (state === "new") {
    return "(The student just opened this module. Greet them warmly in one short sentence and start teaching goal 1.)";
  }
  const goals = module.goals.map((g, i) => `${i + 1}. ${g} — ${progress?.goals[i] ?? "todo"}`).join("; ");
  if (state === "learning") {
    return `(The student is back to continue this module. Goal status: ${goals}. Welcome them back in one short sentence, recap in one more, and continue with the first goal that is not understood.)`;
  }
  const best = bestAttempt(progress);
  return `(The student is revisiting this module, which you have already taught. Goal status: ${goals}.${best ? ` Their best quiz score so far is ${best.score} of ${best.total}.` : ""} Welcome them back in one short sentence and ask what they would like: a quick recap of everything, one part again, or more practice.)`;
}

function ModuleLesson({
  target,
  plan,
  index,
  provisional,
  startWithQuiz,
}: {
  target: ChapterTarget;
  plan: ChapterPlan;
  index: number;
  provisional: boolean;
  startWithQuiz: boolean;
}) {
  const mod = plan.modules[index];
  const nextModule = plan.modules[index + 1];
  const progress = useChapterProgress(target.key)?.modules[mod.id];
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [view, setView] = useState<"lesson" | "quiz">(startWithQuiz ? "quiz" : "lesson");
  const [text, setText] = useState("");

  const getToken = useCallback(
    () =>
      startVoice({
        ...target.ref,
        module: { title: mod.title, goals: mod.goals },
        chapterModules: plan.modules.map((m) => m.title),
      }),
    [target, mod, plan],
  );

  // Tool calls from Ceeq. Everything is validated before it touches the screen.
  const onToolCall = useCallback<ToolHandler>(
    (name, args) => {
      switch (name) {
        case "whiteboard": {
          const { update, errors } = validateBoardUpdate(args);
          setBoard((b) => applyBoardUpdate(b, update));
          // Phrased so Ceeq corrects the call quietly instead of apologising out loud.
          return errors.length
            ? { ok: true, notShown: errors, note: "Other blocks are on the board. Resend the skipped ones with their required fields if needed. Do not mention this to the student." }
            : { ok: true };
        }
        case "update_progress": {
          const change = parseProgressUpdate(args, mod.goals.length);
          if (!change) return { ok: false, error: `goal must be 1 to ${mod.goals.length}` };
          updateModule(target.key, mod.id, (m) => ({ ...m, goals: m.goals.map((g, i) => (i === change.index ? change.status : g)) }));
          return { ok: true };
        }
        case "record_answer": {
          const answer = parseAnswer(args);
          if (!answer) return { ok: false, error: "correct must be true or false" };
          updateModule(target.key, mod.id, (m) => ({
            ...m,
            correct: m.correct + (answer.correct ? 1 : 0),
            incorrect: m.incorrect + (answer.correct ? 0 : 1),
            mistakes: answer.mistake && !m.mistakes.includes(answer.mistake) ? [...m.mistakes, answer.mistake].slice(-10) : m.mistakes,
          }));
          return { ok: true };
        }
        case "finish_module":
          // Ceeq sometimes forgets to tick a goal off; finishing means they were all covered.
          updateModule(target.key, mod.id, (m) => ({
            ...m,
            learned: true,
            goals: m.goals.map((g) => (g === "practice" ? g : "understood")),
          }));
          setView("quiz");
          return { ok: true, note: "The quiz is now on the student's screen. Wish them luck in one short sentence, then stay silent until you are told the result." };
        default:
          return { ok: false, error: "Unknown tool" };
      }
    },
    [target.key, mod],
  );

  const voice = useCeeqVoice({ getToken, onToolCall });
  const live = voice.status === "live";
  const busy = voice.status === "connecting";

  const start = useCallback(() => {
    setView("lesson");
    void voice.connect(openingFor(mod, readChapterProgress(target.key)?.modules[mod.id]));
  }, [voice, mod, target.key]);

  // On arrival: keep a single-lesson fallback plan so progress can be saved,
  // start writing the quiz so it is ready when the lesson ends, mint the voice
  // token, and begin straight away when the student arrived by clicking
  // (browsers then allow sound).
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if (provisional) savePlan(target.key, plan);
    prefetchQuiz(target.key, target.ref, mod);
    voice.prepare();
    if (!startWithQuiz && navigator.userActivation?.hasBeenActive) {
      void voice.connect(openingFor(mod, readChapterProgress(target.key)?.modules[mod.id]));
    }
    // Run once per module; `voice` changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadQuestions = useCallback(
    (fresh: boolean) => loadQuiz(target.key, target.ref, mod, fresh).then((quiz) => quiz.questions),
    [target, mod],
  );

  const onQuizFinished = useCallback(
    (result: QuizResult) => {
      updateModule(target.key, mod.id, (m) => ({
        ...m,
        // Reaching the quiz any way counts as having covered the mod.
        learned: true,
        attempts: [...m.attempts, { score: result.score, total: result.total, at: Date.now() }],
      }));
      const missed = result.missed.length ? `Questions they missed: ${result.missed.map((q) => `"${q}"`).join("; ")}.` : "They missed nothing.";
      voice.notify(`(Quiz result: ${result.score} out of ${result.total}. ${missed} Respond as instructed for a quiz result.)`);
    },
    [target.key, mod.id, voice],
  );

  function onSend(e: FormEvent) {
    e.preventDefault();
    if (voice.sendText(text)) setText("");
  }

  const goals: GoalStatus[] = progress?.goals ?? mod.goals.map(() => "todo");
  const best = bestAttempt(progress);
  const state = moduleState(progress);
  const startLabel = busy ? "Connecting…" : state === "new" ? "Start lesson" : state === "learning" ? "Continue lesson" : "Revisit lesson";
  const notice = voice.error ?? (voice.status === "paused" ? "Lesson paused." : null);
  const next = nextModule
    ? { href: target.href(nextModule.id), label: `Next: ${nextModule.title}` }
    : { href: target.href(), label: "Back to chapter" };

  const viewToggle =
    view === "lesson" ? (
      <button onClick={() => setView("quiz")} className="w-full rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:border-muted">
        {best ? "Retake the quiz" : "Take the quiz"}
      </button>
    ) : (
      <button onClick={() => setView("lesson")} className="w-full rounded-xl border border-line px-4 py-2.5 text-sm font-medium hover:border-muted">
        Back to the whiteboard
      </button>
    );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-5">
        <Link href={target.href()} onClick={voice.end} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Back to the chapter">
          <Icon name="back" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted">
            {target.chapter} · Module {index + 1} of {plan.modules.length}
          </div>
          <h1 className="truncate font-semibold">{mod.title}</h1>
        </div>
        {best && (
          <span className="text-sm text-muted">
            Best quiz <span className="font-medium text-fg tabular-nums">{best.score}/{best.total}</span>
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto bg-surface" aria-label={view === "quiz" ? "Quiz" : "Whiteboard"}>
          {view === "quiz" ? (
            <QuizView
              moduleTitle={mod.title}
              load={loadQuestions}
              onFinished={onQuizFinished}
              onRevisitLesson={live ? () => setView("lesson") : start}
              next={next}
            />
          ) : (
            <Board
              board={board}
              empty={busy ? "Ceeq is getting ready…" : live ? "Ceeq will write here as she teaches." : "Press Start and Ceeq will begin teaching this mod."}
            />
          )}
        </section>

        <aside className="hidden w-104 shrink-0 flex-col gap-6 overflow-y-auto border-l border-line bg-bg p-6 lg:flex xl:w-120">
          <CeeqOrb activity={voice.activity} getLevel={voice.getLevel} />
          {!live && (
            <div>
              <PrimaryButton onClick={start} disabled={busy} className="w-full text-lg">
                {startLabel}
              </PrimaryButton>
              {notice && <p className="mt-2 text-sm text-muted">{notice}</p>}
            </div>
          )}
          {voice.caption && <p className="text-[15px] leading-relaxed text-muted">{voice.caption}</p>}
          <Goals module={mod} statuses={goals} />
          {progress && progress.correct + progress.incorrect > 0 && (
            <p className="text-sm text-muted">
              {progress.correct} of {progress.correct + progress.incorrect} answers right
            </p>
          )}
          <div className="mt-auto">{viewToggle}</div>
        </aside>
      </div>

      {/* On wide screens the start button lives in Ceeq's panel, so the bar only shows during a lesson. */}
      <footer className={`border-t border-line bg-surface px-3 py-3 sm:px-5 ${live ? "" : "lg:hidden"}`}>
        {notice && <p className={`mb-2 text-sm text-muted ${live ? "text-center" : "text-right"}`}>{notice}</p>}
        {live && voice.caption && view === "lesson" && (
          <p className="mx-auto mb-2 line-clamp-2 max-w-3xl px-1 text-sm text-muted lg:hidden">{voice.caption}</p>
        )}
        {live ? (
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <div className="lg:hidden">
              <CeeqOrb activity={voice.activity} getLevel={voice.getLevel} size={36} showLabel={false} />
            </div>
            <button
              onClick={voice.toggleMic}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors ${
                voice.micOn ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"
              }`}
              aria-label={voice.micOn ? "Mute microphone" : "Unmute microphone"}
              title={voice.micOn ? "Mic on — just talk" : "Mic off"}
            >
              <Icon name={voice.micOn ? "mic" : "mic-off"} />
            </button>
            <form onSubmit={onSend} className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-bg pl-4 pr-1.5 focus-within:border-accent">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={voice.heard || (voice.micOn ? "Just talk, or type here" : "Type your answer")}
                className="min-w-0 flex-1 bg-transparent py-2.5 outline-none placeholder:text-muted"
                maxLength={500}
              />
              <button type="submit" disabled={!text.trim()} className="grid h-8 w-8 place-items-center rounded-full bg-fg text-bg disabled:opacity-20" aria-label="Send">
                <Icon name="send" className="h-4 w-4" />
              </button>
            </form>
            <button onClick={voice.end} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg" aria-label="End lesson" title="End lesson">
              <Icon name="stop" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <div className="w-40">{viewToggle}</div>
            <PrimaryButton onClick={start} disabled={busy} className="min-w-44">
              {startLabel}
            </PrimaryButton>
          </div>
        )}
      </footer>
    </div>
  );
}

const STATUS_STYLE = {
  todo: "border-line",
  learning: "border-accent",
  understood: "border-(--ink-green) bg-(--ink-green) text-white",
  practice: "border-(--ink-amber)",
} as const;

function Goals({ module, statuses }: { module: ModulePlan; statuses: GoalStatus[] }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-muted">In this module</h2>
      <ol className="space-y-2.5">
        {module.goals.map((goal, i) => {
          const status = statuses[i] ?? "todo";
          return (
            <li key={i} className="flex items-start gap-3">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${STATUS_STYLE[status]}`}>
                {status === "understood" && <Icon name="check" className="h-3 w-3" />}
                {status === "learning" && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </span>
              <span className={`text-sm leading-snug ${status === "learning" ? "font-medium" : status === "todo" ? "text-muted" : ""}`}>
                {goal}
                {status === "practice" && <span className="ml-1.5 text-xs text-(--ink-amber)">practise again</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
