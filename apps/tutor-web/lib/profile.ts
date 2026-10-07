import { parseProfile, type StudentProfile } from "@codeeaq/shared-types";
import { useStored, writeJson } from "./storage";

const KEY = "ceeq:profile:v1";

const parse = (value: unknown) => parseProfile(value) ?? undefined;

export function useProfile(): StudentProfile | undefined {
  return useStored(KEY, parse);
}

export function saveProfile(profile: StudentProfile): void {
  writeJson(KEY, profile);
}

/** Identifies one class's syllabus, e.g. "cbse-10" or "cbse-12-commerce". */
export function classKey({ board, classLevel, stream }: Pick<StudentProfile, "board" | "classLevel" | "stream">) {
  return [board, classLevel, stream].filter(Boolean).join("-");
}
