"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "@/lib/account";

/**
 * Shows the app only to a signed-in student. Anyone else is sent to sign in,
 * and brought back to the page they wanted afterwards.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const account = useAccount();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/login";
  const signedOut = account.status === "signed-out";

  useEffect(() => {
    if (!signedOut || onLogin) return;
    const from = pathname + window.location.search;
    router.replace(from === "/" ? "/login" : `/login?next=${encodeURIComponent(from)}`);
  }, [signedOut, onLogin, pathname, router]);

  // The sign-in page looks after its own states.
  if (onLogin) return children;
  if (account.status === "signed-in" && account.ready) return children;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center" aria-busy>
      <span className="skeleton h-10 w-10 rounded-full" />
      {/* Only a device new to the student waits here long enough to read this. */}
      {account.status === "signed-in" && <p className="text-muted">Getting your lessons…</p>}
    </main>
  );
}
