import { describe, expect, it } from "vitest";
import { SecondTake } from "./secondTake";

/** Feeds a sentence through as the voice service does: a little audio, then its words. */
function say(take: SecondTake<string>, sentence: string, label: string) {
  const played: string[] = [];
  let shown = "";
  sentence.split(" ").forEach((word, i) => {
    played.push(...take.audio(`${label}${i}`));
    const out = take.text(`${word} `);
    played.push(...out.play);
    shown += out.show;
  });
  return { played, shown: shown.trim() };
}

const PARAGRAPH = "Welcome back. We are going to revise electric current today. Think about water flowing through a pipe.";

describe("SecondTake", () => {
  it("plays a turn as it arrives when tools come first", () => {
    const take = new SecondTake<string>();
    take.toolCall();
    const { played, shown } = say(take, PARAGRAPH, "a");
    expect(played).toHaveLength(PARAGRAPH.split(" ").length);
    expect(shown).toBe(PARAGRAPH);
    expect(take.endTurn()).toEqual({ show: "", play: [] });
  });

  it("drops the paragraph when she says it again after a late tool call", () => {
    const take = new SecondTake<string>();
    const first = say(take, PARAGRAPH, "a");
    take.toolCall();
    const second = say(take, PARAGRAPH, "b");
    expect(first.shown).toBe(PARAGRAPH);
    expect(second).toEqual({ played: [], shown: "" });
    expect(take.endTurn()).toEqual({ show: "", play: [] });
  });

  it("still catches it when the transcript opens with a stray word, or is punctuated differently", () => {
    const stray = new SecondTake<string>();
    say(stray, `text ${PARAGRAPH}`, "a");
    stray.toolCall();
    expect(say(stray, PARAGRAPH, "b").played).toEqual([]);

    const punctuated = new SecondTake<string>();
    say(punctuated, PARAGRAPH, "a");
    punctuated.toolCall();
    expect(say(punctuated, "Welcome back! We are going to revise electric current today.", "b").played).toEqual([]);
  });

  it("plays what follows a late tool call when it is something new, in order and without loss", () => {
    const take = new SecondTake<string>();
    say(take, "Let me put that on the board for you.", "a");
    take.toolCall();
    const next = "Now look at the picture. The charges move along the wire from one end to the other.";
    const { played, shown } = say(take, next, "b");
    expect(shown).toBe(next);
    expect(played).toEqual(next.split(" ").map((_, i) => `b${i}`));
    expect(take.holding).toBe(false);
  });

  it("lets a few held words through when the turn ends before there is enough to judge", () => {
    const take = new SecondTake<string>();
    say(take, PARAGRAPH, "a");
    take.toolCall();
    expect(say(take, "Shall we begin?", "b").played).toEqual([]);
    expect(take.holding).toBe(true);
    const end = take.endTurn();
    expect(end.show.trim()).toBe("Shall we begin?");
    expect(end.play).toEqual(["b0", "b1", "b2"]);
  });

  it("starts each turn afresh", () => {
    const take = new SecondTake<string>();
    say(take, PARAGRAPH, "a");
    take.toolCall();
    say(take, PARAGRAPH, "b");
    take.endTurn();
    // Next turn: tools first, then the very same words (a student asked her to repeat it).
    take.toolCall();
    expect(say(take, PARAGRAPH, "c").shown).toBe(PARAGRAPH);
  });

  it("can be told to let held speech through", () => {
    const take = new SecondTake<string>();
    say(take, PARAGRAPH, "a");
    take.toolCall();
    take.audio("b0");
    expect(take.release()).toEqual({ show: "", play: ["b0"] });
    expect(take.audio("b1")).toEqual(["b1"]);
  });
});
