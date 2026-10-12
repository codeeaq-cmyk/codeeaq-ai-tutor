"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  applyBoardUpdate,
  applyQuizAnswers,
  bestAttempt,
  dueGoals,
  EMPTY_BOARD,
  markMissed,
  markRevised,
  moduleState,
  parseAnswer,
  parseProgressUpdate,
  revisionTopics,
  validateBoardUpdate,
  type BoardState,
  type ChapterPlan,
  type GoalStatus,
  type LessonMode,
  type ModulePlan,
  type WeakGoal,
  type WeakSpot,
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
import { dayLabel, reasonFor } from "@/lib/revise";
import { useChapterTarget, type ChapterRouteProps, type ChapterTarget } from "@/lib/target";
import {
  CARRY_ON,
  carryOnLimit,
  Evidence,
  GAP_AFTER_STUDENT_MS,
  goalInHand,
  LEAD_MS,
  openingFor,
  revisionOpening,
  SILENCE_MS,
  startingMode,
  WRAP_UP,
} from "./lessonFlow";

interface Props extends ChapterRouteProps {
  moduleId: string;
  /** Open straight on the quiz instead of the lesson. */
  startWithQuiz: boolean;
  /** Open as a revision of the module's weak spots instead of the whole lesson. */
  revise: boolean;
}

interface LessonProps {
  target: ChapterTarget;
  plan: ChapterPlan;
  index: number;
  provisional: boolean;
  startWithQuiz: boolean;
}

export function LessonScreen({ moduleId, startWithQuiz, revise, ...route }: Props) {
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
  const lesson = { target, plan: planState.plan, index, provisional: planState.provisional, startWithQuiz };
  // The lesson and its revision are separate sittings with Ceeq, each with its own instructions.
  return revise ? (
    <Revision key={`${target.key}/${moduleId}/revise`} {...lesson} />
  ) : (
    <ModuleLesson key={`${target.key}/${moduleId}`} {...lesson} />
  );
}

/**
 * A revision covers the weak spots that are due when it opens. The list is
 * fixed for the sitting, so topics stay in view as they are ticked off.
 */
function Revision(props: LessonProps) {
  const mod = props.plan.modules[props.index];
  const [topics] = useState(() => dueGoals(readChapterProgress(props.target.key)?.modules[mod.id], Date.now()));
  if (!topics.length) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">Nothing to revise here right now</h1>
        <p className="max-w-sm text-muted">Ceeq will remind you when a topic in “{mod.title}” needs another look.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link href={props.target.href()} className="rounded-xl bg-accent px-4 py-2.5 font-semibold text-accent-fg hover:opacity-90">Back to the chapter</Link>
          <Link href={props.target.href(mod.id)} className="rounded-xl border border-line px-4 py-2.5 font-medium hover:border-muted">Open the lesson</Link>
        </div>
      </main>
    );
  }
  return <ModuleLesson {...props} topics={topics} />;
}

type View = "lesson" | "quiz" | "done";
/** How a revised topic went in this sitting. */
type Outcome = "got" | "later";

