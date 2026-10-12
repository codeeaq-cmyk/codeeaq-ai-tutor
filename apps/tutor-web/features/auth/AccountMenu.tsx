"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/features/ui";
import { signOutStudent, useAccount } from "@/lib/account";
import { formatPhone } from "@/lib/phone";

/** Shows which number is signed in, with a way to sign out. */
export function AccountMenu() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (account.status !== "signed-in") return null;
  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Your account"
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted hover:border-muted hover:text-fg"
      >
        <Icon name="user" className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-3 py-2">
            <div className="text-xs text-muted">Signed in as</div>
            <div className="font-medium tabular-nums">{formatPhone(account.phone)}</div>
          </div>
          <button
            role="menuitem"
            onClick={() => void signOutStudent()}
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-surface-2"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
