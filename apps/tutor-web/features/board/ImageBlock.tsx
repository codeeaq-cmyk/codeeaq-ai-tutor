"use client";

import { useEffect, useState } from "react";
import type { BoardBlock } from "@codeeaq/shared-types";
import { findImage, type FoundImage } from "@/lib/images";

type State = { status: "loading" } | { status: "found"; image: FoundImage } | { status: "none" };

/** A real photo or labelled diagram, found from the block's search phrase. */
export function ImageBlock({ block }: { block: Extract<BoardBlock, { kind: "image" }> }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void findImage(block.query).then((image) => {
      if (!cancelled) setState(image ? { status: "found", image } : { status: "none" });
    });
    return () => {
      cancelled = true;
    };
  }, [block.query]);

  // Nothing suitable: keep the caption so the board still says what Ceeq meant.
  if (state.status === "none") {
    return block.caption ? <p className="text-center text-sm text-muted">{block.caption}</p> : null;
  }

  const image = state.status === "found" ? state.image : null;
  return (
    <figure className="flex flex-col items-center gap-2">
      {image ? (
        // Remote images of unknown size from Wikimedia; next/image adds nothing here.
        // The width and height attributes reserve the picture's space before it
        // arrives, and the white backing keeps transparent diagrams readable in dark mode.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={block.caption ?? block.query}
          width={image.width}
          height={image.height}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setState({ status: "none" })}
          className={`h-auto max-h-104 w-auto max-w-full rounded-xl bg-white transition-opacity duration-300 sm:max-w-xl ${loaded ? "opacity-100" : "opacity-40"}`}
        />
      ) : (
        <div className="skeleton aspect-16/10 w-full max-w-xl rounded-xl" />
      )}
      <figcaption className="text-center text-sm text-muted">
        {block.caption}
        {image && (
          <>
            {block.caption ? " · " : ""}
            <a href={image.page} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-fg">
              Wikimedia
            </a>
          </>
        )}
      </figcaption>
    </figure>
  );
}