function ModuleLesson({ target, plan, index, provisional, startWithQuiz, topics }: LessonProps & { topics?: WeakGoal[] }) {
  const router = useRouter();
  const mod = plan.modules[index];
  const nextModule = plan.modules[index + 1];
  const revising = !!topics;
  const progress = useChapterProgress(target.key)?.modules[mod.id];
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [view, setViewState] = useState<View>(startWithQuiz ? "quiz" : "lesson");
  const [text, setText] = useState("");
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  /** The time by which "due" is judged; moved on when the student does something that adds to the list. */
  const [clock, setClock] = useState(() => Date.now());

  // Which spoken part the lesson is in, and whether the student has paused the
  // explanation. Each is kept in a ref as well, because the voice callbacks
  // below run outside render and must see the value as it is now.
  const [mode, setModeState] = useState<LessonMode>(revising ? "practice" : "explain");
  const [paused, setPausedState] = useState(false);
  const flow = useRef({
    mode: (revising ? "practice" : "explain") as LessonMode,
    paused: false,
    view: (startWithQuiz ? "quiz" : "lesson") as View,
    prompts: 0,
    /** Goals Ceeq has finished with in this sitting: understood, or left for another day. */
    settled: new Set<number>(),
  });
  // What the student has said in this sitting, which Ceeq's judgements must rest on.
  const evidence = useRef(new Evidence());
  const carryOnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setMode = useCallback((next: LessonMode) => {
    flow.current.mode = next;
    setModeState(next);
  }, []);
  const setPaused = useCallback((next: boolean) => {
    flow.current.paused = next;
    setPausedState(next);
  }, []);
  const setView = useCallback((next: View) => {
    flow.current.view = next;
    setViewState(next);
  }, []);

  const getToken = useCallback(
    () =>
      startVoice({
        ...target.ref,
        module: { title: mod.title, goals: mod.goals },
        chapterModules: plan.modules.map((m) => m.title),
        ...(topics ? { revise: revisionTopics(topics) } : {}),
      }),
    [target, mod, plan, topics],
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
          // A result with nothing from the student behind it is not recorded.
          if (status !== "learning" && !evidence.current.allowResult()) return { ok: true };
          const now = Date.now();
          let revisionOver = false;
          if (status !== "learning") {
            flow.current.settled.add(change.index);
            if (topics) {
              setOutcomes((o) => ({ ...o, [change.index]: status === "understood" ? "got" : "later" }));
              revisionOver = topics.every((t) => flow.current.settled.has(t.index));
            }
          }
          updateModule(target.key, mod.id, (m) => {
            // In a revision "learning" only says which topic she is on: what the student showed before still stands.
            const next = revising && status === "learning" ? m : { ...m, goals: m.goals.map((g, i) => (i === change.index ? status : g)) };
            // Understanding a weak goal counts as revising it. Still struggling keeps it on the list.
            if (status === "understood") return markRevised(next, change.index, now);
            return status === "practice" ? markMissed(next, change.index, undefined, now) : next;
          });
          if (revisionOver) {
            // The list is finished whether or not she goes on to say so: show the student how it went.
            setView("done");
            return { ok: true, note: "That was the last topic of this revision. Say in two sentences what the student did well, say goodbye, and stop. Do not begin another topic or ask another question." };
          }
          // Deliberately no comment back: telling her so made her apologise to the student.
          return { ok: true };
        }
        case "record_answer": {
          const answer = parseAnswer(args, mod.goals.length);
          if (!answer) return { ok: false, error: "correct must be true or false" };
          // Only what the student actually said can be right or wrong.
          if (!evidence.current.allowAnswer()) return { ok: true };
          // She works through the goals in order, so an answer with no goal is about the one in hand.
          const order = topics ? topics.map((t) => t.index) : mod.goals.map((_, i) => i);
          const goal = answer.index ?? goalInHand(order, flow.current.settled);
          const now = Date.now();
          updateModule(target.key, mod.id, (m) => {
            const next = {
              ...m,
              correct: m.correct + (answer.correct ? 1 : 0),
              incorrect: m.incorrect + (answer.correct ? 0 : 1),
              mistakes: answer.mistake && !m.mistakes.includes(answer.mistake) ? [...m.mistakes, answer.mistake].slice(-10) : m.mistakes,
            };
            // A wrong answer puts the goal on the student's list of things to revise.
            return answer.correct ? next : markMissed(next, goal, answer.mistake, now);
          });
          return { ok: true };
        }
        case "start_practice":
          // The explanation is over: from here the app waits for the student.
          setMode("practice");
          evidence.current.practiceBegan();
          updateModule(target.key, mod.id, (m) => ({
            ...m,
            explained: true,
            // Ceeq does not always tick each goal as she explains it.
            goals: m.goals.map((g) => (g === "todo" ? "learning" : g)),
          }));
          return { ok: true, note: "The app now waits for the student after each of your turns." };
        case "finish_module":
          // The quiz comes after practice, and practice needs the student to have answered something.
          if (flow.current.mode !== "practice" || !evidence.current.practised) {
            return { ok: true, note: "The student has not practised yet, so the quiz is not shown. Ask a practice question and wait for their answer." };
          }
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
        case "finish_revision": {
          const left = (topics ?? []).filter((t) => !flow.current.settled.has(t.index));
          if (left.length) {
            return { ok: true, note: `The revision is not finished: goal ${left.map((t) => t.index + 1).join(" and goal ")} still to go over. Carry on with it.` };
          }
          setView("done");
          return { ok: true, note: "The student can now see how the revision went. Say your closing words, then stay silent." };
        }
        default:
          return { ok: false, error: "Unknown tool" };
      }
    },
    [target.key, mod, topics, revising, setMode, setView],
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
    evidence.current.studentSpoke();
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

  /** Connects and begins the lesson in the part the student has reached, or the revision. */
  const begin = useCallback(
    (voiceNow: ReturnType<typeof useCeeqVoice>) => {
      const saved = readChapterProgress(target.key)?.modules[mod.id];
      const settled = flow.current.settled;
      cancelCarryOn();
      flow.current.prompts = 0;
      // A new connection is a new conversation: nothing has been said in it yet.
      evidence.current = new Evidence();
      setPaused(false);
      setView("lesson");
      if (topics) {
        // Reconnecting after a dropped line carries on down the list; a finished revision starts afresh.
        if (topics.every((t) => settled.has(t.index))) {
          settled.clear();
          setOutcomes({});
        }
        setMode("practice");
        void voiceNow.connect(revisionOpening(topics.filter((t) => settled.has(t.index)).map((t) => t.index + 1)));
        return;
      }
      const startIn = startingMode(saved);
      settled.clear();
      // Resuming practice: the goals settled last time are not asked again.
      if (startIn === "practice") {
        saved?.goals.forEach((g, i) => {
          if (g === "understood" || g === "practice") settled.add(i);
        });
      }
      setMode(startIn);
      void voiceNow.connect(openingFor(mod, saved));
    },
    [cancelCarryOn, mod, topics, setMode, setPaused, setView, target.key],
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
    if (provisional) savePlan(target.key, plan, { subject: target.subject, chapter: target.chapter });
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
      const now = Date.now();
      updateModule(target.key, mod.id, (m) =>
        // Each missed question puts the goal it tested on the student's list of things to revise.
        applyQuizAnswers(
          {
            ...m,
            // Reaching the quiz any way counts as having covered the module.
            learned: true,
            attempts: [...m.attempts, { score: result.score, total: result.total, at: now }],
          },
          result.answers,
          now,
        ),
      );
      setClock(now);
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
  const startLabel = busy
    ? "Connecting…"
    : revising
      ? "Start revision"
      : state === "new"
        ? "Start lesson"
        : state === "learning"
          ? "Continue lesson"
          : "Revisit lesson";
  const notice = voice.error ?? (voice.status === "paused" ? (revising ? "Revision paused." : "Lesson paused.") : null);
  // Before the lesson is running, show the part it will start in.
  const part: Part = view === "quiz" ? "quiz" : live || busy ? mode : startingMode(progress);
  const explaining = live && view === "lesson" && mode === "explain";
  const hint =
    !live || view !== "lesson"
      ? null
      : revising
        ? "Ceeq goes over each topic, then asks you about it. Answer out loud, or type."
        : paused
          ? "Paused. Press play to carry on."
          : mode === "explain"
            ? "Ceeq is explaining. Ask a question any time."
            : "Your turn. Answer out loud, or type.";
  const next = nextModule
    ? { href: target.href(nextModule.id), label: `Next: ${nextModule.title}` }
    : { href: target.href(), label: "Back to chapter" };
  // After a quiz in the lesson, offer to go over what it showed up. A revision has just done that.
  const toRevise = revising ? 0 : dueGoals(progress, clock).length;
  const emptyBoard = busy
    ? "Ceeq is getting ready…"
    : live
      ? "Ceeq will write here as she teaches."
      : revising
        ? "Press Start and Ceeq will go over these topics with you."
        : "Press Start and Ceeq will explain this module, then practise it with you.";
  const topicList = topics && <RevisionTopics module={mod} topics={topics} weak={progress?.weak} outcomes={outcomes} now={clock} />;

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
            {target.chapter} · {topics ? `Revision · ${topics.length === 1 ? "1 topic" : `${topics.length} topics`}` : `Module ${index + 1} of ${plan.modules.length}`}
            {!revising && <span className="lg:hidden"> · {PARTS.find((p) => p.id === part)?.label}</span>}
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
        <section className="min-w-0 flex-1 overflow-y-auto bg-surface" aria-label={view === "quiz" ? "Quiz" : view === "done" ? "Revision summary" : "Whiteboard"}>
          {view === "quiz" ? (
            <QuizView
              moduleTitle={mod.title}
              load={loadQuestions}
              onFinished={onQuizFinished}
              // From a revision, "revisit the lesson" means the whole lesson, which is another page.
              onRevisitLesson={revising ? () => router.push(target.href(mod.id)) : live ? () => setView("lesson") : start}
              next={next}
              revise={toRevise ? { href: target.href(mod.id, { revise: true }), count: toRevise } : undefined}
            />
          ) : view === "done" ? (
            <div className="mx-auto max-w-2xl px-5 py-6 sm:px-8 sm:py-10">
              <div className="mb-5 text-sm font-medium text-muted">Revision · {mod.title}</div>
              <h2 className="text-2xl font-semibold tracking-tight">Revision done</h2>
              <p className="mt-1 text-muted">Here is how each topic went. Ceeq will remind you when one needs another look.</p>
              <div className="mt-6 rounded-2xl border border-line p-5">{topicList}</div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={target.href()} onClick={voice.end} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg shadow-sm hover:opacity-90">
                  Back to chapter <Icon name="chevron" className="h-4 w-4" />
                </Link>
                <button onClick={() => setView("quiz")} className="rounded-xl border border-line bg-surface px-4 py-3 font-medium hover:border-muted">
                  {best ? "Retake the quiz" : "Take the quiz"}
                </button>
              </div>
            </div>
          ) : (
            <Board board={board} empty={emptyBoard} />
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
          {revising ? (
            hint && <p className="text-sm text-muted">{hint}</p>
          ) : (
            <div>
              <Parts current={part} />
              {hint && <p className="mt-2.5 text-sm text-muted">{hint}</p>}
            </div>
          )}
          {voice.caption && <p className="text-[15px] leading-relaxed text-muted">{voice.caption}</p>}
          {/* Once a revision is done the main panel shows how each topic went. */}
          {topics ? view !== "done" && topicList : <Goals module={mod} statuses={goals} due={dueGoals(progress, clock).map((g) => g.index)} />}
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
                className="plain-focus min-w-0 flex-1 bg-transparent py-2.5 placeholder:text-muted"
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
            <button
              onClick={voice.end}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
              aria-label={revising ? "End revision" : "End lesson"}
              title={revising ? "End revision" : "End lesson"}
            >
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

/** The module's checklist. `due` lists the goals (by index) the student has to revise now. */
function Goals({ module, statuses, due }: { module: ModulePlan; statuses: GoalStatus[]; due: number[] }) {
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
                {status === "practice" ? (
                  <span className="ml-1.5 text-xs text-(--ink-amber)">practise again</span>
                ) : (
                  due.includes(i) && <span className="ml-1.5 text-xs text-(--ink-amber)">to revise</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The topics of a revision, each with why it is here and, once dealt with, how it went. */
function RevisionTopics({
  module,
  topics,
  weak,
  outcomes,
  now,
}: {
  module: ModulePlan;
  topics: WeakGoal[];
  weak: (WeakSpot | null)[] | undefined;
  outcomes: Record<number, Outcome>;
  now: number;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-muted">Revising</h2>
      <ol className="space-y-3.5">
        {topics.map((topic) => {
          const outcome = outcomes[topic.index];
          const spot = weak?.[topic.index];
          const line =
            outcome === "got"
              ? spot
                ? `Got it. Ceeq will check it again ${dayLabel(spot.dueAt, now)}.`
                : "Got it. Off your list."
              : outcome === "later"
                ? "Still tricky. You’ll come back to it."
                : reasonFor(topic);
          return (
            <li key={topic.index} className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                  outcome === "got" ? STATUS_STYLE.understood : outcome === "later" ? STATUS_STYLE.practice : STATUS_STYLE.todo
                }`}
              >
                {outcome === "got" && <Icon name="check" className="h-3 w-3" />}
              </span>
              <span className="min-w-0 text-sm leading-snug">
                <span className="block font-medium">{module.goals[topic.index]}</span>
                <span className={`mt-0.5 block ${outcome === "got" ? "text-(--ink-green)" : outcome === "later" ? "text-(--ink-amber)" : "text-muted"}`}>{line}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
