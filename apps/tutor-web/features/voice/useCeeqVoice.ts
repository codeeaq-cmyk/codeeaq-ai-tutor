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

export type VoiceStatus = "idle" | "connecting" | "live" | "paused" | "error";
export type VoiceActivity = "idle" | "listening" | "thinking" | "speaking";

export type ToolHandler = (name: string, args: Record<string, unknown>) => Record<string, unknown>;

interface Options {
  getToken: () => Promise<StartVoiceResponse>;
  onToolCall: ToolHandler;
}

const MIC_SAMPLE_RATE = 16000; // must match public/audio-processor.js
const PLAYBACK_SAMPLE_RATE = 24000; // Gemini Live's output audio rate
const TOKEN_TTL_MS = 8 * 60 * 1000; // tokens are minted for 10 minutes
const IDLE_PAUSE_MS = 4 * 60 * 1000; // pause after this long without the student
// While Ceeq speaks, mic chunks quieter than this are treated as her own echo.
const BARGE_IN_RMS = 0.045;

export function useCeeqVoice({ getToken, onToolCall }: Options) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [activity, setActivity] = useState<VoiceActivity>("idle");
  const [micOn, setMicOn] = useState(false);
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const generationRef = useRef(0);
  const toolRef = useRef(onToolCall);
  useEffect(() => {
    toolRef.current = onToolCall;
  }, [onToolCall]);

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
    if (playCtxRef.current.state === "suspended") void playCtxRef.current.resume();
    return playCtxRef.current;
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
    nextStartRef.current = playCtxRef.current?.currentTime ?? 0;
    setSpeaking(false);
  }, [setSpeaking]);

  const playChunk = useCallback(
    (b64: string) => {
      const ctx = ensurePlayback();
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
      const buffer = ctx.createBuffer(1, int16.length, PLAYBACK_SAMPLE_RATE);
      buffer.copyToChannel(Float32Array.from(int16, (s) => s / 32768), 0);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(outputRef.current!);
      const startAt = Math.max(ctx.currentTime, nextStartRef.current);
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
      }

      const heardDelta = content.inputTranscription?.text;
      if (heardDelta) {
        touch();
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
          setCaption("");
        }
        playChunk(part.inlineData.data);
      }

      const spokenDelta = content.outputTranscription?.text;
      if (spokenDelta) setCaption((prev) => prev + spokenDelta);

      if (content.turnComplete) {
        newTurnRef.current = true;
        setHeard("");
      }
    },
    [playChunk, stopPlayback, touch],
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
    sessionRef.current?.close();
    sessionRef.current = null;
    setActivity("idle");
    setHeard("");
  }, [stopMic, stopPlayback]);

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
      stopPlayback();
      newTurnRef.current = true;
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
