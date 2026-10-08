import { useStored, writeJson } from "./storage";

// How fast Ceeq's voice plays. The voice model itself speaks at about 155
// words a minute and cannot be told otherwise, so the browser stretches its
// audio in time (see features/voice/timeStretch.ts).

export const PACES = [
  { id: "slower", label: "Slower", speed: 0.75 }, // about 115 words a minute
  { id: "slow", label: "Slow", speed: 0.85 }, // about 130 words a minute
  { id: "normal", label: "Normal", speed: 1 }, // as the model speaks
] as const;

export type Pace = (typeof PACES)[number];

/** New explanations are easier to follow a little slower than conversation. */
const DEFAULT_PACE: Pace = PACES[1];
const KEY = "ceeq:pace:v1";

const parse = (value: unknown) => PACES.find((p) => p.id === value);

/** The student's chosen pace, remembered on this device, and a way to step to the next one. */
export function usePace(): { pace: Pace; nextPace: () => void } {
  const pace = useStored(KEY, parse) ?? DEFAULT_PACE;
  const nextPace = () => writeJson(KEY, PACES[(PACES.indexOf(pace) + 1) % PACES.length].id);
  return { pace, nextPace };
}
