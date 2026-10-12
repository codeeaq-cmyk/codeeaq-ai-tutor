// One turn of Ceeq's speech, as it arrives, and how much of it the student
// should hear. A turn is meant to be one paragraph, said once, with any tool
// calls made before it. The voice model does not always keep to that:
//
// - It speaks, calls its tools at the end, and then says the paragraph again,
//   or announces that it will "start fresh" and explains it all once more. The
//   voice service starts a reply afresh once a tool call has been answered.
// - Now and then it says the same paragraph twice in one go.
//
// Either way the student would sit through the same thing twice. So once a
// whole paragraph has been said, a tool call ends the turn's speech, and a
// paragraph that starts coming round again is cut where the repeat begins.

/** Where the turn's speech stops being heard. */
export interface Cut {
  /**
   * Seconds into the turn's speech, as received, after which nothing should be
   * heard: speech already queued beyond it must be cut. Null when everything
   * queued so far is to be heard and only later speech is dropped.
   */
  at: number | null;
}

/** What to do with what has just arrived. */
export interface Step<Chunk> {
  /** Speech to play now. */
  play: Chunk[];
  /** Set once, at the moment the rest of the turn stops being heard. */
  over?: Cut;
}

/** A paragraph cannot come round again before this many words have been said. */
const REPEAT_NOT_BEFORE = 15;
/** How many of her opening words must come round again to count as starting over. */
const REPEAT_WORDS = 8;
/** A turn that has reached this many words and the end of a sentence is a whole paragraph. */
const PARAGRAPH_WORDS = 25;
/** A turn that ends on a question is whole from this many words: she has asked, and now waits. */
const QUESTION_WORDS = 12;

interface Word {
  text: string;
  /** Where the word starts in the transcript. */
  at: number;
}

function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[\p{L}\p{N}']+/gu)].map((m) => ({ text: m[0].toLowerCase(), at: m.index }));
}

/** Whether what has been said so far stops at the end of a sentence, not in the middle of one. */
export function endsSentence(text: string): boolean {
  return /[.!?]["'”’)\]]*\s*$/.test(text);
}

/** Whether what has been said so far is a finished paragraph, to which nothing need be added. */
export function isWholeParagraph(text: string): boolean {
  const ending = /([.!?])["'”’)\]]*\s*$/.exec(text);
  if (!ending) return false;
  const count = wordsOf(text).length;
  return count >= PARAGRAPH_WORDS || (ending[1] === "?" && count >= QUESTION_WORDS);
}

/** The index of the word at which the opening words come round again, or -1. */
function repeatStart(words: Word[]): number {
  // The transcript sometimes opens with a stray word ("text", "wait"), so the
  // opening is also looked for without its first word.
  for (const skip of [0, 1]) {
    const opening = words.slice(skip, skip + REPEAT_WORDS);
    if (opening.length < REPEAT_WORDS) continue;
    for (let i = Math.max(REPEAT_NOT_BEFORE, skip + REPEAT_WORDS); i + REPEAT_WORDS <= words.length; i++) {
      if (opening.every((word, j) => words[i + j].text === word.text)) return i;
    }
  }
  return -1;
}

const NOTHING = { play: [] };

export class TurnSpeech<Chunk> {
  private begun = false;
  private stopped = false;
  /** A tool call has come after speech, and no more speech has arrived since. */
  private afterTool = false;
  private said = "";
  private seconds = 0;
  /** After each piece of transcript: how long the transcript was, and how much speech had arrived. */
  private marks: { chars: number; seconds: number }[] = [];

  /** Her words for this turn, as the student will hear them. */
  get caption(): string {
    return this.said;
  }

  /** Whether any speech has arrived in this turn. */
  get spoken(): boolean {
    return this.begun;
  }

  /** Whether the rest of this turn is being dropped. */
  get over(): boolean {
    return this.stopped;
  }

  /** A tool call has arrived. After a whole paragraph, that ends the turn's speech. */
  toolCall(): Step<Chunk> {
    if (!this.begun || this.stopped) return NOTHING;
    this.afterTool = true;
    return this.stopIfWhole();
  }

  /** A piece of her speech has arrived, `seconds` long. */
  audio(chunk: Chunk, seconds: number): Step<Chunk> {
    if (this.stopped) return NOTHING;
    // Speech after a tool call that followed only a few words: she is carrying on, not starting over.
    this.afterTool = false;
    this.begun = true;
    this.seconds += seconds;
    return { play: [chunk] };
  }

  /** A piece of the transcript of her speech has arrived. */
  text(delta: string): Step<Chunk> {
    if (this.stopped) return NOTHING;
    this.said += delta;
    this.marks.push({ chars: this.said.length, seconds: this.seconds });
    // The last words of the paragraph can reach the transcript a moment after the tool call.
    if (this.afterTool) {
      const step = this.stopIfWhole();
      if (step.over) return step;
    }

    const words = wordsOf(this.said);
    const again = repeatStart(words);
    if (again === -1) return NOTHING;
    // She is saying the paragraph again. The words arrive about in step with
    // the speech, so the repeat began about where the speech had got to when
    // the last word before it was transcribed.
    const chars = words[again].at;
    const before = this.marks.filter((mark) => mark.chars <= chars).at(-1);
    this.said = this.said.slice(0, chars).trimEnd();
    this.stopped = true;
    return { play: [], over: { at: before?.seconds ?? null } };
  }

  /** The app has moved on from this turn: whatever more of it arrives is not to be heard. */
  abandon(): void {
    this.stopped = true;
  }

  /** The turn is over. Starts afresh for the next one. */
  endTurn(): void {
    this.begun = false;
    this.stopped = false;
    this.afterTool = false;
    this.said = "";
    this.seconds = 0;
    this.marks = [];
  }

  private stopIfWhole(): Step<Chunk> {
    if (!isWholeParagraph(this.said)) return NOTHING;
    this.stopped = true;
    return { play: [], over: { at: null } };
  }
}

/**
 * The middle of the longest pause in speech near `around` seconds, or null if
 * she does not pause there. `levels` holds the loudness of each `frame` seconds
 * of the turn. Used to cut a repeated paragraph between sentences instead of
 * through a word. The search reaches further ahead than back: hearing a first
 * word of the repeat is better than losing the last word of the paragraph.
 */
export function pauseNear(levels: number[], frame: number, around: number, back = 1.2, ahead = 2.2): number | null {
  if (!levels.length) return null;
  const sorted = [...levels].sort((a, b) => a - b);
  // Quiet means well below how loud her speech usually is.
  const quiet = Math.max(0.003, sorted[Math.floor(sorted.length * 0.9)] * 0.08);
  const from = Math.max(0, Math.floor((around - back) / frame));
  const to = Math.min(levels.length, Math.ceil((around + ahead) / frame));
  const shortest = Math.ceil(0.18 / frame);

  let best: { start: number; length: number } | null = null;
  let start = -1;
  for (let i = from; i <= to; i++) {
    const isQuiet = i < to && levels[i] < quiet;
    if (isQuiet && start === -1) start = i;
    if (!isQuiet && start !== -1) {
      const length = i - start;
      const nearer = best && Math.abs(start + length / 2 - around / frame) < Math.abs(best.start + best.length / 2 - around / frame);
      if (length >= shortest && (!best || length > best.length || (length === best.length && nearer))) best = { start, length };
      start = -1;
    }
  }
  return best ? (best.start + best.length / 2) * frame : null;
}
