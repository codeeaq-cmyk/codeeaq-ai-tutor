import { describe, expect, it } from "vitest";
import { TimeStretcher } from "./timeStretch";

const RATE = 24000;

/** A voice-like test signal: harmonics of one pitch, with a slowly changing loudness. */
function voiced(seconds: number, pitch: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const t = i / RATE;
    const loudness = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t);
    return loudness * (0.5 * Math.sin(2 * Math.PI * pitch * t) + 0.25 * Math.sin(2 * Math.PI * 2 * pitch * t) + 0.12 * Math.sin(2 * Math.PI * 3 * pitch * t));
  });
}

/** Estimates pitch from the strongest repeat (autocorrelation) between 150 and 400 Hz. */
function pitchOf(signal: Float32Array): number {
  const start = Math.floor(signal.length / 2);
  const size = 2400;
  let bestLag = 0;
  let best = -Infinity;
  for (let lag = Math.floor(RATE / 400); lag <= Math.floor(RATE / 150); lag++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += signal[start + i] * signal[start + i + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  return RATE / bestLag;
}

function stretch(signal: Float32Array, speed: number, chunkSizes: number[] = [signal.length]): Float32Array {
  const stretcher = new TimeStretcher(RATE, speed);
  const parts: Float32Array[] = [];
  let at = 0;
  for (let i = 0; at < signal.length; i++) {
    const size = chunkSizes[i % chunkSizes.length];
    parts.push(stretcher.process(signal.subarray(at, at + size)));
    at += size;
  }
  parts.push(stretcher.flush());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const largestStep = (signal: Float32Array) => signal.reduce((max, v, i) => (i ? Math.max(max, Math.abs(v - signal[i - 1])) : 0), 0);

describe("TimeStretcher", () => {
  // 200 Hz repeats every 120 samples exactly, so the estimate is unambiguous.
  const PITCH = 200;
  const input = voiced(2, PITCH);

  it("makes speech longer by the chosen amount", () => {
    for (const speed of [0.75, 0.85]) {
      const ratio = stretch(input, speed).length / input.length;
      expect(ratio).toBeGreaterThan((1 / speed) * 0.98);
      expect(ratio).toBeLessThan((1 / speed) * 1.03);
    }
  });

  it("keeps the pitch, unlike simply playing slower", () => {
    expect(pitchOf(input)).toBeCloseTo(PITCH, 0);
    for (const speed of [0.75, 0.85]) {
      const pitch = pitchOf(stretch(input, speed));
      // Playing slower would give 200 × speed: 150 Hz or 170 Hz.
      expect(Math.abs(pitch - PITCH)).toBeLessThan(PITCH * 0.02);
    }
  });

  it("adds no clicks or jumps in loudness", () => {
    const out = stretch(input, 0.85);
    expect(largestStep(out)).toBeLessThan(largestStep(input) * 1.3);
    const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(out)).toBeLessThan(peak(input) * 1.15);
  });

  it("gives the same audio however the stream is chopped into chunks", () => {
    const whole = stretch(input, 0.85);
    const chopped = stretch(input, 0.85, [1920, 333, 4800, 1, 2400]);
    expect(chopped.length).toBe(whole.length);
    expect(Array.from(chopped)).toEqual(Array.from(whole));
  });

  it("passes audio through untouched at normal speed", () => {
    const stretcher = new TimeStretcher(RATE, 1);
    const chunk = input.subarray(0, 4800);
    expect(stretcher.process(chunk)).toBe(chunk);
    expect(stretcher.flush().length).toBe(0);
  });

  it("starts clean after a reset", () => {
    const stretcher = new TimeStretcher(RATE, 0.85);
    stretcher.process(input.subarray(0, 6000));
    stretcher.reset();
    expect(stretcher.flush().length).toBe(0);
    const first = stretch(input.subarray(0, 12000), 0.85);
    const again = new TimeStretcher(RATE, 0.85);
    const out = [again.process(input.subarray(0, 12000)), again.flush()];
    expect(out[0].length + out[1].length).toBe(first.length);
  });

  it("keeps unusual speeds within a natural-sounding range", () => {
    const tooSlow = stretch(input, 0.1).length / input.length;
    expect(tooSlow).toBeLessThan(1 / 0.6 + 0.05);
  });
});
