import { describe, expect, it } from "vitest";
import { keywords, matches, score, type Candidate } from "./images";

const file = (title: string, extra: Partial<Candidate> = {}): Candidate => ({
  title: `File:${title}`,
  index: 0,
  width: 900,
  height: 700,
  mime: title.endsWith(".svg") ? "image/svg+xml" : "image/jpeg",
  ...extra,
});

describe("keywords", () => {
  it("keeps the subject and drops words about the kind of picture", () => {
    expect(keywords("Human heart diagram, labelled")).toEqual(["human", "heart"]);
    expect(keywords("photo of a honey bee")).toEqual(["honey", "bee"]);
  });
});

describe("matches", () => {
  it("counts whole words, plurals and compounds", () => {
    expect(matches("File:Scheme ant worker anatomy-en.svg", ["ant", "anatomy"])).toBe(2);
    expect(matches("File:Plant cells.jpg", ["plant", "cell"])).toBe(2);
    expect(matches("File:USGS WaterCycle English.png", ["water", "cycle"])).toBe(2);
    // "ant" must not match inside "plant" or "elephant".
    expect(matches("File:Plant and elephant.jpg", ["ant"])).toBe(0);
  });
});

describe("score", () => {
  const words = ["human", "heart"];

  it("prefers English or unmarked labels over other languages", () => {
    const english = score(file("Heart diagram-en.svg"), words, true, true);
    const plain = score(file("Diagram of the human heart (cropped).svg"), words, true, true);
    const persian = score(file("Heart diagram-fa.svg"), words, true, true);
    const italian = score(file("Diagram of the human heart (cropped)-it.png", { mime: "image/png" }), words, true, true);
    expect(plain).toBeGreaterThan(italian);
    expect(english).toBeGreaterThan(persian);
  });

  it("never shows adult content or interface art", () => {
    expect(score(file("Nude study of the human heart.jpg"), words, false, false)).toBeLessThan(0);
    expect(score(file("Commons-logo.svg"), words, true, true)).toBeLessThan(0);
    expect(score(file("OOjs UI icon edit-ltr.svg"), words, true, true)).toBeLessThan(0);
  });

  it("rejects off-subject results from open search", () => {
    expect(score(file("Imperial Coat of Arms of Austria.svg"), ["imperial", "legislative", "council", "chambers"], true, false)).toBeLessThan(0);
    expect(score(file("Sunset over a lake.jpg"), words, false, false)).toBeLessThan(0);
  });

  it("inside the right article, a diagram request needs a diagram or the subject", () => {
    expect(score(file("Portrait of a cardiologist.jpg"), words, true, true)).toBeLessThan(0);
    expect(score(file("Cardiac cycle diagram.svg"), words, true, true)).toBeGreaterThanOrEqual(0);
  });

  it("skips tiny files and unknown formats", () => {
    expect(score(file("Human heart.jpg", { width: 120 }), words, false, false)).toBeLessThan(0);
    expect(score(file("Human heart.tiff", { mime: "image/tiff" }), words, false, false)).toBeLessThan(0);
  });
});
