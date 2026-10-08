"use client";

// Ceeq's voice, built on cqwebsite's useVoiceAssistant: the createVoiceSession
// function mints a one-use Gemini Live token and the browser streams audio
// straight to Google with it.
//
// Hands-free: once started, the mic stays open and Gemini's own voice
// activity detection decides when the student has finished, so there is no
// button to hold. Talking over Ceeq interrupts her. Tool calls from the model
// (whiteboard, lesson plan, progress) are answered immediately in the browser.

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";
import type { StartVoiceResponse } from "@codeeaq/shared-types";
import { TimeStretcher } from "./timeStretch";

export type VoiceStatus = "idle" | "connecting" | "live" | "paused" | "error";
export type VoiceActivity = "idle" | "listening" | "thinking" | "speaking";

export type ToolHandler = (name: string, args: Record<string, unknown>) => Record<string, unknown>;

interface Options {
  getToken: () => Promise<StartVoiceResponse>;
  onToolCall: ToolHandler;
  /** How fast Ceeq's voice plays: 1 is as the model speaks, 0.85 is 15% slower. */
  speed: number;
  /**
   * Ceeq has finished producing a turn. `remainingMs` is how much of it the
   * student has yet to hear (slowed speech plays for longer than it takes to
   * arrive). `afterStudent` is true when the turn answered something the
   * student said or typed.
   */
  onTurnEnd?: (info: { afterStudent: boolean; remainingMs: number }) => void;
  /** The student started speaking or sent a typed message. */
  onStudentInput?: () => void;
}

const MIC_SAMPLE_RATE = 16000; // must match public/audio-processor.js
const PLAYBACK_SAMPLE_RATE = 24000; // Gemini Live's output audio rate
const TOKEN_TTL_MS = 8 * 60 * 1000; // tokens are minted for 10 minutes
const IDLE_PAUSE_MS = 4 * 60 * 1000; // pause after this long without the student
/** The pause left between one of Ceeq's turns and the next when they follow straight on. */
const BREATH_SECONDS = 0.7;
// While Ceeq speaks, mic chunks quieter than this are treated as her own echo.
const BARGE_IN_RMS = 0.045;

