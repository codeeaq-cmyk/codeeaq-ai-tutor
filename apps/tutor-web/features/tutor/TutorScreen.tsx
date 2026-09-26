"use client";

import { useState, type FormEvent } from "react";
import type { CharacterState } from "@codeeaq/shared-types";
import { CeeqCharacter } from "@/features/character/CeeqCharacter";
import { Whiteboard } from "@/features/whiteboard/Whiteboard";
import { applyActions, type Shape } from "@/features/whiteboard/whiteboard-state";
import { sendMessage, startSession } from "./api";

// Until auth and lesson selection exist (Milestone 1), the demo uses fixed IDs.
const STUDENT_ID = "demo-student";
const LESSON_ID = "fractions_01";

export function TutorScreen() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [character, setCharacter] = useState<CharacterState>("idle");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tutorText, setTutorText] = useState("Hi! I'm Ceeq. What would you like to learn today?");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message) return;
    setInput("");
    setError(null);
    setCharacter("thinking");
    try {
      const id = sessionId ?? (await startSession(STUDENT_ID, LESSON_ID)).sessionId;
      setSessionId(id);
      const res = await sendMessage({ sessionId: id, studentId: STUDENT_ID, message, lessonId: LESSON_ID });
      setTutorText(res.message.text);
      setCharacter(res.character.state);
      setShapes((prev) => applyActions(prev, res.whiteboard.actions));
    } catch (err) {
      setCharacter("idle");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-4">
      <section className="flex justify-center rounded-2xl border border-slate-200 bg-white p-6">
        <CeeqCharacter state={character} />
      </section>

      <section className="aspect-[2/1] rounded-2xl border border-slate-200 bg-white p-2">
        <Whiteboard shapes={shapes} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-slate-800">
          <span className="font-semibold text-indigo-700">Ceeq: </span>
          {tutorText}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
          />
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white">
            Send
          </button>
          {/* Voice input arrives in Milestone 3. */}
          <button
            type="button"
            disabled
            title="Voice coming soon"
            className="rounded-lg border border-slate-300 px-4 py-2 text-slate-400"
          >
            🎤 Speak
          </button>
        </form>
      </section>
    </main>
  );
}
