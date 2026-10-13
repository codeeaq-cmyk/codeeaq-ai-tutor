import { useStored, writeJson } from "./storage";

// Whether the student reads along with what Ceeq says. A lesson is for
// listening and looking at the board, so her words are not shown unless the
// student asks for them.

const KEY = "ceeq:transcript:v1";

const parse = (value: unknown) => (typeof value === "boolean" ? value : undefined);

/** The student's choice, remembered on this device, and a way to change it. */
export function useTranscript(): { transcript: boolean; toggleTranscript: () => void } {
  const transcript = useStored(KEY, parse) ?? false;
  const toggleTranscript = () => writeJson(KEY, !transcript);
  return { transcript, toggleTranscript };
}