export function useCeeqVoice({ getToken, onToolCall, speed, onTurnEnd, onStudentInput }: Options) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [activity, setActivity] = useState<VoiceActivity>("idle");
  const [micOn, setMicOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const generationRef = useRef(0);
  const toolRef = useRef(onToolCall);
  const turnEndRef = useRef(onTurnEnd);
  const studentInputRef = useRef(onStudentInput);
  useEffect(() => {
    toolRef.current = onToolCall;
    turnEndRef.current = onTurnEnd;
    studentInputRef.current = onStudentInput;
  }, [onToolCall, onTurnEnd, onStudentInput]);

  // ---------- End of Ceeq's turn ----------
  //
  // The service says a turn is complete at about the moment its audio would
  // finish at normal speed. Slowed audio is still playing then, so the caller
  // is told how much is left and can time what happens next around it.

  /** Audio for a turn has started arriving and the service has not yet said the turn is complete. */
  const midTurnRef = useRef(false);
  /** The current turn was cut short by the student, so its "complete" signal does not count. */
  const interruptedRef = useRef(false);
  /** The student said or typed something since Ceeq's last finished turn. */
  const afterStudentRef = useRef(false);

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

  /** Freezes Ceeq's voice exactly where it is. Nothing is lost: it carries on from there. */
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

  // The voice model speaks at about 155 words a minute whatever it is told,
  // so its audio is stretched in time (pitch unchanged) to the chosen pace.
  const stretcherRef = useRef<TimeStretcher | null>(null);
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
    stretcherRef.current?.setSpeed(speed);
  }, [speed]);
  const getStretcher = useCallback(() => (stretcherRef.current ??= new TimeStretcher(PLAYBACK_SAMPLE_RATE, speedRef.current)), []);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    });
    sourcesRef.current = [];
    midTurnRef.current = false;
    stretcherRef.current?.reset();
    nextStartRef.current = playCtxRef.current?.currentTime ?? 0;
    setSpeaking(false);
  }, [setSpeaking]);

  /** Queues audio to play right after whatever is already queued. */
  const schedule = useCallback(
    (samples: Float32Array) => {
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

  const playChunk = useCallback(
    (b64: string) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
      schedule(getStretcher().process(Float32Array.from(int16, (s) => s / 32768)));
    },
    [getStretcher, schedule],
  );

  /** Plays out the last few milliseconds the stretcher was holding back. */
  const finishUtterance = useCallback(() => {
    if (stretcherRef.current) schedule(stretcherRef.current.flush());
  }, [schedule]);

  // ---------- Idle pause ----------

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseRef = useRef<() => void>(() => {});
  const touch = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => pauseRef.current(), IDLE_PAUSE_MS);
  }, []);

  // ---------- Server messages ----------

  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback(
    (message: LiveServerMessage) => {
      const calls = message.toolCall?.functionCalls;
      if (calls?.length) {
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
      }

      const content = message.serverContent;
      if (!content) return;

      if (content.interrupted) {
        stopPlayback();
        newTurnRef.current = true;
        interruptedRef.current = true;
      }

      const heardDelta = content.inputTranscription?.text;
      if (heardDelta) {
        touch();
        afterStudentRef.current = true;
        studentInputRef.current?.();
        setHeard((prev) => prev + heardDelta);
        if (!speakingRef.current) setActivity("listening");
        // Once the student's words stop arriving, Ceeq is working on a reply.
        if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = setTimeout(() => {
          if (!speakingRef.current) setActivity("thinking");
        }, 700);
      }

      for (const part of content.modelTurn?.parts ?? []) {
        if (!part.inlineData?.data) continue;
        if (newTurnRef.current) {
          newTurnRef.current = false;
          interruptedRef.current = false;
          midTurnRef.current = true;
          breathRef.current = true;
          setCaption("");
        }
        playChunk(part.inlineData.data);
      }

      const spokenDelta = content.outputTranscription?.text;
      if (spokenDelta) setCaption((prev) => prev + spokenDelta);

      if (content.turnComplete) {
        finishUtterance();
        newTurnRef.current = true;
        setHeard("");
        midTurnRef.current = false;
        if (interruptedRef.current) {
          // The student cut this turn short; Ceeq's reply to them is the turn that counts.
          interruptedRef.current = false;
        } else {
          const afterStudent = afterStudentRef.current;
          afterStudentRef.current = false;
          turnEndRef.current?.({ afterStudent, remainingMs: remainingMs() });
        }
      }
    },
    [finishUtterance, playChunk, remainingMs, stopPlayback, touch],
  );

  // ---------- Mic (hands-free) ----------

  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micNodeRef = useRef<AudioWorkletNode | null>(null);

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
        // Echo gate: while Ceeq talks, only clearly louder speech gets through.
        if (speakingRef.current && rms(int16) < BARGE_IN_RMS) return;
        session.sendRealtimeInput({
          audio: { data: int16ToBase64(int16), mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}` },
        });
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

  const toggleMic = useCallback(() => {
    if (micStreamRef.current) stopMic();
    else void startMic();
  }, [startMic, stopMic]);

  // ---------- Connection ----------

  const teardown = useCallback(() => {
    generationRef.current++;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    stopMic();
    stopPlayback();
    releasePlayback();
    interruptedRef.current = false;
    afterStudentRef.current = false;
    sessionRef.current?.close();
    sessionRef.current = null;
    setActivity("idle");
    setHeard("");
  }, [releasePlayback, stopMic, stopPlayback]);

  const pause = useCallback(() => {
    teardown();
    setStatus("paused");
  }, [teardown]);

  useEffect(() => {
    pauseRef.current = pause;
  }, [pause]);

  /** Starts a live lesson. `opening` tells Ceeq where to begin. Call from a click. */
  const connect = useCallback(
    async (opening: string) => {
      if (sessionRef.current) return;
      const generation = ++generationRef.current;
      const stale = () => generation !== generationRef.current;
      ensurePlayback(); // must happen inside the click for browsers to allow sound
      setStatus("connecting");
      setError(null);
      setCaption("");

      try {
        const { token, model } = await takeToken();
        if (stale()) return;
        const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
        const session = await ai.live.connect({
          model,
          callbacks: {
            onmessage: (message) => {
              if (!stale()) handleMessage(message);
            },
            onerror: (e) => {
              if (stale()) return;
              console.error("Voice error:", e);
              setError("Ceeq's connection dropped.");
            },
            onclose: () => {
              if (stale()) return;
              teardown();
              setStatus("paused");
            },
          },
        });
        if (stale()) {
          session.close();
          return;
        }
        sessionRef.current = session;
        setStatus("live");
        newTurnRef.current = true;
        session.sendClientContent({ turns: [{ role: "user", parts: [{ text: opening }] }], turnComplete: true });
        touch();
        void startMic();
        prepare(); // ready for a quick resume later
      } catch (err) {
        if (stale()) return;
        console.error("Voice connection failed:", err);
        setError(err instanceof Error ? err.message : "Could not start Ceeq's voice.");
        setStatus("error");
      }
    },
    [ensurePlayback, handleMessage, prepare, startMic, takeToken, teardown, touch],
  );

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!sessionRef.current || !trimmed) return false;
      // Typing over Ceeq cuts her off, like speaking over her. If her turn was
      // still under way, its "complete" signal is yet to come and must not count.
      interruptedRef.current = midTurnRef.current;
      stopPlayback();
      newTurnRef.current = true;
      afterStudentRef.current = true;
      studentInputRef.current?.();
      setHeard(trimmed);
      setActivity("thinking");
      sessionRef.current.sendRealtimeInput({ text: trimmed });
      touch();
      return true;
    },
    [stopPlayback, touch],
  );

  /** Tells Ceeq something from the app (e.g. a quiz result) without showing it as the student's words. */
  const notify = useCallback(
    (text: string) => {
      if (!sessionRef.current) return false;
      newTurnRef.current = true;
      sessionRef.current.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
      touch();
      return true;
    },
    [touch],
  );

  const end = useCallback(() => {
    teardown();
    setStatus("idle");
  }, [teardown]);

  useEffect(
    () => () => {
      generationRef.current++;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
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
    end,
    toggleMic,
    sendText,
    notify,
    getLevel,
    /** Whether a turn is still arriving from Ceeq, for use outside render. */
    isMidTurn: () => midTurnRef.current,
    remainingMs,
    holdPlayback,
    releasePlayback,
  };
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
