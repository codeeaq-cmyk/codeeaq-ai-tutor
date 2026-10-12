import { parseProfile, type StudentProfile } from "@codeeaq/shared-types";
import { readJson, studentKey, useStored, writeJson } from "./storage";

const NAME = "profile:v1";
/** Where the profile was kept before students signed in. */
const DEVICE_KEY = "ceeq:profile:v1";

/** The profile as stored, with the time it was chosen so the latest choice wins across devices. */
export type StoredProfile = StudentProfile & { updatedAt: number };

const parse = (value: unknown) => parseProfile(value) ?? undefined;

function parseStored(value: unknown): StoredProfile | undefined {
  const profile = parseProfile(value);
  const at = (value as { updatedAt?: unknown } | null)?.updatedAt;
  return profile ? { ...profile, updatedAt: typeof at === "number" ? at : 0 } : undefined;
}

export function useProfile(): StudentProfile | undefined {
  return useStored(studentKey(NAME), parse);
}

let onSaved: (() => void) | undefined;

/** Lets the account sync hear about a new choice without this module depending on it. */
export function onProfileSaved(listener: () => void): void {
  onSaved = listener;
}

export function saveProfile(profile: StudentProfile): void {
  writeJson(studentKey(NAME), { ...profile, updatedAt: Date.now() } satisfies StoredProfile);
  onSaved?.();
}

export function readStoredProfile(): StoredProfile | undefined {
  return parseStored(readJson(studentKey(NAME)));
}

/**
 * Takes the account's copy of the profile when it is the later one. Returns
 * true when this device's copy is the later one and should be saved instead.
 */
export function mergeProfile(cloud: unknown): boolean {
  const theirs = parseStored(cloud);
  const ours = readStoredProfile();
  if (theirs && (!ours || theirs.updatedAt >= ours.updatedAt)) {
    if (!ours || theirs.updatedAt > ours.updatedAt) writeJson(studentKey(NAME), theirs);
    return false;
  }
  return !!ours;
}

/** A class chosen on this device before sign-in existed goes to the first student who signs in. */
export function adoptDeviceProfile(): void {
  const old = readJson(DEVICE_KEY);
  if (old === undefined) return;
  if (!readStoredProfile() && parseProfile(old)) writeJson(studentKey(NAME), old);
  writeJson(DEVICE_KEY, undefined);
}

/** Identifies one class's syllabus, e.g. "cbse-10" or "cbse-12-commerce". */
export function classKey({ board, classLevel, stream }: Pick<StudentProfile, "board" | "classLevel" | "stream">) {
  return [board, classLevel, stream].filter(Boolean).join("-");
}
