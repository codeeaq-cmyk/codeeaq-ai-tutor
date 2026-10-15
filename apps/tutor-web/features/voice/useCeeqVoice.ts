"use client";

// Ceeq's voice, built on cqwebsite's useVoiceAssistant: the createVoiceSession
// function mints a one-use Gemini Live token and the browser streams audio
// straight to Google with it.
//
// Hands-free: once started, the mic stays open and Gemini's own voice
// activity detection decides when the student has finished, so there is no
// button to hold. Talking over Ceeq interrupts her. Tool calls from the model
// (whiteboard, lesson plan, progress) are answered immediately in the browser.
//
// A connection to the service does not last a lesson: it ends after about ten
// minutes, sooner if it is sent no sound, and now and then goes dead in the
// middle of a reply. The lesson is then carried over to a new connection with
// a new token (see `reconnect`); the app using this hook says what the Ceeq
// on it must be told (see `CarryOver`).

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";
import type { StartVoiceResponse } from "@codeeaq/shared-types";
import { endsSentence, pauseNear, TurnSpeech, type Cut } from "./turnSpeech";

export type VoiceStatus = "idle" | "connecting" | "live" | "paused" | "error";
export type VoiceActivity = "idle" | "listening" | "thinking" | "speaking";

export type ToolHandler = (name: string, args: Record<string, unknown>) => Record<string, unknown>;

interface Options {
  getToken: () => Promise<StartVoiceResponse>;
  onToolCall: ToolHandler;
  /**
   * Ceeq's speech for a turn has all arrived. `remainingMs` is how much of it
   * the student has yet to hear (speech arrives several times faster than it
   * is spoken). `afterStudent` is true when the turn answered something the
   * student said or typed. `silent` is true when she said nothing at all.
   */
  onTurnEnd?: (info: { afterStudent: boolean; remainingMs: number; silent: boolean }) => void;
  /** The student started speaking (cutting in on Ceeq, or heard to say something) or sent a typed message. */
  onStudentInput?: () => void;
  /**
   * Ceeq cannot be heard from. "no-reply": she was due to speak and nothing
   * has come since she was prompted; `attempt` counts how often this has now
   * been reported in a row. "stuck": she called a tool, was answered, and then
   * stopped, or stopped part-way through what she was saying, after which the
   * service ignores prompts on this connection.
   * "closing": the service has given notice that the connection will end (it
   * does after about ten minutes, with under a minute's notice), and this is a
   * quiet moment to replace it. "closed": the connection has ended.
   * Return true if something was done about it; otherwise the lesson is
   * paused (or, for "closing", left to run until the connection ends).
   */
  onSilence?: (why: "no-reply" | "stuck" | "closing" | "closed", attempt: number) => boolean;
}

/** What a new connection is told so that the lesson can carry on over it. Ceeq remembers nothing of the old one. */
export interface CarryOver {
  /** Where the lesson stands. */
  note: string;
  /** The last thing she said to the student, or "" if she had said nothing yet. */
  lastWords: string;
  /** What to ask of her if she was due to speak when the old connection was lost. */
  prompt: string;
}

const MIC_SAMPLE_RATE = 16000; // must match public/audio-processor.js
const MIC_FORMAT = `audio/pcm;rate=${MIC_SAMPLE_RATE}`;
/**
 * The service ends a connection that has sent it no sound for about five
 * minutes. While the mic is not feeding it (muted, blocked, or switched off
 * for a quiz), this much silence is sent, this often, in its place.
 */
const HUSH_MS = 250;
/** How long a connection may take to open before it is given up and another is tried. */
const CONNECT_TIMEOUT_MS = 8000;
/** How many times opening a connection is tried before the student is told it failed. */
const CONNECT_TRIES = 3;
const PLAYBACK_SAMPLE_RATE = 24000; // Gemini Live's output audio rate
const TOKEN_TTL_MS = 8 * 60 * 1000; // a token can open a connection for 10 minutes after it is minted
const IDLE_PAUSE_MS = 4 * 60 * 1000; // stop the lesson after this long without the student
/**
 * A lesson the student has paused keeps its connection for this long, so that
 * a short pause costs nothing to come back from. After that the connection is
 * closed (an open one is paid for by the minute, and lasts ten at most), and
 * the lesson is carried over to a new one when the student carries on.
 */
const PARK_AFTER_MS = 2 * 60 * 1000;
/** The pause left between one of Ceeq's turns and the next when they follow straight on. */
const BREATH_SECONDS = 0.7;
// While Ceeq speaks, mic chunks quieter than this are treated as her own echo.
const BARGE_IN_RMS = 0.045;
/** For this long after the mic last picked up something that loud, the student is taken to be still talking. */
const VOICE_HANG_MS = 900;
/** How often the lesson is checked for a turn that never ended or a reply that never came. */
const WATCH_MS = 500;
/**
 * Her speech arrives in a steady stream, followed at once by word that it has
 * all come. If a turn is still open and nothing has come for this long, the
 * service has abandoned the reply, and the connection with it.
 */
const STALLED_MS = 4000;
/** How long Ceeq may stay silent when she is due to speak before something is done about it. */
const NO_REPLY_MS = 10_000;
/**
 * After a tool call is answered the service sends something within two
 * seconds: more speech, another call, or word that her speech has all arrived
 * (when the call came after it). Silence this long means the connection is dead.
 */
