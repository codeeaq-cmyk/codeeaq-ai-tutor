"use client";

import { useEffect, useRef } from "react";
import type { BoardBlock, BoardState } from "@codeeaq/shared-types";
import { Diagram, Graph, NumberLine } from "./Figures";
import { ImageBlock } from "./ImageBlock";
import { MathBlock, MathText } from "./MathText";

const CALLOUT = {
  tip: { label: "Tip", className: "border-(--ink-blue) bg-[color-mix(in_oklab,var(--ink-blue)_8%,transparent)]" },
  remember: { label: "Remember", className: "border-(--ink-amber) bg-[color-mix(in_oklab,var(--ink-amber)_10%,transparent)]" },
  example: { label: "Example", className: "border-(--ink-green) bg-[color-mix(in_oklab,var(--ink-green)_8%,transparent)]" },
  question: { label: "Your turn", className: "border-accent bg-accent-soft" },
} as const;

function Block({ block }: { block: BoardBlock }) {
  switch (block.kind) {
    case "heading":
      return <h2 className="text-xl font-semibold tracking-tight sm:text-2xl"><MathText text={block.text} /></h2>;
    case "text":
      return <p className="text-base leading-relaxed sm:text-lg"><MathText text={block.text} /></p>;
    case "math":
      return <MathBlock latex={block.latex} />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={`space-y-1.5 pl-6 text-base leading-relaxed sm:text-lg ${block.ordered ? "list-decimal" : "list-disc"} marker:text-muted`}>
          {block.items.map((item, i) => (
            <li key={i}><MathText text={item} /></li>
          ))}
        </Tag>
      );
    }
    case "callout": {
      const style = CALLOUT[block.tone];
      return (
        <div className={`rounded-xl border-l-4 px-4 py-3 ${style.className}`}>
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted">{style.label}</div>
          <div className="leading-relaxed"><MathText text={block.text} /></div>
        </div>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm sm:text-base">
            <thead className="bg-surface-2">
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 font-semibold"><MathText text={h} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-line">
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2"><MathText text={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "number_line":
      return <NumberLine block={block} />;
    case "graph":
      return <Graph block={block} />;
    case "diagram":
      return <Diagram block={block} />;
    case "image":
      return <ImageBlock block={block} />;
  }
}

export function Board({ board, empty }: { board: BoardState; empty: React.ReactNode }) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = board.blocks.at(-1)?.id;

  // Follow the newest writing, or the block Ceeq is pointing at.
  useEffect(() => {
    const target = board.highlight ? document.getElementById(`block-${board.highlight}`) : endRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lastId, board.blocks.length, board.highlight]);

  if (!board.blocks.length) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-muted">{empty}</div>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6 sm:px-8 sm:py-8">
      {board.blocks.map((block) => (
        <div
          key={block.id}
          id={`block-${block.id}`}
          className={`block-in rounded-xl transition-shadow duration-300 ${
            board.highlight === block.id ? "shadow-[0_0_0_2px_var(--accent),0_0_0_8px_var(--accent-soft)]" : ""
          } ${block.kind === "heading" ? "" : "px-1"}`}
        >
          <Block block={block} />
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
