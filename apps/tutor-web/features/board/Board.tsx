"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardBlock, BoardState, CalloutTone } from "@codeeaq/shared-types";
import { Diagram, Graph, NumberLine } from "./Figures";
import { MathBlock, MathText } from "./MathText";
import { PictureCard } from "./PictureCard";
import { drawTimes, ROW_MS, startAt, writeMs } from "./reveal";
import { Flow, Labelled, Panels } from "./Scenes";

const CALLOUT: Record<CalloutTone, { label: string; className: string }> = {
  why: { label: "Why this matters", className: "border-accent bg-accent-soft" },
  tip: { label: "Tip", className: "border-(--ink-blue) bg-[color-mix(in_oklab,var(--ink-blue)_8%,transparent)]" },
  remember: { label: "Remember", className: "border-(--ink-amber) bg-[color-mix(in_oklab,var(--ink-amber)_10%,transparent)]" },
  example: { label: "Example", className: "border-(--ink-green) bg-[color-mix(in_oklab,var(--ink-green)_8%,transparent)]" },
  question: { label: "Your turn", className: "border-accent bg-accent-soft" },
};

/**
 * When each line of a block that grows a line at a time is written. Lines that
 * were on the board already (the first `kept`) have no moment: they stand as
 * they are, and the new ones follow one another from `at`.
 */
function lineTimes(lines: string[], kept: number, at: number): (number | undefined)[] {
  return lines.map((_, i) => (i < kept ? undefined : lines.slice(kept, i).reduce((t, line) => t + writeMs(line), at)));
}

/** One block, drawn from the moment `at` (see reveal.ts). `kept` is how many of its lines were there already. */
function Block({ block, at, kept }: { block: BoardBlock; at: number; kept: number }) {
  switch (block.kind) {
    case "heading":
      return (
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          <MathText text={block.text} at={at} />
        </h2>
      );
    case "text":
      return (
        <p className="text-base leading-relaxed sm:text-lg">
          <MathText text={block.text} at={at} />
        </p>
      );
    case "math":
      return <MathBlock latex={block.latex} at={at} />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      // Each item is written when the one before it is done; its bullet comes with its first word.
      const starts = lineTimes(block.items, kept, at);
      return (
        <Tag className={`space-y-1.5 pl-6 text-base leading-relaxed sm:text-lg ${block.ordered ? "list-decimal" : "list-disc"} marker:text-muted`}>
          {block.items.map((item, i) => (
            <li key={i} className={starts[i] === undefined ? undefined : "ink-fade"} style={starts[i] === undefined ? undefined : startAt(starts[i])}>
              <MathText text={item} at={starts[i]} />
            </li>
          ))}
        </Tag>
      );
    }
    case "notes": {
      // The card comes up once, with its first line; after that only the lines that are added are written.
      const starts = lineTimes(block.points, kept, kept ? at : at + 250);
      return (
        <div className={`rounded-xl border border-line bg-surface-2 px-4 py-3 ${kept ? "" : "ink-rise"}`} style={kept ? undefined : startAt(at)}>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
            </svg>
            {block.title ?? "Notes"}
          </div>
          <ul className="space-y-1.5 text-base leading-snug sm:text-lg">
            {block.points.map((point, i) => (
              <li key={i} className={`flex gap-2.5 ${starts[i] === undefined ? "" : "ink-fade"}`} style={starts[i] === undefined ? undefined : startAt(starts[i])}>
                <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span className="min-w-0">
                  <MathText text={point} at={starts[i]} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "callout": {
      const style = CALLOUT[block.tone];
      return (
        <div className={`ink-rise rounded-xl border-l-4 px-4 py-3 ${style.className}`} style={startAt(at)}>
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted">{style.label}</div>
          <div className="leading-relaxed">
            <MathText text={block.text} at={at + 250} />
          </div>
        </div>
      );
    }
    case "table":
      return (
        <div className="ink-rise overflow-x-auto rounded-xl border border-line" style={startAt(at)}>
          <table className="w-full text-left text-sm sm:text-base">
            <thead className="bg-surface-2">
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 font-semibold">
                    <MathText text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                // The rows are filled in one at a time.
                <tr key={r} className="ink-fade border-t border-line" style={startAt(at + 350 + r * ROW_MS)}>
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2">
                      <MathText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "number_line":
      return <NumberLine block={block} at={at} />;
    case "graph":
      return <Graph block={block} at={at} />;
    case "diagram":
      return <Diagram block={block} at={at} />;
    case "panels":
      return <Panels block={block} at={at} />;
    case "flow":
      return <Flow block={block} at={at} />;
    case "labelled":
      return <Labelled block={block} at={at} />;
  }
}

/**
 * A block as it stands on the board. Its moment is fixed when it is first put
 * there: the board is redrawn whenever anything on it changes, and what has
 * already been drawn must not start again.
 */
function Drawn({ block, at, kept }: { block: BoardBlock; at: number; kept: number }) {
  const [start] = useState(at);
  return <Block block={block} at={start} kept={kept} />;
}

/**
 * The whiteboard. Blocks are drawn one after another as they arrive; while the
 * lesson is `paused` the drawing stands still with Ceeq's voice.
 */
export function Board({ board, empty, paused = false }: { board: BoardState; empty: React.ReactNode; paused?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = board.blocks.at(-1)?.id;

  // Follow the newest writing, or the block Ceeq is pointing at.
  useEffect(() => {
    const target = board.highlight ? document.getElementById(`block-${board.highlight}`) : endRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lastId, board.blocks.length, board.highlight, board.picture?.born]);

  if (!board.blocks.length && !board.picture) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-muted">{empty}</div>;
  }

  const times = drawTimes(board);
  // A prepared picture stands below the board's first heading, or at the top if it has none.
  const pictureAt = board.blocks.findIndex((b) => b.kind === "heading") + 1;
  const picture = board.picture && <PictureCard key={`${board.picture.id}:${board.picture.born}`} picture={board.picture} paused={paused} />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8" data-board-paused={paused || undefined}>
      {pictureAt === 0 && picture}
      {board.blocks.map((block, i) => [
        <div
          // A block that is replaced gets a new key, and so is drawn afresh.
          key={`${block.id}:${board.born?.[block.id] ?? 0}`}
          id={`block-${block.id}`}
          className={`rounded-xl transition-shadow duration-300 ${
            board.highlight === block.id ? "shadow-[0_0_0_2px_var(--accent),0_0_0_8px_var(--accent-soft)]" : ""
          } ${block.kind === "heading" ? "" : "px-1"}`}
        >
          <Drawn block={block} at={times[block.id] ?? 0} kept={board.kept?.[block.id] ?? 0} />
        </div>,
        i + 1 === pictureAt && picture,
      ])}
      <div ref={endRef} />
    </div>
  );
}
