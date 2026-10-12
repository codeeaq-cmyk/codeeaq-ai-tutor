"use client";

import Link from "next/link";
import { useState } from "react";
import { dayLabel, reasonFor, type ModuleToRevise } from "@/lib/revise";

/** How many modules are listed before the rest is folded away. */
const SHOWN = 3;

/**
 * The student's reminder of what to revise: the topics that slipped in
 * practice or in a quiz, by module, each a tap away from going over it with
 * Ceeq. Topics already revised wait here for their check on a later day.
 */
export function ToRevise({ modules, now }: { modules: ModuleToRevise[]; now: number }) {
  const [all, setAll] = useState(false);
  const due = modules.filter((m) => m.due.length);
  const waiting = modules.flatMap((m) => m.later);
  if (!due.length && !waiting.length) return null;

  const topics = due.reduce((n, m) => n + m.due.length, 0);
  const nextCheck = waiting.length ? Math.min(...waiting.map((g) => g.spot.dueAt)) : 0;
  const comingUp = waiting.length
    ? `Ceeq will check ${waiting.length === 1 ? "1 topic" : `${waiting.length} topics`} you revised${waiting.length === 1 ? "" : ", the first"} ${dayLabel(nextCheck, now)}.`
    : null;

  if (!due.length) {
    return (
      <section aria-label="To revise" className="mt-2 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-sm text-muted">
        <span className="h-2 w-2 shrink-0 rounded-full bg-(--ink-green)" aria-hidden />
        <p>Nothing to revise today. {comingUp}</p>
      </section>
    );
  }

  const shown = all ? due : due.slice(0, SHOWN);
  return (
    <section aria-label="To revise" className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="px-4 pt-4 pb-3">
        <h2 className="font-semibold">
          To revise <span className="font-normal text-muted">· {topics === 1 ? "1 topic" : `${topics} topics`}</span>
        </h2>
        <p className="mt-0.5 text-sm text-muted">These slipped in practice or a quiz. Ceeq will teach them again and check you’ve got them.</p>
      </div>
      <ul>
        {shown.map((m) => (
          <li key={m.id} className="border-t border-line">
            <Link href={m.href} className="flex items-start gap-3.5 px-4 py-3.5 hover:bg-surface-2">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-(--ink-amber)" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-muted">{m.subject} · {m.chapter}</span>
                <span className="block font-medium">{m.module.title}</span>
                <span className="mt-1 block space-y-0.5 text-sm text-muted">
                  {m.due.map((g) => (
                    <span key={g.index} className="block">
                      {m.module.goals[g.index]}
                      <span className="text-(--ink-amber)"> · {reasonFor(g)}</span>
                    </span>
                  ))}
                </span>
              </span>
              <span className="mt-1 shrink-0 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-accent-fg">Revise</span>
            </Link>
          </li>
        ))}
      </ul>
      {due.length > SHOWN && (
        <button onClick={() => setAll((a) => !a)} className="w-full border-t border-line px-4 py-2.5 text-left text-sm font-medium text-accent hover:bg-surface-2">
          {all ? "Show fewer" : `Show ${due.length - SHOWN} more`}
        </button>
      )}
      {comingUp && <p className="border-t border-line px-4 py-2.5 text-sm text-muted">{comingUp}</p>}
    </section>
  );
}
