// The words inside a figure are set by SVG, which cannot set a formula. What
// Ceeq writes between $...$ there is turned into the plain characters that
// come closest to it: x² for x^2, × for \times, a/b for a fraction.

const RAISED: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ" };
const LOWERED: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };
const SYMBOLS: Record<string, string> = {
  times: "×", div: "÷", cdot: "·", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈",
  to: "→", rightarrow: "→", longrightarrow: "→", Rightarrow: "⇒", leftarrow: "←", rightleftharpoons: "⇌",
  degree: "°", circ: "°", angle: "∠", triangle: "△", infty: "∞", therefore: "∴", parallel: "∥", perp: "⊥",
  pi: "π", theta: "θ", alpha: "α", beta: "β", gamma: "γ", lambda: "λ", mu: "μ", rho: "ρ", sigma: "σ", omega: "ω", phi: "φ",
  Omega: "Ω", Delta: "Δ", Sigma: "Σ", quad: " ", qquad: " ", left: "", right: "",
};

/** Every character of `text` from `set`, or nothing if one of them is not in it. */
const all = (text: string, set: Record<string, string>) => (/^./.test(text) && [...text].every((c) => c in set) ? [...text].map((c) => set[c]).join("") : null);
/** More than one thing, which has to be held together when written on one line. */
const held = (text: string) => (/[\s+\-−×÷/]/.test(text.trim()) ? `(${text.trim()})` : text.trim());

function formula(latex: string): string {
  let s = latex;
  // From the inside out, until nothing with braces of its own is left.
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s
      .replace(/\\(?:text|mathrm|mathbf|mathit|textbf|ce)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a: string, b: string) => `${held(a)}/${held(b)}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, a: string) => `√${held(a)}`)
      .replace(/\^\s*(?:\{\s*\\circ\s*\}|\\circ)/g, "°")
      .replace(/\^\s*(?:\{([^{}]*)\}|([^\s{}\\]))/g, (_, a?: string, b?: string) => all((a ?? b ?? "").trim(), RAISED) ?? `^${held(a ?? b ?? "")}`)
      .replace(/_\s*(?:\{([^{}]*)\}|([^\s{}\\]))/g, (_, a?: string, b?: string) => all((a ?? b ?? "").trim(), LOWERED) ?? (a ?? b ?? "").trim());
    if (s === before) break;
  }
  return s
    .replace(/\\\\|\\[,;:! ]|&/g, " ")
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/[{}]/g, "")
    .replace(/-/g, "−");
}

/** Text for a figure: its formulas in plain characters, the rest as it was. */
export function plain(text: string): string {
  if (!text.includes("$")) return text;
  return text
    .split(/(\$[^$]+\$)/g)
    .map((part) => (part.length > 2 && part.startsWith("$") && part.endsWith("$") ? formula(part.slice(1, -1)) : part))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
