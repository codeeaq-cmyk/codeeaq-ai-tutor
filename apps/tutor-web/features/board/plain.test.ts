import { describe, expect, it } from "vitest";
import { plain } from "./plain";

describe("plain", () => {
  it("leaves text without a formula as it is", () => {
    expect(plain("Product of Factors")).toBe("Product of Factors");
    expect(plain("Costs $5")).toBe("Costs $5");
  });

  it("writes powers, signs and symbols in plain characters", () => {
    expect(plain("$x^2 + 5x + 6 = 0$")).toBe("x² + 5x + 6 = 0");
    expect(plain("Multiply to give $6$ (since $1 \\times 6$)")).toBe("Multiply to give 6 (since 1 × 6)");
    expect(plain("$(x + 2)$")).toBe("(x + 2)");
    expect(plain("$2x^2 - 4x$")).toBe("2x² − 4x");
    expect(plain("$R = 5\\,\\Omega$")).toBe("R = 5 Ω");
    expect(plain("$\\angle A = 90^\\circ$")).toBe("∠ A = 90°");
    expect(plain("$10^{-3}$ and $a^n$")).toBe("10⁻³ and aⁿ");
  });

  it("writes fractions, roots and subscripts on one line", () => {
    expect(plain("$I = \\frac{Q}{t}$")).toBe("I = Q/t");
    expect(plain("$\\frac{a + b}{2}$")).toBe("(a + b)/2");
    expect(plain("$\\sqrt{16} = 4$")).toBe("√16 = 4");
    expect(plain("$\\sqrt{b^2 - 4ac}$")).toBe("√(b² − 4ac)");
    expect(plain("$H_2O$ and $R_{total}$")).toBe("H₂O and Rtotal");
    // A power that has no raised characters of its own keeps its caret.
    expect(plain("$x^{n+1}$ and $e^{kt}$ and $2^{x - y}$")).toBe("xⁿ⁺¹ and e^kt and 2^(x − y)");
  });

  it("drops what is only there to set the formula", () => {
    expect(plain("$\\text{speed} = \\frac{\\text{distance}}{\\text{time}}$")).toBe("speed = distance/time");
    expect(plain("$\\left( x + 1 \\right)$")).toBe("( x + 1 )");
  });
});
