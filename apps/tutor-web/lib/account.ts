import { useSyncExternalStore } from "react";
import { onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber, signOut, type ConfirmationResult } from "firebase/auth";
import { auth, AUTH_EMULATOR_URL, PROJECT_ID, USING_EMULATORS } from "./firebase";
import { setStorageStudent } from "./storage";
import { flushSync, startSync, stopSync } from "./sync";

// Who is signed in. Students sign in with their mobile number and a 6-digit
// code, through Firebase phone sign-in. There is no separate sign-up: the first
// time a number is verified, its account is created.
//
// For now Ceeq is by invitation, and no text is ever sent (Firebase bills
// each one). Each student's number is registered with a fixed code in the
// Firebase console (Authentication > Sign-in method > Phone > Phone numbers
// for testing; at most ten), and the student is told that code. The project's
// SMS region policy allows no region, so any other number is refused instead
// of being sent a text. Allowing a region there is all it takes to turn texted
// codes on later.

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
    const signedIn = { status: "signed-in", uid: user.uid, phone: user.phoneNumber ?? "" } as const;
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

let verifier: RecaptchaVerifier | null = null;
let pending: ConfirmationResult | null = null;

const MESSAGES: Record<string, string> = {
  "auth/invalid-phone-number": "That doesn't look like a mobile number. Check it and try again.",
  "auth/missing-phone-number": "Enter your mobile number.",
  "auth/too-many-requests": "Too many tries for now. Please wait a few minutes and try again.",
  "auth/quota-exceeded": "Too many tries for now. Please try again later.",
  "auth/captcha-check-failed": "The security check didn't pass. Please try again.",
  "auth/invalid-verification-code": "That code isn't right. Check it and try again.",
  "auth/missing-verification-code": "Enter your 6-digit code.",
  "auth/code-expired": "That took too long. Go back and enter your number again.",
  "auth/session-expired": "That took too long. Go back and enter your number again.",
  "auth/network-request-failed": "No connection. Check your internet and try again.",
  "auth/user-disabled": "This number has been blocked. Please contact support.",
  // What a number gets when it has no registered code and texts are not allowed.
  "auth/operation-not-allowed": "This number isn't registered for Ceeq yet.",
  "auth/billing-not-enabled": "This number isn't registered for Ceeq yet.",
};

function explain(err: unknown): Error {
  const code = (err as { code?: unknown } | null)?.code;
  console.warn("Sign-in failed:", err);
  return new Error((typeof code === "string" && MESSAGES[code]) || "Something went wrong. Please try again.");
}

/**
 * Starts signing in with a number (in international form); `confirmCode`
 * finishes it. A registered number is sent nothing, since the student already
 * has its code. `slot` is an element on the page that holds the invisible
 * security check which guards against bots.
 */
export async function startSignIn(phone: string, slot: HTMLElement): Promise<void> {
  verifier?.clear();
  // The check cannot be drawn twice in one element, so each try gets a fresh one.
  const holder = document.createElement("div");
  slot.replaceChildren(holder);
  verifier = new RecaptchaVerifier(auth, holder, { size: "invisible" });
  try {
    pending = await signInWithPhoneNumber(auth, phone, verifier);
  } catch (err) {
    throw explain(err);
  }
}

/** Signs the student in with their code. */
export async function confirmCode(code: string): Promise<void> {
  if (!pending) throw new Error("Enter your number first.");
  try {
    await pending.confirm(code);
    pending = null;
  } catch (err) {
    throw explain(err);
  }
}

export async function signOutStudent(): Promise<void> {
  await flushSync();
  await signOut(auth);
}

/**
 * Local development only: the emulator accepts any number and makes up its
 * code. Returns the latest code for the number so the sign-in page can show it.
 */
export async function localTestCode(phone: string): Promise<string | undefined> {
  if (!USING_EMULATORS) return undefined;
  try {
    const response = await fetch(`${AUTH_EMULATOR_URL}/emulator/v1/projects/${PROJECT_ID}/verificationCodes`);
    const { verificationCodes } = (await response.json()) as { verificationCodes?: { phoneNumber: string; code: string }[] };
    return verificationCodes?.filter((v) => v.phoneNumber === phone).at(-1)?.code;
  } catch {
    return undefined;
  }
}
