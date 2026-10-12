import { describe, expect, it } from "vitest";
import { endsSentence, isWholeParagraph, pauseNear, TurnSpeech } from "./turnSpeech";

const PARAGRAPH =
  "Welcome back. We are going to revise electric current today. Think about water flowing through a pipe. " +
  "Electric current is like that: it is how much charge flows past a point every second. We measure it in amperes.";
const QUESTION = "That is right, well done. Now tell me, in your own words, what is electric current?";

/** Feeds text through as the voice service does: half a second of speech, then its word. */
function say(turn: TurnSpeech<string>, text: string, label: string) {
  const played: string[] = [];
  let over: { at: number | null } | undefined;
  text.split(" ").forEach((word, i) => {
    const heard = turn.audio(`${label}${i}`, 0.5);
    played.push(...heard.play);
    const read = turn.text(`${word} `);
    over ??= heard.over ?? read.over;
  });
  return { played, over };
}

describe("endsSentence", () => {
  it("tells speech that stopped mid-sentence from speech that finished one", () => {
    expect(endsSentence("Perfect calculation! You have")).toBe(false);
    expect(endsSentence("Perfect calculation!")).toBe(true);
    expect(endsSentence('She called it "current." ')).toBe(true);
    expect(endsSentence("")).toBe(false);
  });
});

describe("isWholeParagraph", () => {
  it("takes a full paragraph, or a question of some length, as whole", () => {
    expect(isWholeParagraph(PARAGRAPH)).toBe(true);
    expect(isWholeParagraph(QUESTION)).toBe(true);
    expect(isWholeParagraph(`${PARAGRAPH} `)).toBe(true);
  });

  it("does not take a few opening words, an unfinished sentence or a passing question as whole", () => {
    expect(isWholeParagraph("Let me put that on the board for you.")).toBe(false);
    expect(isWholeParagraph("So what is actually moving in the wire?")).toBe(false);
    expect(isWholeParagraph(PARAGRAPH.replace(/\.$/, " and"))).toBe(false);
    expect(isWholeParagraph("")).toBe(false);
  });
});

describe("TurnSpeech", () => {
  it("plays a turn as it arrives when the tools come first", () => {
    const turn = new TurnSpeech<string>();
    expect(turn.toolCall()).toEqual({ play: [] });
    const { played, over } = say(turn, PARAGRAPH, "a");
    expect(played).toHaveLength(PARAGRAPH.split(" ").length);
    expect(over).toBeUndefined();
    expect(turn.caption.trim()).toBe(PARAGRAPH);
    expect(turn.spoken).toBe(true);
  });

  it("ends the turn's speech at a tool call that follows a whole paragraph", () => {
    const turn = new TurnSpeech<string>();
    say(turn, PARAGRAPH, "a");
    expect(turn.toolCall()).toEqual({ play: [], over: { at: null } });
    // Whether she now repeats herself or says she will start afresh, none of it is heard.
    expect(say(turn, PARAGRAPH, "b").played).toEqual([]);
    expect(say(turn, "Wait, I made a mistake there, let us start fresh.", "c").played).toEqual([]);
    expect(turn.caption.trim()).toBe(PARAGRAPH);
    expect(turn.over).toBe(true);
  });

  it("ends it too when the paragraph's last words reach the transcript just after the tool call", () => {
    const turn = new TurnSpeech<string>();
    const words = QUESTION.split(" ");
    say(turn, words.slice(0, -2).join(" "), "a");
    expect(turn.toolCall()).toEqual({ play: [] });
    expect(turn.text(`${words.at(-2)} `)).toEqual({ play: [] });
    expect(turn.text(`${words.at(-1)} `)).toEqual({ play: [], over: { at: null } });
    expect(turn.audio("late", 0.5)).toEqual({ play: [] });
  });

  it("carries on after a tool call that follows only a few words", () => {
    const turn = new TurnSpeech<string>();
    say(turn, "Let me put that on the board for you.", "a");
    expect(turn.toolCall()).toEqual({ play: [] });
    const rest = say(turn, PARAGRAPH, "b");
    expect(rest.played).toHaveLength(PARAGRAPH.split(" ").length);
    expect(rest.over).toBeUndefined();
    // A later tool call, now that the paragraph is whole, does end it.
    expect(turn.toolCall().over).toEqual({ at: null });
  });

  it("cuts a paragraph that comes round again in one go, where the repeat begins", () => {
    const turn = new TurnSpeech<string>();
    const count = PARAGRAPH.split(" ").length;
    const first = say(turn, PARAGRAPH, "a");
    expect(first.over).toBeUndefined();
    const second = say(turn, PARAGRAPH, "b");
    // Noticed once eight words have come round; the cut is put back where the first telling ended.
    expect(second.over).toEqual({ at: count * 0.5 });
    expect(second.played).toHaveLength(8);
    expect(turn.caption).toBe(PARAGRAPH);
    expect(turn.audio("more", 0.5)).toEqual({ play: [] });
  });

  it("still notices the repeat when the transcript opens with a stray word", () => {
    const turn = new TurnSpeech<string>();
    say(turn, `text ${PARAGRAPH}`, "a");
    expect(say(turn, PARAGRAPH, "b").over).toBeDefined();
    expect(turn.caption).toBe(`text ${PARAGRAPH}`);
  });

  it("does not mistake a phrase said twice for the paragraph starting over", () => {
    const turn = new TurnSpeech<string>();
    const text = `${PARAGRAPH} So remember: we are going to revise electric current again tomorrow, and then practise.`;
    expect(say(turn, text, "a").over).toBeUndefined();
    expect(turn.over).toBe(false);
  });

  it("starts each turn afresh", () => {
    const turn = new TurnSpeech<string>();
    say(turn, PARAGRAPH, "a");
    turn.toolCall();
    turn.endTurn();
    expect(turn.spoken).toBe(false);
    expect(turn.caption).toBe("");
    // Next turn: tools first, then the very same words (the student asked to hear it again).
    turn.toolCall();
    expect(say(turn, PARAGRAPH, "c").played).toHaveLength(PARAGRAPH.split(" ").length);
  });
});

describe("pauseNear", () => {
  const FRAME = 0.02;
  /** Speech at a steady level with silences at the given [start, end] seconds. */
  const speech = (seconds: number, pauses: [number, number][]) =>
    Array.from({ length: Math.round(seconds / FRAME) }, (_, i) => (pauses.some(([a, b]) => i * FRAME >= a && i * FRAME < b) ? 0.001 : 0.1));

  it("finds the middle of the pause nearest the estimate", () => {
    const levels = speech(30, [[9.0, 9.4], [14.8, 15.4], [16.2, 16.5]]);
    expect(pauseNear(levels, FRAME, 15)).toBeCloseTo(15.1, 1);
  });

  it("prefers the longest pause within reach, looking further ahead than back", () => {
    const levels = speech(30, [[13.0, 13.9], [15.9, 16.6], [14.6, 14.9]]);
    // The pause at 13 s is the longest but more than 1.2 s back; of those in reach, 15.9 to 16.6 is longest.
    expect(pauseNear(levels, FRAME, 15)).toBeCloseTo(16.25, 1);
  });

  it("returns null when she does not pause there, or there is nothing to go on", () => {
    expect(pauseNear(speech(30, [[2, 2.5]]), FRAME, 15)).toBeNull();
    expect(pauseNear(speech(30, [[15, 15.1]]), FRAME, 15)).toBeNull(); // too short to be a pause
    expect(pauseNear([], FRAME, 15)).toBeNull();
  });
});
