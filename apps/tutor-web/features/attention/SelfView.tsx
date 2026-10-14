import { useEffect, useRef } from "react";
import { Icon } from "@/features/ui";
import type { Sight } from "./attention";
import type { CameraState } from "./useCamera";

const SAYS: Record<Sight, string> = {
  here: "You’re in view",
  away: "Ceeq can’t see you",
  turned: "Face the screen",
};

/**
 * The student's own camera picture, so that they can see it is on and whether
 * they are in view: its ring is green when they are, amber when not. If the
 * camera went off in the middle of the lesson, a button to turn it back on.
 * `compact` is the small round one for phones.
 */
export function SelfView({
  stream,
  sight,
  state,
  onTurnOn,
  compact = false,
}: {
  stream: MediaStream | null;
  sight: Sight | null;
  state: CameraState;
  onTurnOn: () => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
  }, [stream]);

  if (state === "lost") {
    return (
      <button
        type="button"
        onClick={onTurnOn}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-(--ink-amber) px-2.5 py-1.5 text-sm font-medium hover:bg-surface-2"
      >
        <Icon name="camera" className="h-4 w-4" />
        Turn camera on
      </button>
    );
  }
  if (!stream) return null;
  const ring = sight === null ? "ring-line" : sight === "here" ? "ring-(--ink-green)" : "ring-(--ink-amber)";
  const label = sight ? SAYS[sight] : "Camera on";
  const video = (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      aria-label={`Your camera: ${label}`}
      // Mirrored, as people expect to see themselves.
      className={`-scale-x-100 bg-surface-2 object-cover ring-2 transition-shadow ${ring} ${compact ? "h-9 w-9 rounded-full" : "h-18 w-24 rounded-xl"}`}
    />
  );
  if (compact) {
    return (
      <span title={label} className="flex shrink-0">
        {video}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {video}
      <div className="min-w-0 text-sm">
        <div className="font-medium">{label}</div>
        <div className="text-muted">Used on this device only. Nothing is recorded.</div>
      </div>
    </div>
  );
}
