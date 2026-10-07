import { memo } from "react";
import katex from "katex";
import "katex/contrib/mhchem";

// KaTeX with `trust: false` refuses links, raw HTML and styling commands, and
// escapes all text, so model-written LaTeX can't inject markup.
function renderLatex(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { displayMode, throwOnError: false, trust: false, strict: "ignore" });
}

/** A standalone formula. */
export const MathBlock = memo(function MathBlock({ latex }: { latex: string }) {
  return (
    <div
      className="overflow-x-auto py-1 text-lg"
      // Safe: KaTeX output with trust disabled (see above).
      dangerouslySetInnerHTML={{ __html: renderLatex(latex, true) }}
    />
  );
});

/** Text with inline maths between $...$. */
export const MathText = memo(function MathText({ text }: { text: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith("$") && part.endsWith("$") ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: renderLatex(part.slice(1, -1), false) }} />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
});
