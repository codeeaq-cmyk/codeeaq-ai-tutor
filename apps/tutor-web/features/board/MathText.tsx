import { memo } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import { startAt, WORD_MS } from "./reveal";

// KaTeX with `trust: false` refuses links, raw HTML and styling commands, and
// escapes all text, so model-written LaTeX can't inject markup.
function renderLatex(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { displayMode, throwOnError: false, trust: false, strict: "ignore" });
}

/** A standalone formula. With `at`, it comes up at that moment (see reveal.ts). */
export const MathBlock = memo(function MathBlock({ latex, at }: { latex: string; at?: number }) {
  return (
    <div
      className={`overflow-x-auto py-1 text-lg ${at === undefined ? "" : "ink-rise"}`}
      style={at === undefined ? undefined : startAt(at)}
      // Safe: KaTeX output with trust disabled (see above).
      dangerouslySetInnerHTML={{ __html: renderLatex(latex, true) }}
    />
  );
});

/** A piece of text as it is written: a word, a formula (which counts as one word) or the space between two. */
interface Piece {
  text: string;
  kind: "word" | "math" | "space";
  /** How many words come before it. */
  nth: number;
}

function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let words = 0;
  for (const part of text.split(/(\$[^$]+\$)/g)) {
    if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) out.push({ text: part.slice(1, -1), kind: "math", nth: words++ });
    // Spaces stay as they are between the words, so lines break where they would anyway.
    else for (const bit of part.split(/(\s+)/)) if (bit) out.push(bit.trim() ? { text: bit, kind: "word", nth: words++ } : { text: bit, kind: "space", nth: words });
  }
  return out;
}

/**
 * Text with inline maths between $...$. With `at`, it is written out word by
 * word from that moment; without, it is simply there.
 */
export const MathText = memo(function MathText({ text, at }: { text: string; at?: number }) {
  const ink = at === undefined ? undefined : "ink-word";
  return (
    <>
      {pieces(text).map((piece, i) => {
        if (piece.kind === "space") return piece.text;
        const style = at === undefined ? undefined : startAt(at + piece.nth * WORD_MS);
        return piece.kind === "math" ? (
          <span key={i} className={ink} style={style} dangerouslySetInnerHTML={{ __html: renderLatex(piece.text, false) }} />
        ) : (
          <span key={i} className={ink} style={style}>
            {piece.text}
          </span>
        );
      })}
    </>
  );
});
