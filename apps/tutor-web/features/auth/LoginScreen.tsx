"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, Wordmark } from "@/features/ui";
import { confirmCode, localTestCode, startSignIn, useAccount } from "@/lib/account";
import { formatPhone, normalisePhone } from "@/lib/phone";

const CODE_LENGTH = 6;

/**
 * Sign in with a mobile number and its code. Ceeq is by invitation for now:
 * each student is given a code with their number, and nothing is sent by text.
 * `next` is where to go afterwards.
 */
export function LoginScreen({ next }: { next: string }) {
  const router = useRouter();
  const account = useAccount();
  const [typed, setTyped] = useState("");
  /** The number being signed in, in international form. Null while the number is being entered. */
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testCode, setTestCode] = useState<string>();
  const slot = useRef<HTMLDivElement>(null);

  const signedIn = account.status === "signed-in";
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  async function begin(number: string) {
    if (!slot.current) return;
    setBusy(true);
    setError(null);
    try {
      await startSignIn(number, slot.current);
      setPhone(number);
      setCode("");
      setTestCode(await localTestCode(number));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      await confirmCode(value);
      // Signed in: the effect above takes the student on.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      // Empty the box, so the next try starts clean instead of adding to the wrong digits.
      setCode("");
      setBusy(false);
    }
  }

  function onPhoneSubmit(e: FormEvent) {
    e.preventDefault();
    const number = normalisePhone(typed);
    if (!number) setError("Enter your 10-digit mobile number.");
    else void begin(number);
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    // The last digit is as good as pressing the button.
    if (digits.length === CODE_LENGTH && !busy) void verify(digits);
  }

  function onCodeSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length === CODE_LENGTH) void verify(code);
    else setError(`Enter your ${CODE_LENGTH}-digit code.`);
  }

  const field = "w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-lg outline-none focus-within:border-accent";
  // A number typed with its own country code replaces the +91 shown in front.
  const ownCode = typed.trim().startsWith("+");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-6 sm:py-10">
      <Wordmark href="/login" />

      {/* Signed in already, or just now: the next page is on its way. */}
      {account.status !== "signed-out" ? (
        <div className="mt-16 flex justify-center" aria-busy>
          <span className="skeleton h-10 w-10 rounded-full" />
        </div>
      ) : phone === null ? (
        <form onSubmit={onPhoneSubmit} className="mt-12 sm:mt-20" noValidate>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sign in to Ceeq</h1>
          <p className="mt-2 text-lg text-muted">Enter the mobile number you were registered with.</p>

          <label htmlFor="phone" className="mt-10 mb-2 block text-sm font-medium text-muted">Mobile number</label>
          <div className={`flex items-center gap-3 ${field}`}>
            {!ownCode && <span className="select-none text-muted">+91</span>}
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
              placeholder="98765 43210"
              maxLength={20}
              className="plain-focus min-w-0 flex-1 bg-transparent tracking-wide placeholder:text-muted/60"
              aria-invalid={!!error}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          <Problem message={error} />
          <PrimaryButton type="submit" disabled={busy || !typed.trim()} className="mt-5 w-full text-lg">
            {busy ? "Checking…" : "Continue"}
          </PrimaryButton>
          <p className="mt-4 text-sm text-muted">Ceeq is by invitation for now. If your number isn’t registered, ask the person who invited you.</p>
        </form>
      ) : (
        <form onSubmit={onCodeSubmit} className="mt-12 sm:mt-20" noValidate>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Enter your code</h1>
          <p className="mt-2 text-lg text-muted">
            The {CODE_LENGTH}-digit code you were given for <span className="whitespace-nowrap text-fg">{formatPhone(phone)}</span>.{" "}
            <button
              type="button"
              onClick={() => {
                setPhone(null);
                setError(null);
                setTestCode(undefined);
              }}
              className="font-medium text-accent"
            >
              Change
            </button>
          </p>

          <label htmlFor="code" className="mt-10 mb-2 block text-sm font-medium text-muted">Code</label>
          <input
            id="code"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoFocus
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder={"•".repeat(CODE_LENGTH)}
            className={`${field} plain-focus text-center text-2xl tracking-[0.5em] tabular-nums placeholder:text-muted/40 focus:border-accent`}
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
          />
          <Problem message={error} />
          <PrimaryButton type="submit" disabled={busy || code.length !== CODE_LENGTH} className="mt-5 w-full text-lg">
            {busy ? "Checking…" : "Sign in"}
          </PrimaryButton>

          {testCode && (
            <p className="mt-6 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">
              Running locally, where any number works. Your code is{" "}
              <button type="button" onClick={() => onCodeChange(testCode)} className="font-mono font-semibold text-fg underline decoration-dotted">
                {testCode}
              </button>
              .
            </p>
          )}
        </form>
      )}

      {/* Holds the invisible check that keeps bots from trying numbers. */}
      <div ref={slot} />
    </main>
  );
}

function Problem({ message }: { message: string | null }) {
  return (
    <p id="login-error" role="alert" className="mt-2 min-h-5 text-sm text-(--ink-red)">
      {message}
    </p>
  );
}
