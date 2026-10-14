import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { sightOf, type Sight } from "./attention";

// The student's camera, and the face detector that looks at it. A lesson needs
// the camera, so that Ceeq can tell whether the student is with her. What it
// shows never leaves the device: Google's MediaPipe finds the face in the
// browser itself, a couple of times a second, and only "here", "away" or
// "turned" comes out of it (see attention.ts). Nothing is recorded.

/** The version of @mediapipe/tasks-vision installed, whose engine is fetched from the CDN to match. */
export const ENGINE_VERSION = "1.1.0";
/** The engine that runs the detector (about 3.5 MB, cached for a year once fetched). Too big to keep in the app. */
const ENGINE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ENGINE_VERSION}/wasm`;
/** Google's face detector for faces within a couple of metres of the camera (230 KB), kept in the app. */
const MODEL = "/models/blaze_face_short_range.tflite";
/** How often the camera is looked at. */
const LOOK_MS = 500;

/**
 * Where the camera stands: off; being asked for; on; refused by the student or
 * the browser ("blocked"); not there at all ("missing"); there but not to be
 * had, usually because another app has it ("busy"); or gone off in the middle
 * of the lesson ("lost"), from the browser's own control, say.
 */
export type CameraState = "off" | "starting" | "on" | "blocked" | "missing" | "busy" | "lost";

let detecting: Promise<FaceDetector> | null = null;
/** Each look must be stamped later than the last, for every camera the detector has looked at. */
let lastLookAt = 0;

/** The face detector, loaded the first time it is needed. On the graphics chip if it can be, otherwise on the processor. */
function loadDetector(): Promise<FaceDetector> {
  detecting ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const engine = await FilesetResolver.forVisionTasks(ENGINE);
    const make = (delegate: "GPU" | "CPU") =>
      FaceDetector.createFromOptions(engine, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", minDetectionConfidence: 0.5 });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })().catch((err: unknown) => {
    // Tried again next time: the network may be back.
    detecting = null;
    throw err;
  });
  return detecting;
}

/**
 * The camera for a lesson. `onSight` is told what each look shows. `sight` is
 * the latest, for showing the student; null until the detector has looked.
 */
export function useCamera(onSight: (sight: Sight, now: number) => void) {
  const [state, setState] = useState<CameraState>("off");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sight, setSight] = useState<Sight | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stateRef = useRef(state);
  const askingRef = useRef<Promise<boolean> | null>(null);
  const sightRef = useRef(onSight);
  useEffect(() => {
    sightRef.current = onSight;
  }, [onSight]);
  const enter = useCallback((next: CameraState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const drop = useCallback(() => {
    const old = streamRef.current;
    streamRef.current = null;
    old?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    setStream(null);
    setSight(null);
  }, []);

  /** Puts the camera away, and with it the light that says it is on. */
  const turnOff = useCallback(() => {
    drop();
    if (stateRef.current !== "off") enter("off");
  }, [drop, enter]);

  /** Asks for the camera, if it is not on already. True once it is on. */
  const turnOn = useCallback((): Promise<boolean> => {
    if (streamRef.current?.getVideoTracks().some((track) => track.readyState === "live")) return Promise.resolve(true);
    if (askingRef.current) return askingRef.current;
    enter("starting");
    const asking = (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          enter("missing");
          return false;
        }
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        drop();
        streamRef.current = media;
        media.getVideoTracks().forEach((track) => {
          // Turned off from outside the app: the browser's own control, the device, another app taking it.
          track.onended = () => {
            if (streamRef.current !== media) return;
            drop();
            enter("lost");
          };
        });
        setStream(media);
        enter("on");
        return true;
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        enter(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : name === "NotFoundError" || name === "OverconstrainedError" ? "missing" : "busy");
        return false;
      } finally {
        askingRef.current = null;
      }
    })();
    askingRef.current = asking;
    return asking;
  }, [drop, enter]);

  // Looks at the camera while it is on.
  useEffect(() => {
    if (!stream) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    // A video of its own to look at: kept in the page, as some browsers stop showing one that is not, but out of sight.
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    video.srcObject = stream;
    document.body.append(video);
    void video.play().catch(() => {});
    loadDetector().then(
      (detector) => {
        if (stopped) return;
        timer = setInterval(() => {
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          lastLookAt = Math.max(performance.now(), lastLookAt + 1);
          let seen: Sight;
          try {
            seen = sightOf(detector.detectForVideo(video, lastLookAt).detections);
          } catch {
            return;
          }
          setSight(seen);
          sightRef.current(seen, Date.now());
        }, LOOK_MS);
      },
      // Without the detector the lesson goes on, unwatched: the student is not to be held up by the network.
      (err: unknown) => console.warn("Ceeq cannot look for the student's face:", err),
    );
    return () => {
      stopped = true;
      clearInterval(timer);
      video.srcObject = null;
      video.remove();
    };
  }, [stream]);

  // Leaving the page puts the camera away.
  useEffect(() => drop, [drop]);

  return { state, stream, sight, turnOn, turnOff, getState: () => stateRef.current };
}
