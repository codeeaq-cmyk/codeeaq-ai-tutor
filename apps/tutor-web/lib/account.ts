import { useSyncExternalStore } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, USING_EMULATORS } from "./firebase";
import { accountName, phoneOfAccount } from "./phone";
import { setStorageStudent } from "./storage";
import { flushSync, startSync, stopSync } from "./sync";

// Who is signed in. Ceeq is by invitation: a student signs in with their
// mobile number and a 6-digit code, both set up for them beforehand. Nothing is
// sent by text, so signing in costs nothing and needs no phone signal.
//
// Underneath it is Firebase's sign-in by password, with the number as the
// account's name (see accountName) and the code as its password. A student is
// added in the Firebase console under Authentication > Users > Add user. The
// app never creates accounts itself, and sign-up is switched off for the
// project (Authentication > Settings > User actions), so only numbers that
// were added can get in.

export type Account =
  | { status: "loading" }
  | { status: "signed-out" }
  /** `ready` is false while a device new to the student is fetching their class and progress. */
  | { status: "signed-in"; uid: string; phone: string; ready: boolean };

const LOADING: Account = { status: "loading" };
let account: Account = LOADING;
const listeners = new Set<() => void>();

function set(next: Account) {
  account = next;
  listeners.forEach((l) => l());
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      stopSync();
      setStorageStudent(null);
      set({ status: "signed-out" });
      return;
    }
    const signedIn = { status: "signed-in", uid: user.uid, phone: phoneOfAccount(user.email) } as const;
    // Their storage keys must be in place before anything reads or syncs their data.
    setStorageStudent(user.uid);
    const known = startSync(user.uid, signedIn.phone, () => {
      if (account.status === "signed-in" && account.uid === user.uid) set({ ...signedIn, ready: true });
    });
    set({ ...signedIn, ready: known });
  });
}

function subscribe(listener: () => void) {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The signed-in student. "loading" on the server and until the browser has checked. */
export function useAccount(): Account {
  return useSyncExternalStore(
    subscribe,
    () => account,
    () => LOADING,
  );
}

// ---------- Signing in ----------

/** Firebase does not say which of the two was wrong, so that nobody can find out which numbers have accounts. */
const NO_MATCH = "That number and code don’t match. Check both and try again.";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": NO_MATCH,
  "auth/invalid-login-credentials": NO_MATCH,
  "auth/user-not-found": NO_MATCH,
  "auth/wrong-password": NO_MATCH,
  "auth/invalid-email": NO_MATCH,
  "auth/missing-password": "Enter your 6-digit code.",
  "auth/too-many-requests": "Too many wrong tries. Please wait a few minutes and try again.",
  "auth/network-request-failed": "No connection. Check your internet and try again.",
  "auth/user-disabled": "This number has been switched off. Ask the person who invited you.",
  "auth/operation-not-allowed": "Signing in isn’t switched on yet.",
};

const codeOf = (err: unknown) => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
};

/** Signs a student in with their number (in international form) and their code. */
export async function signInWithCode(phone: string, code: string): Promise<void> {
  const name = accountName(phone);
  try {
    await signInWithEmailAndPassword(auth, name, code);
  } catch (err) {
    // Local development has nobody to add students, so a number's first code becomes its code.
    if (USING_EMULATORS && (await createdLocally(name, code))) return;
    console.warn("Sign-in failed:", err);
    throw new Error(MESSAGES[codeOf(err)] ?? "Something went wrong. Please try again.");
  }
}

/** Emulator only: makes the account if the number has none yet. False if it has one, so the code was simply wrong. */
async function createdLocally(name: string, code: string): Promise<boolean> {
  try {
    await createUserWithEmailAndPassword(auth, name, code);
    return true;
  } catch {
    return false;
  }
}

export async function signOutStudent(): Promise<void> {
  await flushSync();
  await signOut(auth);
}