const STUCK_MS = 3500;
/** Speech that arrives this long after the app moved on, with the old turn never closed, belongs to the new turn. */
const MOVED_ON_MS = 1500;
/** The loudness of her speech is noted at this resolution, for finding pauses. */
const LEVEL_FRAME_SECONDS = 0.02;

/** A piece of a turn's speech that has been queued for playing. */
interface Piece {
  src: AudioBufferSourceNode;
  startAt: number;
  duration: number;
  /** The part of the turn's speech it carries, in seconds as received (before slowing). */
  fromSeconds: number;
  toSeconds: number;
}

export function useCeeqVoice({ getToken, onToolCall, onTurnEnd, onStudentInput, onSilence }: Options) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [activity, setActivity] = useState<VoiceActivity>("idle");
  const [micOn, setMicOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [heard, setHeardState] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Her latest words and the student's are also needed outside render, to carry a lesson over to a new connection.
  const captionRef = useRef("");
  const heardRef = useRef("");
  const showCaption = useCallback((text: string) => {
    captionRef.current = text;
    setCaption(text);
  }, []);
  const setHeard = useCallback((text: string) => {
    heardRef.current = text;
    setHeardState(text);
  }, []);

  const sessionRef = useRef<Session | null>(null);
  const generationRef = useRef(0);
  /** The generation of the lesson start now under way, if one is. */
  const startingRef = useRef<number | null>(null);
  const toolRef = useRef(onToolCall);
  const turnEndRef = useRef(onTurnEnd);
  const studentInputRef = useRef(onStudentInput);
  const silenceRef = useRef(onSilence);
  useEffect(() => {
    toolRef.current = onToolCall;
    turnEndRef.current = onTurnEnd;
    studentInputRef.current = onStudentInput;
    silenceRef.current = onSilence;
  }, [onToolCall, onTurnEnd, onStudentInput, onSilence]);

  // ---------- Where Ceeq's turn has got to ----------
  //
  // Her speech arrives several times faster than it is spoken. The lesson is
  // paced by what the student has heard: a turn is over for the app once all
  // its speech has arrived, and the app is told how much of it is still to
  // play. The service's own "turn complete" comes when it reckons the speech
  // has been heard. That is about when the student has in fact heard it, but
  // it can be half a minute late (when she says more than is played) or never
  // come, so it is only a fallback. Prompting her before then simply cuts the
  // service's turn short.

  /** Speech for a turn is arriving and the app has not yet been told the turn is over. */
  const midTurnRef = useRef(false);
  /** The app has been told that the turn it is waiting for is over. False from when one is due until it ends. */
  const turnEndedRef = useRef(true);
  /** Speech of the turn the app is waiting for has started to arrive (and not just the tail of the one before). */
  const awaitedBegunRef = useRef(false);
  /** The service has sent something for a turn and not yet said it is complete or interrupted. */
  const serverTurnOpenRef = useRef(false);
  /** The next "complete" from the service belongs to a turn already moved on from, and does not count. */
  const staleCompleteRef = useRef(false);
  /** The app itself prompted her before the service closed her turn, so the "interrupted" that follows is not the student. */
  const selfCutRef = useRef(false);
  /** When the app moved on from a turn the service still had open. */
  const movedOnAtRef = useRef<number | null>(null);
  /** The student said or typed something since Ceeq's last finished turn. */
  const afterStudentRef = useRef(false);
  /** Since when Ceeq has been due to speak, or null if she is not. */
  const owedSinceRef = useRef<number | null>(null);
  const nudgesRef = useRef(0);
  const lastServerAtRef = useRef(0);
  /** When a tool call was last answered, until the service says anything more. */
  const toolAnsweredAtRef = useRef<number | null>(null);
  /** The service has said this connection will end shortly. */
  const closingRef = useRef(false);
  /** A prompt from the app that came while one connection was being replaced by another. */
  const pendingPromptRef = useRef<string | null>(null);
  /** Something the student typed while there was no connection. */
  const pendingTextRef = useRef<string | null>(null);
  /** The connection of a paused lesson has been closed; the lesson itself is kept as it is. */
  const parkedRef = useRef(false);
  const parkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Since when nothing has been playing, or null while she can be heard. */
  const drainedAtRef = useRef<number | null>(null);

  // ---------- Token prefetch ----------

  const tokenRef = useRef<{ at: number; promise: Promise<StartVoiceResponse> } | null>(null);

  /** Mints a token ahead of time so starting the lesson doesn't wait on it. */
  const prepare = useCallback(() => {
    const t = tokenRef.current;
    if (t && Date.now() - t.at < TOKEN_TTL_MS) return;
    const promise = getToken();
    tokenRef.current = { at: Date.now(), promise };
    promise.catch(() => {
      if (tokenRef.current?.promise === promise) tokenRef.current = null;
    });
  }, [getToken]);

  const takeToken = useCallback(() => {
    const t = tokenRef.current;
    tokenRef.current = null; // one use each
    return t && Date.now() - t.at < TOKEN_TTL_MS ? t.promise : getToken();
  }, [getToken]);

  // ---------- Playback (24kHz PCM16) with a level meter ----------

  const playCtxRef = useRef<AudioContext | null>(null);
  const outputRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const nextStartRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const speakingRef = useRef(false);
  const newTurnRef = useRef(true);
  /** The student has paused playback. */
  const heldRef = useRef(false);
  /** The next audio to be queued is the start of a new turn. */
  const breathRef = useRef(false);

  // The current turn's speech: what has been queued, and how loud it was moment
  // by moment, so that a repeated paragraph can be cut out between sentences.
  const speechRef = useRef<TurnSpeech<Float32Array> | null>(null);
  const getSpeech = useCallback(() => (speechRef.current ??= new TurnSpeech<Float32Array>()), []);
  const piecesRef = useRef<Piece[]>([]);
  const turnSecondsRef = useRef(0);
  const levelsRef = useRef<number[]>([]);
  const levelRestRef = useRef({ sum: 0, count: 0 });

  const ensurePlayback = useCallback(() => {
    if (!playCtxRef.current) {
      const ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const output = ctx.createGain();
      output.connect(analyser);
      analyser.connect(ctx.destination);
      playCtxRef.current = ctx;
      outputRef.current = output;
      analyserRef.current = analyser;
      nextStartRef.current = 0;
    }
    // A context the student paused stays paused; audio that arrives meanwhile queues up.
    if (playCtxRef.current.state === "suspended" && !heldRef.current) void playCtxRef.current.resume();
    return playCtxRef.current;
  }, []);

  /** Freezes Ceeq's voice exactly where it is. Nothing is lost: it carries on from there. (See `hold`.) */
  const holdPlayback = useCallback(() => {
    heldRef.current = true;
    void playCtxRef.current?.suspend();
  }, []);

  const releasePlayback = useCallback(() => {
    heldRef.current = false;
    if (playCtxRef.current?.state === "suspended") void playCtxRef.current.resume();
  }, []);

  const levelBuffer = useRef<Uint8Array<ArrayBuffer> | null>(null);
  /** Ceeq's current voice loudness, 0 to 1, for animation. */
  const getLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || !speakingRef.current) return 0;
    levelBuffer.current ??= new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(levelBuffer.current);
    let sum = 0;
    for (const v of levelBuffer.current) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / levelBuffer.current.length) * 4);
  }, []);

  const setSpeaking = useCallback((speaking: boolean) => {
    speakingRef.current = speaking;
    setActivity((a) => (speaking ? "speaking" : a === "speaking" ? "idle" : a));
  }, []);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    });
    sourcesRef.current = [];
    piecesRef.current = [];
    midTurnRef.current = false;
    nextStartRef.current = playCtxRef.current?.currentTime ?? 0;
    setSpeaking(false);
  }, [setSpeaking]);

  /** Queues audio to play right after whatever is already queued. */
  const schedule = useCallback(
    (samples: Float32Array, fromSeconds = 0, toSeconds = 0) => {
      if (!samples.length) return;
      const ctx = ensurePlayback();
      const buffer = ctx.createBuffer(1, samples.length, PLAYBACK_SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(outputRef.current!);
      let startAt = Math.max(ctx.currentTime, nextStartRef.current);
      if (breathRef.current) {
        // A new turn that would follow straight on from the last gets a short
        // breath first, so paragraphs don't run together.
        breathRef.current = false;
        if (nextStartRef.current > 0) startAt = Math.max(startAt, nextStartRef.current + BREATH_SECONDS);
      }
      src.start(startAt);
      nextStartRef.current = startAt + buffer.duration;
      sourcesRef.current.push(src);
      if (toSeconds > fromSeconds) piecesRef.current.push({ src, startAt, duration: buffer.duration, fromSeconds, toSeconds });
      setSpeaking(true);
      src.onended = () => {
        sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
        if (sourcesRef.current.length === 0) setSpeaking(false);
      };
    },
    [ensurePlayback, setSpeaking],
  );

  /** How much queued speech the student has yet to hear. */
  const remainingMs = useCallback(() => {
    const ctx = playCtxRef.current;
    return ctx ? Math.max(0, nextStartRef.current - ctx.currentTime) * 1000 : 0;
  }, []);

  /** Queues a piece of the current turn's speech, noting where in the turn it falls and how loud it is. */
  const playSpeech = useCallback(
    (pcm: Float32Array) => {
      const from = turnSecondsRef.current;
      turnSecondsRef.current += pcm.length / PLAYBACK_SAMPLE_RATE;
      const frame = Math.round(LEVEL_FRAME_SECONDS * PLAYBACK_SAMPLE_RATE);
      const rest = levelRestRef.current;
      for (const sample of pcm) {
        rest.sum += sample * sample;
        if (++rest.count === frame) {
          levelsRef.current.push(Math.sqrt(rest.sum / frame));
          rest.sum = 0;
          rest.count = 0;
        }
      }
      schedule(pcm, from, turnSecondsRef.current);
    },
    [schedule],
  );

  /** Takes back the current turn's queued speech from `seconds` into the turn onwards. */
  const cutSpeech = useCallback((seconds: number) => {
    const ctx = playCtxRef.current;
    if (!ctx) return;
    let cutAt: number | null = null;
    const kept: Piece[] = [];
    for (const piece of piecesRef.current) {
      if (piece.toSeconds <= seconds) {
        kept.push(piece);
        continue;
      }
      // The piece the cut falls in plays up to the cut; later ones are never heard.
      const within = piece.fromSeconds < seconds ? ((seconds - piece.fromSeconds) / (piece.toSeconds - piece.fromSeconds)) * piece.duration : 0;
      cutAt ??= piece.startAt + within;
      try {
        piece.src.stop(Math.max(ctx.currentTime, piece.startAt + within));
      } catch {
        // already stopped
      }
    }
    piecesRef.current = kept;
    if (cutAt !== null) nextStartRef.current = Math.max(ctx.currentTime, cutAt);
  }, []);

  // ---------- Idle pause ----------

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseRef = useRef<() => void>(() => {});
  const touch = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // A lesson the student has paused is not an idle one: it waits for them (see `hold`).
      if (!heldRef.current) pauseRef.current();
    }, IDLE_PAUSE_MS);
  }, []);

  // ---------- Server messages ----------

  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Tells the app the current turn is over, once. */
  const completeTurn = useCallback(
    (silent: boolean) => {
      if (turnEndedRef.current) return;
      turnEndedRef.current = true;
      midTurnRef.current = false;
      setHeard("");
      const afterStudent = afterStudentRef.current;
      afterStudentRef.current = false;
      turnEndRef.current?.({ afterStudent, remainingMs: remainingMs(), silent });
    },
    [remainingMs, setHeard],
  );

  /** The rest of the turn is not to be heard: cuts what must not play and ends the turn for the app. */
  const endSpeech = useCallback(
    (cut: Cut) => {
      // Cut in a pause if she makes one near there; otherwise a little after, to be sure of her last word.
      if (cut.at !== null) cutSpeech(pauseNear(levelsRef.current, LEVEL_FRAME_SECONDS, cut.at) ?? cut.at + 0.25);
      completeTurn(false);
    },
    [completeTurn, cutSpeech],
  );

  /** Ceeq is now due to say something: an opening, a reply, or the next step. */
  const expectReply = useCallback(() => {
    owedSinceRef.current = Date.now();
    turnEndedRef.current = false;
    awaitedBegunRef.current = false;
  }, []);

  /** The app is moving on (a prompt, or the student typing) whether or not the service has closed her turn. */
  const moveOn = useCallback(
    (byStudent: boolean) => {
      if (serverTurnOpenRef.current) {
        // What is still to come of the old turn is dropped, and its "complete" must not be taken for the new one's.
        staleCompleteRef.current = true;
        selfCutRef.current = !byStudent;
        movedOnAtRef.current = Date.now();
        getSpeech().abandon();
      }
      newTurnRef.current = true;
      expectReply();
    },
    [expectReply, getSpeech],
  );

  /** The service never closed the turn the app moved on from, and has plainly started the next. */
  const startedAnyway = useCallback(() => {
    if (movedOnAtRef.current === null || Date.now() - movedOnAtRef.current < MOVED_ON_MS) return;
    movedOnAtRef.current = null;
    getSpeech().endTurn();
    newTurnRef.current = true;
  }, [getSpeech]);

  const handleMessage = useCallback(
    (message: LiveServerMessage) => {
      if (message.goAway) {
        // Notice that the connection is about to end. A token is fetched now, so that carrying on over a new one is quick.
        closingRef.current = true;
        prepare();
      }
      const calls = message.toolCall?.functionCalls;
      const content = message.serverContent;
      // Anything from her after a tool call was answered shows the connection is alive.
      if (calls?.length || content?.modelTurn || content?.outputTranscription || content?.generationComplete || content?.turnComplete || content?.interrupted) {
        toolAnsweredAtRef.current = null;
      }
      if (calls?.length) {
        startedAnyway();
        serverTurnOpenRef.current = true;
        lastServerAtRef.current = Date.now();
        const step = getSpeech().toolCall();
        if (step.over) endSpeech(step.over);
        const functionResponses = calls.map((call) => {
          let response: Record<string, unknown>;
          try {
            response = toolRef.current(call.name ?? "", (call.args ?? {}) as Record<string, unknown>);
          } catch (err) {
            console.error(`Tool ${call.name} failed:`, err);
            response = { ok: false, error: "The app could not apply that." };
          }
          return { id: call.id, name: call.name, response };
        });
        sessionRef.current?.sendToolResponse({ functionResponses });
        toolAnsweredAtRef.current = Date.now();
      }

      if (!content) return;

      if (content.interrupted) {
        // When the app's own prompt cut the service's turn short, what is queued must still be heard.
        // Otherwise the student has cut in. Their words take a few seconds more to arrive, and the
        // app must know now, or it would ask her to carry on before she has answered them.
        if (!selfCutRef.current) {
          stopPlayback();
          afterStudentRef.current = true;
          studentInputRef.current?.();
        }
        selfCutRef.current = false;
        movedOnAtRef.current = null;
        serverTurnOpenRef.current = false;
        // The turn that was cut is closed with a "complete" that says nothing about the next one.
        staleCompleteRef.current = true;
        getSpeech().endTurn();
        newTurnRef.current = true;
        // Whoever cut in, a new turn is now due.
        expectReply();
      }

      const heardDelta = content.inputTranscription?.text;
      if (heardDelta) {
        touch();
        afterStudentRef.current = true;
        // Heard while her speech is still arriving, it may be the student cutting in (the service will say so)
        // or only a noise, after which her turn ends as usual. Once her turn is over, it calls for a reply.
        if (!midTurnRef.current) expectReply();
        studentInputRef.current?.();
        setHeard(heardRef.current + heardDelta);
        if (!speakingRef.current) setActivity("listening");
        // Once the student's words stop arriving, Ceeq is working on a reply.
        if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = setTimeout(() => {
          if (!speakingRef.current) setActivity("thinking");
        }, 700);
      }

      for (const part of content.modelTurn?.parts ?? []) {
        if (!part.inlineData?.data) continue;
        startedAnyway();
        const speech = getSpeech();
        lastServerAtRef.current = Date.now();
        if (newTurnRef.current && !speech.over) {
          newTurnRef.current = false;
          serverTurnOpenRef.current = true;
          turnEndedRef.current = false;
          awaitedBegunRef.current = true;
          staleCompleteRef.current = false;
          selfCutRef.current = false;
          midTurnRef.current = true;
          breathRef.current = true;
          owedSinceRef.current = null;
          nudgesRef.current = 0;
          piecesRef.current = [];
          levelsRef.current = [];
          levelRestRef.current = { sum: 0, count: 0 };
          turnSecondsRef.current = 0;
          showCaption(speech.caption);
        }
        if (speech.over) continue;
        const pcm = decodePcm(part.inlineData.data);
        const step = speech.audio(pcm, pcm.length / PLAYBACK_SAMPLE_RATE);
        step.play.forEach(playSpeech);
        if (step.over) endSpeech(step.over);
      }

      const spokenDelta = content.outputTranscription?.text;
      if (spokenDelta) {
        const speech = getSpeech();
        const step = speech.text(spokenDelta);
        if (!speech.over || step.over) showCaption(speech.caption);
        if (step.over) endSpeech(step.over);
      }

      // All of her speech for this turn has arrived: the app can plan what comes after it.
      // (A late signal about a turn already moved on from is not the end of the one now due.)
      if (content.generationComplete && serverTurnOpenRef.current) {
        const speech = getSpeech();
        if (awaitedBegunRef.current || !speech.spoken) completeTurn(!speech.spoken);
      }

      if (content.turnComplete) {
        const speech = getSpeech();
        const stale = staleCompleteRef.current;
        staleCompleteRef.current = false;
        selfCutRef.current = false;
        movedOnAtRef.current = null;
        serverTurnOpenRef.current = false;
        newTurnRef.current = true;
        if (!stale && (awaitedBegunRef.current || !speech.spoken)) completeTurn(!speech.spoken);
        speech.endTurn();
      }
    },
    [completeTurn, endSpeech, expectReply, getSpeech, playSpeech, prepare, setHeard, showCaption, startedAnyway, stopPlayback, touch],
  );

  // ---------- Mic (hands-free) ----------

  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micNodeRef = useRef<AudioWorkletNode | null>(null);
  /** When the mic last picked up something as loud as a voice. */
  const loudAtRef = useRef(0);

  const stopMic = useCallback(() => {
    if (micNodeRef.current) {
      micNodeRef.current.port.onmessage = null;
      micNodeRef.current.disconnect();
      micNodeRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    void micCtxRef.current?.close();
    micCtxRef.current = null;
    if (sessionRef.current) sessionRef.current.sendRealtimeInput({ audioStreamEnd: true });
    setMicOn(false);
  }, []);

  const startMic = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || micStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (sessionRef.current !== session) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      micCtxRef.current = ctx;
      await ctx.audioWorklet.addModule("/audio-processor.js");
      const node = new AudioWorkletNode(ctx, "mic-processor");
      micNodeRef.current = node;
      node.port.onmessage = (event) => {
        const int16 = new Int16Array(event.data as ArrayBuffer);
        const loud = rms(int16) >= BARGE_IN_RMS;
        if (loud) loudAtRef.current = Date.now();
        // Echo gate: while Ceeq talks, only clearly louder speech gets through. The rest goes
        // as silence, so that the sound the service receives never stops (see HUSH_MS).
        const heard = speakingRef.current && !loud ? new Int16Array(int16.length) : int16;
        session.sendRealtimeInput({ audio: { data: int16ToBase64(heard), mimeType: MIC_FORMAT } });
      };
      const silent = ctx.createGain();
      silent.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node);
      node.connect(silent);
      silent.connect(ctx.destination);
      setMicOn(true);
    } catch (err) {
      console.warn("Microphone unavailable:", err);
      setError("Microphone is blocked. Allow it in the address bar, or type your answers.");
      stopMic();
    }
  }, [stopMic]);

  /** Whether the student wants the mic on. Kept across a reconnection. */
  const wantMicRef = useRef(true);
  /** Whether the app wants Ceeq to be listening just now. */
  const hearingRef = useRef(true);
  const toggleMic = useCallback(() => {
    wantMicRef.current = !micStreamRef.current;
    if (micStreamRef.current) stopMic();
    else {
      // The student asking for the mic counts for more than the app's wish for quiet.
      hearingRef.current = true;
      void startMic();
    }
  }, [startMic, stopMic]);

  /**
   * Stops Ceeq listening for a while (during a written quiz, say), or lets her
   * listen again. What the student chose with the mic button stays as it was.
   */
  const setHearing = useCallback(
    (on: boolean) => {
      if (hearingRef.current === on) return;
      hearingRef.current = on;
      if (!on) stopMic();
      else if (wantMicRef.current && sessionRef.current) void startMic();
    },
    [startMic, stopMic],
  );

  // ---------- Connection ----------

  /** Forgets where the conversation with the service had got to: the next thing heard starts afresh. */
  const forgetTurn = useCallback(() => {
    speechRef.current?.endTurn();
    newTurnRef.current = true;
    midTurnRef.current = false;
    turnEndedRef.current = true;
    awaitedBegunRef.current = false;
    serverTurnOpenRef.current = false;
    staleCompleteRef.current = false;
    selfCutRef.current = false;
    movedOnAtRef.current = null;
    afterStudentRef.current = false;
    owedSinceRef.current = null;
    toolAnsweredAtRef.current = null;
    nudgesRef.current = 0;
  }, []);

  const teardown = useCallback(() => {
    generationRef.current++;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    stopMic();
    stopPlayback();
    releasePlayback();
    forgetTurn();
    drainedAtRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    closingRef.current = false;
    pendingPromptRef.current = null;
    pendingTextRef.current = null;
    if (parkTimerRef.current) clearTimeout(parkTimerRef.current);
    parkTimerRef.current = null;
    parkedRef.current = false;
    setActivity("idle");
    setHeard("");
  }, [forgetTurn, releasePlayback, setHeard, stopMic, stopPlayback]);

  const pause = useCallback(() => {
    teardown();
    setStatus("paused");
  }, [teardown]);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ---------- Pausing ----------
  //
  // The student can stop the lesson at any moment and carry on from the very
  // word it stopped at, however much later: her voice is frozen, not dropped.
  // A short pause keeps the connection. A long one closes it, since an open
  // connection costs money and ends after ten minutes anyway; where the lesson
  // had got to is kept here, and the app carries it over to a new connection
  // when the student comes back (see `reconnect`).

  /**
   * Closes the connection of a lesson that stays as it is: what is queued to
   * play, and where the conversation had got to, are kept.
   */
  const park = useCallback(() => {
    if (statusRef.current !== "live" || parkedRef.current) return;
    // Whatever connection there is, or is being opened, no longer counts.
    generationRef.current++;
    stopMic();
    sessionRef.current?.close();
    sessionRef.current = null;
    closingRef.current = false;
    toolAnsweredAtRef.current = null;
    parkedRef.current = true;
  }, [stopMic]);

  /** The student pauses the lesson: Ceeq stops in the middle of her word. */
  const hold = useCallback(() => {
    holdPlayback();
    if (parkTimerRef.current) clearTimeout(parkTimerRef.current);
    parkTimerRef.current = setTimeout(park, PARK_AFTER_MS);
  }, [holdPlayback, park]);

  /**
   * The student carries on: she goes on from the word she stopped at. True if
   * the connection was closed meanwhile, in which case the app must carry the
   * lesson over to a new one.
   */
  const release = useCallback(() => {
    if (parkTimerRef.current) clearTimeout(parkTimerRef.current);
    parkTimerRef.current = null;
    releasePlayback();
    if (statusRef.current === "live") touch();
    return parkedRef.current;
  }, [releasePlayback, touch]);

  useEffect(() => {
    pauseRef.current = pause;
  }, [pause]);

  // Three ways the service lets a lesson down. A reply that never comes (an
  // empty turn): the app is told, and prompts her again. A connection that goes
  // dead after a tool call, and a reply abandoned part-way, which leaves the
  // connection just as dead: the app is told, and replaces it. If the app can
  // do nothing, the lesson is paused.
  useEffect(() => {
    if (status !== "live") return;
    const timer = setInterval(() => {
      const now = Date.now();
      if (remainingMs() > 0 || heldRef.current) drainedAtRef.current = null;
      else drainedAtRef.current ??= now;
      const quietFor = drainedAtRef.current === null ? 0 : now - drainedAtRef.current;

      const giveUp = () => {
        setError("Ceeq stopped responding. Press Start to carry on.");
        pauseRef.current();
      };
      if (serverTurnOpenRef.current && !turnEndedRef.current && awaitedBegunRef.current && !heldRef.current && now - lastServerAtRef.current > STALLED_MS) {
        serverTurnOpenRef.current = false;
        // If she got to the end of a sentence, the turn can pass for finished. If not it stays
        // unfinished, and she is asked for the rest of it on the new connection.
        if (endsSentence(captionRef.current)) completeTurn(false);
        if (!silenceRef.current?.("stuck", 1)) giveUp();
        return;
      }
      if (toolAnsweredAtRef.current !== null && now - toolAnsweredAtRef.current > STUCK_MS) {
        toolAnsweredAtRef.current = null;
        if (!silenceRef.current?.("stuck", 1)) giveUp();
        return;
      }
      // The service has given notice that this connection will end. Between her turns, with
      // nobody speaking, is the moment to move to a new one without the student noticing.
      if (closingRef.current && sessionRef.current && turnEndedRef.current && owedSinceRef.current === null && now - loudAtRef.current > VOICE_HANG_MS) {
        closingRef.current = false;
        silenceRef.current?.("closing", 1);
        return;
      }
      // Silence only counts from when she was due to speak, and not while she can still be heard.
      if (owedSinceRef.current === null || Math.min(quietFor, now - owedSinceRef.current) < NO_REPLY_MS) return;
      owedSinceRef.current = now;
      if (!silenceRef.current?.("no-reply", ++nudgesRef.current)) giveUp();
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [status, completeTurn, remainingMs]);

  // While the mic is not feeding the service, silence is sent in its place (see HUSH_MS).
  useEffect(() => {
    if (status !== "live") return;
    const hush = int16ToBase64(new Int16Array((MIC_SAMPLE_RATE * HUSH_MS) / 1000));
    const timer = setInterval(() => {
      if (!micNodeRef.current) sessionRef.current?.sendRealtimeInput({ audio: { data: hush, mimeType: MIC_FORMAT } });
    }, HUSH_MS);
    return () => clearInterval(timer);
  }, [status]);

  /**
   * Opens one connection to the service with a new token. The service does not
   * always let one open: it can refuse, or leave the attempt hanging (the
   * library then waits for ever). Either way this fails, within CONNECT_TIMEOUT_MS.
   */
  const dial = useCallback(
    async (stale: () => boolean): Promise<Session> => {
      // What this attempt may still do: nothing once it has been given up, and its closing only counts once it has opened.
      const link = { open: false, dropped: false };
      let fail: (reason: Error) => void = () => {};
      const failed = new Promise<never>((_, reject) => {
        fail = reject;
      });
      const timer = setTimeout(() => fail(new Error("Ceeq's voice took too long to connect.")), CONNECT_TIMEOUT_MS);
      try {
        const { token, model } = await Promise.race([takeToken(), failed]);
        const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
        const opening = ai.live.connect({
          model,
          callbacks: {
            onmessage: (message) => {
              if (!stale() && !link.dropped) handleMessage(message);
            },
            onerror: (e) => {
              if (stale() || link.dropped) return;
              console.error("Voice error:", e);
              if (!link.open) fail(new Error("Ceeq's voice could not connect."));
            },
            onclose: () => {
              if (stale() || link.dropped) return;
              if (!link.open) return fail(new Error("Ceeq's voice could not connect."));
              // The app is asked to carry the lesson on over a new connection. If it cannot, the lesson is paused.
              sessionRef.current = null;
              if (silenceRef.current?.("closed", 1)) return;
              teardown();
              setStatus("paused");
            },
          },
        });
        // One that opens after it was given up is closed again at once.
        opening.then(
          (late) => link.dropped && late.close(),
          () => {},
        );
        const session = await Promise.race([opening, failed]);
        link.open = true;
        return session;
      } catch (err) {
        link.dropped = true;
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    [handleMessage, takeToken, teardown],
  );

  /**
   * Opens a connection to the service, trying again if the first attempt
   * fails; `start` then tells Ceeq where to begin. False if it was overtaken
   * by a later one.
   */
  const openSession = useCallback(
    async (start: (session: Session) => void, generation: number) => {
      const stale = () => generation !== generationRef.current;
      let session: Session | undefined;
      for (let attempt = 1; !session; attempt++) {
        try {
          session = await dial(stale);
        } catch (err) {
          if (stale()) return false;
          if (attempt >= CONNECT_TRIES) throw err;
          console.warn(`Voice connection attempt ${attempt} failed:`, err);
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
        if (stale()) {
          session?.close();
          return false;
        }
      }
      sessionRef.current = session;
      closingRef.current = false;
      forgetTurn();
      start(session);
      // What was asked of her while there was no connection is asked now. The student's own words come before the app's.
      const typed = pendingTextRef.current;
      const waiting = pendingPromptRef.current;
      pendingTextRef.current = null;
      pendingPromptRef.current = null;
      if (typed) {
        afterStudentRef.current = true;
        expectReply();
        session.sendRealtimeInput({ text: typed });
      } else if (waiting) {
        expectReply();
        session.sendClientContent({ turns: [{ role: "user", parts: [{ text: waiting }] }], turnComplete: true });
      }
      touch();
      if (wantMicRef.current && hearingRef.current) void startMic();
      prepare(); // ready for a quick resume later
      return true;
    },
    [dial, expectReply, forgetTurn, prepare, startMic, touch],
  );

  /** Starts a live lesson. `opening` tells Ceeq where to begin. Call from a click. */
  const connect = useCallback(
    async (opening: string) => {
      // A lesson that is running, or already starting, is left alone: Start may be pressed twice,
      // or pressed just as the page starts the lesson by itself.
      if (sessionRef.current || startingRef.current === generationRef.current) return;
      const generation = ++generationRef.current;
      startingRef.current = generation;
      ensurePlayback(); // must happen inside the click for browsers to allow sound
      setStatus("connecting");
      setError(null);
      showCaption("");
      wantMicRef.current = true;
      const start = (session: Session) => {
        expectReply();
        session.sendClientContent({ turns: [{ role: "user", parts: [{ text: opening }] }], turnComplete: true });
      };
      try {
        if (await openSession(start, generation)) setStatus("live");
      } catch (err) {
        if (generation !== generationRef.current) return;
        console.error("Voice connection failed:", err);
        setError(`${err instanceof Error ? err.message.replace(/\.$/, "") : "Could not start Ceeq's voice"}. Press Start to try again.`);
        setStatus("error");
      } finally {
        if (startingRef.current === generation) startingRef.current = null;
      }
    },
    [ensurePlayback, expectReply, openSession, showCaption],
  );

  /**
   * Carries the lesson over to a new connection: one that has ended, gone
   * dead, or is about to end. The lesson stays on screen as it is, and what is
   * queued goes on playing. The new Ceeq is told where the lesson stands and
   * what she last said, without being asked to speak, unless something was
   * waiting on her (a reply she owed, or the rest of one she was cut off in):
   * then the student's words are put to her again, or the app's prompt is.
   * It is also how a lesson paused for a long time gets its connection back.
   * False if the lesson is not running.
   */
  const reconnect = useCallback(
    (carry: CarryOver) => {
      if (statusRef.current !== "live") return false;
      const old = sessionRef.current;
      // Something is waiting on her if she was due to speak, or was cut off part-way through speaking.
      const due = owedSinceRef.current !== null || midTurnRef.current;
      const unanswered = afterStudentRef.current ? heardRef.current.trim() : "";
      // From here the old connection's messages, and its closing, no longer count.
      const generation = ++generationRef.current;
      stopMic();
      sessionRef.current = null;
      old?.close();
      forgetTurn();
      parkedRef.current = false;
      const start = (session: Session) => {
        const history = [
          { role: "user", parts: [{ text: carry.note }] },
          ...(carry.lastWords ? [{ role: "model", parts: [{ text: carry.lastWords }] }] : []),
        ];
        if (unanswered) {
          session.sendClientContent({ turns: history, turnComplete: false });
          afterStudentRef.current = true;
          expectReply();
          session.sendRealtimeInput({ text: unanswered });
        } else if ((due || !carry.lastWords) && !pendingPromptRef.current) {
          // A prompt the app has waiting is put to her once the connection is open (see openSession), in place of this one.
          expectReply();
          session.sendClientContent({ turns: [...history, { role: "user", parts: [{ text: carry.prompt }] }], turnComplete: true });
        } else {
          session.sendClientContent({ turns: history, turnComplete: false });
        }
      };
      openSession(start, generation).catch((err: unknown) => {
        if (generation !== generationRef.current) return;
        console.error("Voice reconnection failed:", err);
        setError("Ceeq's connection dropped. Press Start to carry on.");
        pauseRef.current();
      });
      return true;
    },
    [expectReply, forgetTurn, openSession, stopMic],
  );

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (!sessionRef.current) {
        // Between connections, their words are kept and put to her as soon as the new one is open.
        if (statusRef.current !== "live") return false;
        pendingTextRef.current = trimmed;
        stopPlayback();
        studentInputRef.current?.();
        setHeard(trimmed);
        setActivity("thinking");
        return true;
      }
      // Typing over Ceeq cuts her off, like speaking over her.
      moveOn(true);
      stopPlayback();
      afterStudentRef.current = true;
      studentInputRef.current?.();
      setHeard(trimmed);
      setActivity("thinking");
      sessionRef.current.sendRealtimeInput({ text: trimmed });
      touch();
      return true;
    },
    [moveOn, setHeard, stopPlayback, touch],
  );

  /**
   * Tells Ceeq something from the app (e.g. a quiz result) without showing it
   * as the student's words. With `cut`, what she is saying now is dropped
   * first: the app is taking the lesson somewhere else.
   */
  const notify = useCallback(
    (text: string, cut = false) => {
      if (cut) stopPlayback();
      if (!sessionRef.current) {
        // Between connections, the prompt is kept and put to her as soon as the new one is open.
        if (statusRef.current !== "live") return false;
        pendingPromptRef.current = text;
        return true;
      }
      moveOn(false);
      sessionRef.current.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
      touch();
      return true;
    },
    [moveOn, stopPlayback, touch],
  );

  const end = useCallback(() => {
    teardown();
    setStatus("idle");
  }, [teardown]);

  /** Call from a click, before anything that makes it wait: browsers only let sound play that a click started. */
  const unlockSound = useCallback(() => {
    ensurePlayback();
  }, [ensurePlayback]);

  /** The student is doing something other than talking (answering the quiz, say): the lesson is not to be paused as idle. */
  const stillHere = useCallback(() => {
    if (statusRef.current === "live") touch();
  }, [touch]);

  useEffect(
    () => () => {
      generationRef.current++;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (parkTimerRef.current) clearTimeout(parkTimerRef.current);
      sessionRef.current?.close();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      void micCtxRef.current?.close();
      void playCtxRef.current?.close();
    },
    [],
  );

  return {
    status,
    activity,
    micOn,
    caption,
    heard,
    error,
    prepare,
    connect,
    reconnect,
    end,
    toggleMic,
    setHearing,
    sendText,
    notify,
    stillHere,
    unlockSound,
    getLevel,
    /** Whether a lesson is being connected right now (the status only says so after the next render). */
    isStarting: () => startingRef.current === generationRef.current,
    /** Whether speech for a turn is still arriving from Ceeq, for use outside render. */
    isMidTurn: () => midTurnRef.current,
    /** Whether Ceeq has been asked for something and has not yet begun to say it. */
    isOwed: () => owedSinceRef.current !== null,
    /** Whether the mic is picking up a voice just now (or a noise as loud as one). */
    isHearingVoice: () => micStreamRef.current !== null && Date.now() - loudAtRef.current < VOICE_HANG_MS,
    /** The last thing Ceeq said, for use outside render. */
    lastWords: () => captionRef.current,
    remainingMs,
    hold,
    release,
    park,
  };
}

function decodePcm(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
  return Float32Array.from(int16, (s) => s / 32768);
}

function rms(int16: Int16Array): number {
  let sum = 0;
  for (const s of int16) sum += (s / 32768) ** 2;
  return Math.sqrt(sum / (int16.length || 1));
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
