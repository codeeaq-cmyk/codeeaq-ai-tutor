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
  type LessonMode,
  type ModulePlan,
} from "@codeeaq/shared-types";
import { Board } from "@/features/board/Board";
import { Missing } from "@/features/chapter/ChapterScreen";
import { QuizView, type QuizResult } from "@/features/quiz/QuizView";
import { Icon, PrimaryButton } from "@/features/ui";
import { CeeqOrb } from "@/features/voice/CeeqOrb";
import { useCeeqVoice, type ToolHandler } from "@/features/voice/useCeeqVoice";
import { loadQuiz, prefetchQuiz, useChapterPlan } from "@/lib/course";
import { startVoice } from "@/lib/firebase";
import { usePace } from "@/lib/pace";
import { readChapterProgress, savePlan, updateModule, useChapterProgress } from "@/lib/progress";
import { useChapterTarget, type ChapterRouteProps, type ChapterTarget } from "@/lib/target";
import { CARRY_ON, carryOnLimit, GAP_AFTER_STUDENT_MS, LEAD_MS, openingFor, SILENCE_MS, startingMode, WRAP_UP } from "./lessonFlow";

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
  const [view, setViewState] = useState<"lesson" | "quiz">(startWithQuiz ? "quiz" : "lesson");
  const [text, setText] = useState("");

  // Which spoken part the lesson is in, and whether the student has paused the
  // explanation. Each is kept in a ref as well, because the voice callbacks
  // below run outside render and must see the value as it is now.
  const [mode, setModeState] = useState<LessonMode>("explain");
  const [paused, setPausedState] = useState(false);
  const flow = useRef({ mode: "explain" as LessonMode, paused: false, view: startWithQuiz ? "quiz" : "lesson", prompts: 0 });
  const carryOnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setMode = useCallback((next: LessonMode) => {
    flow.current.mode = next;
    setModeState(next);
  }, []);
  const setPaused = useCallback((next: boolean) => {
    flow.current.paused = next;
    setPausedState(next);
  }, []);
  const setView = useCallback((next: "lesson" | "quiz") => {
    flow.current.view = next;
    setViewState(next);
  }, []);

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
          // A goal is only understood once the student has shown it in practice.
          // While she is still explaining, anything else just means "being taught".
          const tooEarly = flow.current.mode === "explain" && change.status !== "learning";
          const status = tooEarly ? "learning" : change.status;
          updateModule(target.key, mod.id, (m) => ({ ...m, goals: m.goals.map((g, i) => (i === change.index ? status : g)) }));
          // Deliberately no comment back: telling her so made her apologise to the student.
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
        case "start_practice":
          // The explanation is over: from here the app waits for the student.
          setMode("practice");
          updateModule(target.key, mod.id, (m) => ({
            ...m,
            explained: true,
            // Ceeq does not always tick each goal as she explains it.
            goals: m.goals.map((g) => (g === "todo" ? "learning" : g)),
          }));
          return { ok: true, note: "The app now waits for the student after each of your turns." };
        case "finish_module":
          // Ceeq sometimes forgets to tick a goal off; finishing means they were all covered.
          updateModule(target.key, mod.id, (m) => ({
            ...m,
            explained: true,
            learned: true,
            goals: m.goals.map((g) => (g === "practice" ? g : "understood")),
          }));
          setMode("practice");
          setView("quiz");
          return { ok: true, note: "The quiz is now on the student's screen. Wish them luck in one short sentence, then stay silent until you are told the result." };
        default:
          return { ok: false, error: "Unknown tool" };
      }
    },
    [target.key, mod, setMode, setView],
  );

  const { pace, nextPace } = usePace();

  // ---------- Keeping the explanation going ----------
  //
  // Ceeq only speaks when prompted. While she is explaining, each time she
  // finishes a turn the app asks her to carry on, so the student can simply
  // listen. The voice hook is created below, so it is reached through a ref.
  const voiceRef = useRef<ReturnType<typeof useCeeqVoice> | null>(null);

  const cancelCarryOn = useCallback(() => {
    if (carryOnTimer.current) clearTimeout(carryOnTimer.current);
    carryOnTimer.current = null;
  }, []);

  const carryOn = useCallback(() => {
    carryOnTimer.current = null;
    const voiceNow = voiceRef.current;
    const { mode: modeNow, paused: pausedNow, view: viewNow } = flow.current;
    // Never cut her off: if a turn is still arriving, its end will bring us back here.
    if (!voiceNow || modeNow !== "explain" || pausedNow || viewNow !== "lesson" || voiceNow.isMidTurn()) return;
    const prompts = ++flow.current.prompts;
    const limit = carryOnLimit(mod.goals.length);
    if (prompts > limit + 1) {
      // She was told to wrap up and still has not: stop prompting and let the student lead.
      setMode("practice");
      return;
    }
    voiceNow.notify(prompts > limit ? WRAP_UP : CARRY_ON);
  }, [mod.goals.length, setMode]);

  const onTurnEnd = useCallback(
    ({ afterStudent, remainingMs }: { afterStudent: boolean; remainingMs: number }) => {
      cancelCarryOn();
      if (flow.current.mode !== "explain" || flow.current.paused || flow.current.view !== "lesson") return;
      // After she has answered the student, let it all play out and leave room
      // for a follow-up. Otherwise prompt just before the paragraph ends.
      const wait = afterStudent ? remainingMs + GAP_AFTER_STUDENT_MS : Math.max(0, remainingMs - LEAD_MS);
      carryOnTimer.current = setTimeout(carryOn, wait);
    },
    [cancelCarryOn, carryOn],
  );

  // When the student speaks or types, hold the prompt back (Ceeq will answer
  // them first), and un-pause so that her answer can be heard.
  const onStudentInput = useCallback(() => {
    cancelCarryOn();
    if (!flow.current.paused) return;
    setPaused(false);
    voiceRef.current?.releasePlayback();
  }, [cancelCarryOn, setPaused]);

  const voice = useCeeqVoice({ getToken, onToolCall, speed: pace.speed, onTurnEnd, onStudentInput });
  useEffect(() => {
    voiceRef.current = voice;
  });
  const live = voice.status === "live";
  const busy = voice.status === "connecting";

  // A safety net: if she should be explaining and nothing at all is happening
  // (a prompt was lost, or background noise was taken for speech), prompt her.
  const quiet = voice.activity === "idle" || voice.activity === "thinking";
  useEffect(() => {
    if (!live || mode !== "explain" || paused || view !== "lesson" || !quiet) return;
    const timer = setTimeout(() => {
      if (!carryOnTimer.current) carryOn();
    }, SILENCE_MS);
    return () => clearTimeout(timer);
  }, [live, mode, paused, view, quiet, carryOn]);

  useEffect(() => cancelCarryOn, [cancelCarryOn]);

  /** Connects and begins the lesson in the part the student has reached. */
  const begin = useCallback(
    (voiceNow: ReturnType<typeof useCeeqVoice>) => {
      const saved = readChapterProgress(target.key)?.modules[mod.id];
      cancelCarryOn();
      flow.current.prompts = 0;
      setMode(startingMode(saved));
      setPaused(false);
      setView("lesson");
      void voiceNow.connect(openingFor(mod, saved));
    },
    [cancelCarryOn, mod, setMode, setPaused, setView, target.key],
  );

  const start = useCallback(() => begin(voice), [begin, voice]);

  /** Freezes the explanation mid-sentence, or picks it up exactly where it stopped. */
  const togglePause = useCallback(() => {
    if (flow.current.paused) {
      setPaused(false);
      voice.releasePlayback();
      // Her turn had finished arriving before the pause, so nothing else will prompt her.
      if (!voice.isMidTurn()) carryOnTimer.current = setTimeout(carryOn, Math.max(0, voice.remainingMs() - LEAD_MS));
    } else {
      setPaused(true);
      cancelCarryOn();
      voice.holdPlayback();
    }
  }, [cancelCarryOn, carryOn, setPaused, voice]);

  // On arrival: keep a single-lesson fallback plan so progress can be saved,
  // start writing the quiz so it is ready when the lesson ends, and mint the
  // voice token. All three are safe to repeat.
  useEffect(() => {
    if (provisional) savePlan(target.key, plan);
    prefetchQuiz(target.key, target.ref, mod);
    voice.prepare();
    // Begin straight away when the student arrived by clicking (browsers then
    // allow sound). The start is deferred a tick and cancelled on cleanup: in
    // development React mounts every component twice, and a connection begun
    // by the first mount would be abandoned when that mount is torn down,
    // leaving the lesson stuck on "Connecting…".
    if (startWithQuiz || !navigator.userActivation?.hasBeenActive) return;
    const timer = setTimeout(() => begin(voice), 0);
    return () => clearTimeout(timer);
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
        // Reaching the quiz any way counts as having covered the module.
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
  // Before the lesson is running, show the part it will start in.
  const part: Part = view === "quiz" ? "quiz" : live || busy ? mode : startingMode(progress);
  const explaining = live && view === "lesson" && mode === "explain";
  const hint = !live || view === "quiz" ? null : paused ? "Paused. Press play to carry on." : mode === "explain" ? "Ceeq is explaining. Ask a question any time." : "Your turn. Answer out loud, or type.";
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
            <span className="lg:hidden"> · {PARTS.find((p) => p.id === part)?.label}</span>
          </div>
          <h1 className="truncate font-semibold">{mod.title}</h1>
        </div>
        {best && (
          <span className="hidden text-sm text-muted sm:inline">
            Best quiz <span className="font-medium text-fg tabular-nums">{best.score}/{best.total}</span>
          </span>
        )}
        <button
          onClick={nextPace}
          className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted hover:border-muted hover:text-fg"
          title="How fast Ceeq speaks. Click to change."
          aria-label={`Ceeq's speaking pace: ${pace.label}. Click to change.`}
        >
          Pace: <span className="font-medium text-fg">{pace.label}</span>
        </button>
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
              empty={busy ? "Ceeq is getting ready…" : live ? "Ceeq will write here as she teaches." : "Press Start and Ceeq will explain this module, then practise it with you."}
            />
          )}
        </section>

        <aside className="hidden w-104 shrink-0 flex-col gap-6 overflow-y-auto border-l border-line bg-bg p-6 lg:flex xl:w-120">
          <CeeqOrb activity={paused ? "idle" : voice.activity} getLevel={voice.getLevel} />
          {!live && (
            <div>
              <PrimaryButton onClick={start} disabled={busy} className="w-full text-lg">
                {startLabel}
              </PrimaryButton>
              {notice && <p className="mt-2 text-sm text-muted">{notice}</p>}
            </div>
          )}
          <div>
            <Parts current={part} />
            {hint && <p className="mt-2.5 text-sm text-muted">{hint}</p>}
          </div>
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
              <CeeqOrb activity={paused ? "idle" : voice.activity} getLevel={voice.getLevel} size={36} showLabel={false} />
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
                placeholder={voice.heard || (explaining ? "Ask a question any time" : voice.micOn ? "Just talk, or type here" : "Type your answer")}
                className="min-w-0 flex-1 bg-transparent py-2.5 outline-none placeholder:text-muted"
                maxLength={500}
              />
              <button type="submit" disabled={!text.trim()} className="grid h-8 w-8 place-items-center rounded-full bg-fg text-bg disabled:opacity-20" aria-label="Send">
                <Icon name="send" className="h-4 w-4" />
              </button>
            </form>
            {explaining && (
              <button
                onClick={togglePause}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors ${paused ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg"}`}
                aria-label={paused ? "Carry on with the explanation" : "Pause the explanation"}
                title={paused ? "Carry on" : "Pause"}
              >
                <Icon name={paused ? "play" : "pause"} />
              </button>
            )}
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

type Part = LessonMode | "quiz";

const PARTS: { id: Part; label: string }[] = [
  { id: "explain", label: "Explain" },
  { id: "practice", label: "Practise" },
  { id: "quiz", label: "Quiz" },
];

/** The three parts of a module, with the current one marked. */
function Parts({ current }: { current: Part }) {
  const at = PARTS.findIndex((p) => p.id === current);
  return (
    <ol className="flex items-center gap-1.5 text-sm" aria-label="Parts of this lesson">
      {PARTS.map((p, i) => (
        <li key={p.id} className="flex items-center gap-1.5" aria-current={i === at ? "step" : undefined}>
          {i > 0 && <span className="h-px w-4 bg-line" aria-hidden />}
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              i === at ? "bg-accent font-medium text-accent-fg" : i < at ? "text-fg" : "text-muted"
            }`}
          >
            {i < at ? <Icon name="check" className="h-3.5 w-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
            {p.label}
          </span>
        </li>
      ))}
    </ol>
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
