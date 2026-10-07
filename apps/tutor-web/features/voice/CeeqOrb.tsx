"use client";

import { useEffect, useRef } from "react";
import type { VoiceActivity } from "./useCeeqVoice";

const LABEL: Record<VoiceActivity, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/** Ceeq's presence: an orb that breathes, listens and moves with her voice in real time. */
export function CeeqOrb({
  activity,
  getLevel,
  size = 56,
  showLabel = true,
}: {
  activity: VoiceActivity;
  getLevel: () => number;
  size?: number;
  showLabel?: boolean;
}) {
  const coreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activity !== "speaking") {
      coreRef.current?.style.setProperty("--level", "0");
      return;
    }
    let frame = 0;
    let smooth = 0;
    const tick = () => {
      smooth += (getLevel() - smooth) * 0.35;
      coreRef.current?.style.setProperty("--level", smooth.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activity, getLevel]);

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
        {activity === "listening" && <div className="absolute inset-0 animate-ping rounded-full bg-accent opacity-20" />}
        {activity === "thinking" && (
          <div
            className="absolute -inset-1 rounded-full"
            style={{
              background: "conic-gradient(from 0deg, transparent, var(--accent), transparent 60%)",
              animation: "spin-slow 1.1s linear infinite",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
            }}
          />
        )}
        <div
          ref={coreRef}
          className="absolute inset-0 rounded-full transition-transform duration-75"
          style={{
            background: "radial-gradient(circle at 35% 30%, color-mix(in oklab, var(--accent) 55%, white), var(--accent) 70%)",
            transform: "scale(calc(1 + var(--level, 0) * 0.28))",
            boxShadow: "0 6px 24px -6px var(--accent)",
            animation: activity === "idle" ? "breathe 3.2s ease-in-out infinite" : undefined,
          }}
        />
      </div>
      {showLabel && (
        <div className="leading-tight">
          <div className="font-semibold">Ceeq</div>
          <div className="text-sm text-muted" aria-live="polite">{LABEL[activity]}</div>
        </div>
      )}
    </div>
  );
}
