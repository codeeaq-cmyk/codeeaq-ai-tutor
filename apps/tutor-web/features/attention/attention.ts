// Whether the student is with the lesson, from what their camera shows. The
// camera is looked at on the student's own device, a couple of times a second;
// nothing it shows is kept or sent anywhere. Ceeq is told only the upshot, in a
// note: that the student has not been in view for a while, or that they are
// back (see lessonFlow.ts).
//
// Looking down is not looking away: students write notes from the board. Only
// a face that has gone, or has turned well to one side, counts as not being
// there, and only once it has lasted long enough to be more than a glance.

/** What one look at the camera shows: the student facing the screen, nobody, or someone turned well aside. */
export type Sight = "here" | "away" | "turned";
/** Why the student is taken not to be with the lesson. */
export type Lapse = Exclude<Sight, "here">;

/** Out of view this long, Ceeq checks in with the student. */
export const CHECK_IN_MS = 20_000;
/** Out of view this long, the lesson is paused until they are back. */
export const PAUSE_MS = 60_000;
/** Back in view for this long counts as back: a face caught for a moment as someone passes does not. */
export const BACK_MS = 1_500;

/**
 * How far the nose may sit from the middle of the eyes, in eye-widths, before
 * the head is taken to be turned aside. Facing the screen it sits close to the
 * middle; it reaches 0.45 at a turn of about 50 degrees. Turned much further,
 * the face is no longer found at all.
 */
export const TURNED_AT = 0.45;

/** A face as the detector reports it: its box, and its keypoints (right eye, left eye, nose tip, …) in fractions of the picture. */
export interface FoundFace {
  boundingBox?: { width: number; height: number };
  keypoints: { x: number; y: number }[];
}

/** What one look at the camera shows. Of several faces, the largest is the student's. */
export function sightOf(faces: FoundFace[]): Sight {
  const area = (f: FoundFace) => (f.boundingBox ? f.boundingBox.width * f.boundingBox.height : 0);
  const face = faces.reduce<FoundFace | undefined>((best, f) => (!best || area(f) > area(best) ? f : best), undefined);
  if (!face) return "away";
  const [rightEye, leftEye, nose] = face.keypoints;
  // Without its eyes and nose, a face cannot be judged: it is given the benefit of the doubt.
  if (!rightEye || !leftEye || !nose) return "here";
  const eyes = Math.abs(leftEye.x - rightEye.x);
  if (eyes < 1e-3) return "turned";
  return Math.abs(nose.x - (leftEye.x + rightEye.x) / 2) / eyes > TURNED_AT ? "turned" : "here";
}

/** What has changed about the student, if anything, with a look or with something they said. */
export type Change =
  /** Out of view long enough for Ceeq to check in with them. */
  | { kind: "check-in"; why: Lapse }
  /** Out of view long enough to pause the lesson. */
  | { kind: "pause"; why: Lapse }
  /** Back, after Ceeq had checked in (`from` "checked") or the lesson had been paused ("paused"). */
  | { kind: "back"; from: "checked" | "paused"; awayMs: number };

/**
 * Keeps watch over one sitting. It is given each look at the camera, and told
 * when the student speaks or types (which shows they are there whatever the
 * camera says), and says when something should be done about it.
 */
export class Watch {
  private seenAt: number;
  private stage: "with" | "checked" | "paused" = "with";
  /** Since when the student has been back in view, while they were taken to be away. */
  private backSince: number | null = null;

  constructor(now: number) {
    this.seenAt = now;
  }

  /** Watching starts afresh: time spent paused by the student, or at the quiz, is not held against them. */
  reset(now: number): void {
    this.seenAt = now;
    this.stage = "with";
    this.backSince = null;
  }

  /** Whether the student is taken to be with the lesson. */
  get with(): boolean {
    return this.stage === "with";
  }

  /** The student spoke or typed: they are with the lesson. */
  heard(now: number): Change | null {
    if (this.stage !== "with") return this.welcome(now, now);
    this.seenAt = now;
    return null;
  }

  /** One look at the camera. */
  look(sight: Sight, now: number): Change | null {
    if (sight === "here") {
      if (this.stage === "with") {
        this.seenAt = now;
        return null;
      }
      this.backSince ??= now;
      return now - this.backSince >= BACK_MS ? this.welcome(this.backSince, now) : null;
    }
    this.backSince = null;
    const gone = now - this.seenAt;
    if (this.stage === "with" && gone >= CHECK_IN_MS) {
      this.stage = "checked";
      return { kind: "check-in", why: sight };
    }
    if (this.stage === "checked" && gone >= PAUSE_MS) {
      this.stage = "paused";
      return { kind: "pause", why: sight };
    }
    return null;
  }

  /** The student is back: `since` is when they came back, which ends the time they were away. */
  private welcome(since: number, now: number): Change {
    const from = this.stage === "paused" ? "paused" : "checked";
    const awayMs = Math.max(0, since - this.seenAt);
    this.reset(now);
    return { kind: "back", from, awayMs };
  }
}
