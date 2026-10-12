import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

// Device storage. Every access is guarded: storage can be unavailable
// (private mode, blocked site data) and the app must still work.
//
// A student's own data (class, progress, quizzes) is kept under keys that
// carry their account id, so two students sharing a device never see each
// other's work. It is also saved to their account (see sync.ts); this copy is
// what makes the app instant and lets it work through a dropped connection.

const listeners = new Set<() => void>();

let studentId: string | null = null;

/** Called when a student signs in or out, before anything reads their data. */
export function setStorageStudent(uid: string | null): void {
  studentId = uid;
}

/** The storage key for something that belongs to the signed-in student. */
export function studentKey(name: string): string {
  return `ceeq:${studentId ?? "guest"}:${name}`;
}

export function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the value just isn't remembered.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Reads a stored value and re-renders when it changes. Returns undefined on
 * the server and on the first client render, so markup always hydrates.
 */
export function useStored<T>(key: string, parse: (value: unknown) => T | undefined): T | undefined {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => SERVER_SENTINEL,
  );
  // Parse once per stored string so callers get a stable object between renders.
  return useMemo(() => {
    if (raw === SERVER_SENTINEL || raw === null) return undefined;
    try {
      return parse(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }, [raw, parse]);
}

const SERVER_SENTINEL = "\u0000server";

/** True once rendering on the client, for content that depends on storage. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** The time, for deciding what is due. Steady between renders; brought up to date when the tab is looked at again. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  return now;
}
