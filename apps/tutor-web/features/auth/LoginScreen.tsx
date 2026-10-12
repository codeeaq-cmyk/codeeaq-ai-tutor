"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, Wordmark } from "@/features/ui";
import { signInWithCode, useAccount } from "@/lib/account";
import { USING_EMULATORS } from "@/lib/firebase";
import { normalisePhone } from "@/lib/phone";

const CODE_LENGTH = 6;

/**
 * Sign in with a mobile number and its code. Ceeq is by invitation: each
 * student is given a code with their number, and nothing is sent by text.
 * `next` is where to go afterwards.
 */
export function LoginScreen({ next }: { next: string }) {
  const router = useRouter();
  const account = useAccount();
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeBox = useRef<HTMLInputElement>(null);

  const signedIn = account.status === "signed-in";
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const phone = normalisePhone(number);
    if (!phone) return setError("Enter your 10-digit mobile number.");
    if (code.length !== CODE_LENGTH) return setError(`Enter your ${CODE_LENGTH}-digit code.`);
    setBusy(true);
    setError(null);
    try {
      await signInWithCode(phone, code);
      // Signed in: the effect above takes the student on.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      // Empty the box, so the next try starts clean instead of adding to the wrong digits.
      setCode("");
      setBusy(false);
      codeBox.current?.focus();
    }
  }

  const field = "w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-lg outline-none focus-within:border-accent";
  // A number typed with its own country code replaces the +91 shown in front.
  const ownCode = number.trim().startsWith("+");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-6 sm:py-10">
      <Wordmark href="/login" />

      {/* Signed in already, or just now: the next page is on its way. */}
      {account.status !== "signed-out" ? (
        <div className="mt-16 flex justify-center" aria-busy>
          <span className="skeleton h-10 w-10 rounded-full" />
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-12 sm:mt-20" noValidate>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sign in to Ceeq</h1>
          <p className="mt-2 text-lg text-muted">Enter your mobile number and the code you were given.</p>

          <label htmlFor="phone" className="mt-10 mb-2 block text-sm font-medium text-muted">Mobile number</label>
          <div className={`flex items-center gap-3 ${field}`}>
            {!ownCode && <span className="select-none text-muted">+91</span>}
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              autoFocus
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setError(null);
              }}
              placeholder="98765 43210"
              maxLength={20}
              className="plain-focus min-w-0 flex-1 bg-transparent tracking-wide placeholder:text-muted/60"
              aria-invalid={!!error}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>

          <label htmlFor="code" className="mt-5 mb-2 block text-sm font-medium text-muted">Code</label>
          <input
            id="code"
            ref={codeBox}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
              setError(null);
            }}
            placeholder={"•".repeat(CODE_LENGTH)}
            className={`${field} plain-focus text-center text-2xl tracking-[0.5em] tabular-nums placeholder:text-muted/40 focus:border-accent`}
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
          />

          <p id="login-error" role="alert" className="mt-2 min-h-5 text-sm text-(--ink-red)">
            {error}
          </p>
          <PrimaryButton type="submit" disabled={busy || !number.trim() || code.length !== CODE_LENGTH} className="mt-5 w-full text-lg">
            {busy ? "Signing in…" : "Sign in"}
          </PrimaryButton>
          <p className="mt-4 text-sm text-muted">Ceeq is by invitation for now. If you don’t have a code, ask the person who invited you.</p>

          {USING_EMULATORS && (
            <p className="mt-6 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">
              Running locally, where any number works: the first code you use with a number becomes its code.
            </p>
          )}
        </form>
      )}
    </main>
  );
}
