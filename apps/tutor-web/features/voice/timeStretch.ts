// Slows speech down without lowering its pitch.
//
// The voice model talks at about 155 words a minute whatever it is told, and
// its API has no speed setting. Playing the audio slower would deepen the
// voice, so this stretches it in time instead (WSOLA: waveform-similarity
// overlap-add). Speech is cut into short overlapping frames; frames are laid
// down further apart than they were taken, and each one is nudged a few
// milliseconds so its waveform lines up with the one before. The pitch periods
// are reused rather than stretched, which is why the pitch stays the same.
//
// It works on a stream: feed chunks as they arrive, play what comes back.

/** Frame length. 30 ms spans several pitch periods of any human voice. */
const FRAME_SECONDS = 0.03;
/** How far a frame may be nudged either way to line up. Covers a pitch period down to ~60 Hz. */
const SEARCH_SECONDS = 0.008;

export class TimeStretcher {
  private readonly frame: number;
  private readonly hop: number;
  private readonly search: number;
  private readonly window: Float32Array;

  private speed: number;
  /** Unconsumed input; `inputStart` is the stream position of its first sample. */
  private input = new Float32Array(0);
  private inputStart = 0;
  /** Stream position where the next frame would ideally be taken from. */
  private target = 0;
  /** Stream position the previous frame was actually taken from, or -1 before the first. */
  private previous = -1;
  /** Second half of the previous frame, waiting to overlap with the next. */
  private tail: Float32Array;

  /** `speed` is the playback rate: 1 is unchanged, 0.85 is 15% slower. */
  constructor(sampleRate: number, speed = 1) {
    this.hop = Math.round((FRAME_SECONDS * sampleRate) / 2);
    this.frame = this.hop * 2;
    this.search = Math.round(SEARCH_SECONDS * sampleRate);
    // A periodic Hann window: each half-overlapped pair sums to exactly 1.
    this.window = Float32Array.from({ length: this.frame }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / this.frame));
    this.tail = new Float32Array(this.hop);
    this.speed = clampSpeed(speed);
  }

  setSpeed(speed: number): void {
    this.speed = clampSpeed(speed);
  }

  /** Forgets everything buffered, e.g. when Ceeq is interrupted. */
  reset(): void {
    this.input = new Float32Array(0);
    this.inputStart = 0;
    this.target = 0;
    this.previous = -1;
    this.tail.fill(0);
  }

  /** Takes the next chunk of speech and returns the stretched audio that is ready to play. */
  process(chunk: Float32Array): Float32Array {
    // At normal speed, with nothing mid-stretch, pass audio straight through.
    if (this.speed === 1 && this.previous < 0 && this.input.length === 0) return chunk;
    this.append(chunk);
    return this.run(this.inputStart + this.input.length);
  }

  /** Returns whatever is still buffered. Call when an utterance ends. */
  flush(): Float32Array {
    if (this.previous < 0 && this.input.length === 0) return new Float32Array(0);
    const end = this.inputStart + this.input.length;
    // Pad with silence so the last real samples can be reached by a full frame.
    this.append(new Float32Array(this.frame + this.search + this.hop));
    const body = this.run(end);
    const out = new Float32Array(body.length + this.hop);
    out.set(body);
    out.set(this.tail, body.length);
    this.reset();
    return out;
  }

  private append(chunk: Float32Array): void {
    if (!chunk.length) return;
    const joined = new Float32Array(this.input.length + chunk.length);
    joined.set(this.input);
    joined.set(chunk, this.input.length);
    this.input = joined;
  }

  /** Lays down frames while their input is available and they start before `stopAt`. */
  private run(stopAt: number): Float32Array {
    const { frame, hop, search, window } = this;
    const available = this.inputStart + this.input.length;
    const pieces: Float32Array[] = [];
    let produced = 0;

    for (;;) {
      const ideal = Math.round(this.target);
      if (ideal >= stopAt) break;
      const natural = this.previous < 0 ? ideal : this.previous + hop;
      if (Math.max(ideal + search, natural) + frame > available) break;

      // The first frame is taken as is; later ones are nudged to line up with
      // where the previous frame would naturally have continued.
      const at = this.previous < 0 ? ideal : this.bestMatch(ideal, natural);
      const x = this.input;
      const base = at - this.inputStart;
      const out = new Float32Array(hop);
      if (this.previous < 0) {
        out.set(x.subarray(base, base + hop)); // no fade-in at the very start
      } else {
        for (let n = 0; n < hop; n++) out[n] = this.tail[n] + window[n] * x[base + n];
      }
      for (let n = 0; n < hop; n++) this.tail[n] = window[n + hop] * x[base + hop + n];
      pieces.push(out);
      produced += hop;

      this.previous = at;
      this.target += hop * this.speed;
      // Drop input no later frame can need.
      const keepFrom = Math.max(this.inputStart, Math.min(Math.round(this.target) - search, at + hop));
      if (keepFrom > this.inputStart) {
        this.input = this.input.subarray(keepFrom - this.inputStart);
        this.inputStart = keepFrom;
      }
    }

    const result = new Float32Array(produced);
    let offset = 0;
    for (const piece of pieces) {
      result.set(piece, offset);
      offset += piece.length;
    }
    return result;
  }

  /**
   * The position near `ideal` whose waveform best matches the natural
   * continuation at `natural`, by normalised cross-correlation over the
   * overlap. A coarse pass over every other sample, then a fine pass around
   * the winner, keeps this cheap enough for the main thread.
   */
  private bestMatch(ideal: number, natural: number): number {
    const { hop, search } = this;
    const x = this.input;
    const reference = natural - this.inputStart;
    const lowest = Math.max(this.inputStart, ideal - search);
    const highest = ideal + search;

    const similarity = (position: number, step: number): number => {
      const candidate = position - this.inputStart;
      let dot = 0;
      let energy = 0;
      for (let n = 0; n < hop; n += step) {
        const c = x[candidate + n];
        dot += c * x[reference + n];
        energy += c * c;
      }
      return dot / Math.sqrt(energy + 1e-9);
    };

    let best = Math.min(Math.max(ideal, lowest), highest);
    let bestScore = -Infinity;
    for (let position = lowest; position <= highest; position += 2) {
      const s = similarity(position, 2);
      if (s > bestScore) {
        bestScore = s;
        best = position;
      }
    }
    let refined = best;
    let refinedScore = -Infinity;
    for (let position = Math.max(lowest, best - 1); position <= Math.min(highest, best + 1); position++) {
      const s = similarity(position, 1);
      if (s > refinedScore) {
        refinedScore = s;
        refined = position;
      }
    }
    return refined;
  }
}

/** Speeds outside this range sound unnatural with this method. */
function clampSpeed(speed: number): number {
  return Number.isFinite(speed) ? Math.min(1.25, Math.max(0.6, speed)) : 1;
}
