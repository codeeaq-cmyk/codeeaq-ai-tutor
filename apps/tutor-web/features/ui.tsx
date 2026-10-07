import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Wordmark({ href = "/learn" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        className="h-5 w-5 rounded-full"
        style={{ background: "radial-gradient(circle at 35% 30%, color-mix(in oklab, var(--accent) 55%, white), var(--accent) 70%)" }}
      />
      ceeq
    </Link>
  );
}

export function Chip({
  selected,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
        selected ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:border-muted"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

export function ProgressRing({ value, size = 28 }: { value: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={3} />
      {value > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={value >= 1 ? "var(--ink-green)" : "var(--accent)"}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${c * value} ${c}`}
        />
      )}
    </svg>
  );
}

export function Icon({ name, className = "h-5 w-5" }: { name: "back" | "mic" | "mic-off" | "send" | "chevron" | "check" | "stop"; className?: string }) {
  const paths: Record<typeof name, ReactNode> = {
    back: <path d="M15 18l-6-6 6-6" />,
    chevron: <path d="M9 18l6-6-6-6" />,
    check: <path d="M20 6L9 17l-5-5" />,
    send: <path d="M5 12h14M13 6l6 6-6 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0014 0M12 18v3" />
      </>
    ),
    "mic-off": (
      <>
        <path d="M15 9.3V6a3 3 0 00-5.7-1.3M9 9v2a3 3 0 004.8 2.4M19 11a7 7 0 01-1.2 3.9M5 11a7 7 0 0010.5 6M12 18v3M3 3l18 18" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}
