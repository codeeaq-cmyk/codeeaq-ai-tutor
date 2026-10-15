import { useEffect, useState } from "react";
import type { BoardPicture } from "@codeeaq/shared-types";

/** How long each stage of a picture that builds up stays before the next is added. */
export const STAGE_MS = 2800;

/**
 * A prepared picture on the board: a figure like one in the textbook, drawn
 * and checked before the lesson. It is uncovered as if being drawn. One that
 * builds up shows its stages one after another, each fading in over the last,
 * and can be played again; it waits while the lesson is paused.
 */
export function PictureCard({ picture, paused }: { picture: BoardPicture; paused: boolean }) {
  const stages = [...(picture.frames ?? []), picture.src];
  const [stage, setStage] = useState(0);
  const last = stages.length - 1;

  useEffect(() => {
    if (paused || stage >= last) return;
    const timer = setTimeout(() => setStage((s) => s + 1), STAGE_MS);
    return () => clearTimeout(timer);
  }, [paused, stage, last]);

  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="ink-reveal relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-line">
        {stages.map((src, i) => (
          // A data: URL drawn for this lesson, which Next's image optimiser has nothing to do with.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={src}
            alt={i === last ? picture.alt : ""}
            aria-hidden={i === last ? undefined : true}
            className={`${i === 0 ? "relative" : "absolute inset-0"} block h-auto w-full transition-opacity duration-700 ${i <= stage ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      </div>
      <figcaption className="flex items-center gap-3 text-sm text-muted">
        <span className="font-medium text-fg">{picture.title}</span>
        {last > 0 &&
          (stage < last ? (
            <span className="tabular-nums">
              Stage {stage + 1} of {stages.length}
            </span>
          ) : (
            <button type="button" onClick={() => setStage(0)} className="rounded-lg px-2 py-0.5 font-medium text-accent hover:bg-surface-2">
              Play again
            </button>
          ))}
      </figcaption>
    </figure>
  );
}
