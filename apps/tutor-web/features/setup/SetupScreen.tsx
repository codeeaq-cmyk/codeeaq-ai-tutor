"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BOARDS,
  CLASS_LEVELS,
  LANGUAGES,
  needsStream,
  parseProfile,
  STREAMS,
  type BoardId,
  type ClassLevel,
  type LanguageId,
  type StreamId,
} from "@codeeaq/shared-types";
import { Chip, PrimaryButton, Wordmark } from "@/features/ui";
import { saveProfile, useProfile } from "@/lib/profile";
import { useHydrated } from "@/lib/storage";

export function SetupScreen({ editing }: { editing: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const saved = useProfile();

  // Returning students go straight to their subjects.
  useEffect(() => {
    if (hydrated && saved && !editing) router.replace("/learn");
  }, [hydrated, saved, editing, router]);

  if (!hydrated || (saved && !editing)) return null;
  return <SetupForm key={saved ? "edit" : "new"} initial={saved} onDone={() => router.push("/learn")} />;
}

function SetupForm({
  initial,
  onDone,
}: {
  initial?: { board: BoardId; classLevel: ClassLevel; stream?: StreamId; language: LanguageId };
  onDone: () => void;
}) {
  const [board, setBoard] = useState<BoardId>(initial?.board ?? "cbse");
  const [classLevel, setClassLevel] = useState<ClassLevel | null>(initial?.classLevel ?? null);
  const [stream, setStream] = useState<StreamId | undefined>(initial?.stream);
  const [language, setLanguage] = useState<LanguageId>(initial?.language ?? "en");

  const profile = parseProfile({ board, classLevel, stream, language });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-6 sm:py-10">
      <Wordmark href="/" />
      <div className="mt-10 sm:mt-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Learn every chapter, out loud.</h1>
        <p className="mt-2 text-lg text-muted">Tell Ceeq what you study. Your whole syllabus appears, ready to learn.</p>
      </div>

      <div className="mt-10 flex flex-col gap-8">
        <Field label="Board">
          {BOARDS.map((b) => (
            <Chip key={b.id} selected={board === b.id} onClick={() => setBoard(b.id)}>
              {b.name}
            </Chip>
          ))}
        </Field>

        <Field label="Class">
          <div className="grid w-full grid-cols-6 gap-2 sm:grid-cols-12">
            {CLASS_LEVELS.map((c) => (
              <Chip key={c} selected={classLevel === c} onClick={() => setClassLevel(c)} className="px-0">
                {c}
              </Chip>
            ))}
          </div>
        </Field>

        {classLevel !== null && needsStream(classLevel) && (
          <Field label="Stream">
            {STREAMS.map((s) => (
              <Chip key={s.id} selected={stream === s.id} onClick={() => setStream(s.id)}>
                {s.name}
              </Chip>
            ))}
          </Field>
        )}

        <Field label="Ceeq speaks">
          {LANGUAGES.map((l) => (
            <Chip key={l.id} selected={language === l.id} onClick={() => setLanguage(l.id)}>
              {l.name}
            </Chip>
          ))}
        </Field>
      </div>

      <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-bg from-60% pt-8 pb-2">
        <PrimaryButton
          className="w-full text-lg"
          disabled={!profile}
          onClick={() => {
            if (!profile) return;
            saveProfile(profile);
            onDone();
          }}
        >
          Show my syllabus
        </PrimaryButton>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted">{label}</h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}
