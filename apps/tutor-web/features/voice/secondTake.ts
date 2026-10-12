// Ceeq is meant to call her tools before she speaks. Sometimes she speaks
// first, calls a tool at the end, and then says the whole paragraph again: the
// voice service starts her reply afresh once a tool call has been answered. The
// student would hear the same paragraph twice.
//
// This watches one turn at a time. Speech that arrives after a tool call which
// itself came after speech is held back, unheard, until her first few words
// show which it is: the same paragraph starting again, which is dropped, or
// something new, which is played as usual.

/** What to do with what has just arrived: text to add to the caption, audio to play. */
export interface Released<Chunk> {
  show: string;
  play: Chunk[];
}

/** How many of her opening words must come round again to count as starting over. */
const OPENING_WORDS = 5;
/** Held speech that has run this long without her opening words is something new. */
const ENOUGH_WORDS = 12;

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);

/** Whether `part` appears, in order and unbroken, somewhere in `all`. */
function contains(all: string[], part: string[]): boolean {
  if (part.length < OPENING_WORDS) return false;
  for (let i = 0; i + part.length <= all.length; i++) {
    if (part.every((word, j) => all[i + j] === word)) return true;
  }
  return false;
}

export class SecondTake<Chunk> {
  private state: "playing" | "holding" | "dropping" = "playing";
  /** Whether any speech has arrived in this turn. */
  private begun = false;
  /** What she has said in this turn that the student will hear. */
  private said = "";
  private heldText = "";
  private heldAudio: Chunk[] = [];

  /** True while speech is being held back, waiting to see what it is. */
  get holding(): boolean {
    return this.state === "holding";
  }

  /** A tool call has arrived. If she has already spoken in this turn, what follows may be a second take. */
  toolCall(): void {
    if (this.begun && this.state === "playing") this.state = "holding";
  }

  /** A piece of her speech has arrived. Returns what should be played now. */
  audio(chunk: Chunk): Chunk[] {
    this.begun = true;
    if (this.state === "playing") return [chunk];
    if (this.state === "holding") this.heldAudio.push(chunk);
    return [];
  }

  /** A piece of the transcript of her speech has arrived. */
  text(delta: string): Released<Chunk> {
    if (this.state === "playing") {
      this.said += delta;
      return { show: delta, play: [] };
    }
    if (this.state === "dropping") return { show: "", play: [] };

    this.heldText += delta;
    const opening = words(this.said);
    const held = words(this.heldText);
    // The transcript can open with a stray word ("text", "wait"), so the opening is also tried without its first word.
    if (contains(held, opening.slice(0, OPENING_WORDS)) || contains(held, opening.slice(1, OPENING_WORDS + 1))) {
      this.state = "dropping";
      this.heldText = "";
      this.heldAudio = [];
      return { show: "", play: [] };
    }
    return held.length >= ENOUGH_WORDS ? this.release() : { show: "", play: [] };
  }

  /** Lets held speech through after all: it was not a second take, or there was too little to tell. */
  release(): Released<Chunk> {
    if (this.state !== "holding") return { show: "", play: [] };
    const released = { show: this.heldText, play: this.heldAudio };
    this.said += this.heldText;
    this.state = "playing";
    this.heldText = "";
    this.heldAudio = [];
    return released;
  }

  /** The turn is over (or was cut short). Returns anything still held, and starts afresh for the next turn. */
  endTurn(): Released<Chunk> {
    const released = this.release();
    this.state = "playing";
    this.begun = false;
    this.said = "";
    return released;
  }
}
