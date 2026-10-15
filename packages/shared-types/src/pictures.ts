import type { ChapterRef } from './lesson.js';
import { slugify } from './syllabus.js';

// Pictures for a module, so that a student sees the real thing: a leaf with
// its parts named, a circuit, a cell. A process (a seed germinating, the water
// cycle) can be a picture that builds up stage by stage, like an animation.
// They are drawn before the lesson by an image model, each checked by a second
// model against what it must show (every label there, spelled right, pointing
// at the right part) and drawn again if the check finds anything wrong. Only
// pictures that pass are kept, once per module, for every student who takes
// it. Ceeq teaches from them; she never draws them herself. Flowcharts are not
// pictures: the board draws those itself, box by box, so every word is exact.

export const MAX_MODULE_PICTURES = 4;
export const MAX_PICTURE_LABELS = 8;
export const MAX_PICTURE_STAGES = 4;

/** A prepared picture, without the picture itself: what Ceeq is told about it. */
export interface PictureNote {
  /** A short id, e.g. "leaf-parts". */
  id: string;
  /** The goal it teaches, counted from 0. */
  goal: number;
  /** Its caption on the board, e.g. "Parts of a leaf". */
  title: string;
  /** What it shows, in a sentence. */
  shows: string;
  /** The words written on it, each pointing at a part, in the order they are best taught. */
  labels: string[];
  /** For a picture that builds up: what each stage adds, in order. The last stage completes it. */
  stages?: string[];
}

export interface ModulePicture extends PictureNote {
  /** The picture itself, complete, as a data: URL. */
  src: string;
  /** For a picture that builds up: how it looks after each stage but the last, in order, as data: URLs. */
  frames?: string[];
}

export interface GetPicturesRequest extends ChapterRef {
  module: { title: string; goals: string[] };
}

export interface GetPicturesResponse {
  /**
   * ready: these are the module's pictures (a module may have none);
   * drawing: they are being drawn now, so ask again shortly;
   * unavailable: none can be drawn just now. The lesson goes on without them.
   */
  status: 'ready' | 'drawing' | 'unavailable';
  pictures: ModulePicture[];
}

const PICTURE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A picture's id made from whatever it is called: lowercase words joined by hyphens. */
export function pictureId(text: string, fallback: string): string {
  if (!/[a-z0-9]/i.test(text)) return fallback;
  const id = slugify(text).slice(0, 40).replace(/-+$/, '');
  return PICTURE_ID.test(id) ? id : fallback;
}

const line = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

/**
 * Checks what a browser says of a module's pictures when a lesson starts, so
 * that Ceeq can be told about them. Null if anything in it is malformed.
 */
export function parsePictureNotes(value: unknown, goalCount: number): PictureNote[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MODULE_PICTURES) return null;
  const notes: PictureNote[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, goal, title, shows, labels, stages } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !PICTURE_ID.test(id)) return null;
    if (typeof goal !== 'number' || !Number.isInteger(goal) || goal < 0 || goal >= goalCount) return null;
    const caption = line(title, 80);
    const what = line(shows, 300);
    if (!caption || !what || !Array.isArray(labels) || labels.length > MAX_PICTURE_LABELS) return null;
    const names = labels.map((l) => line(l, 40));
    if (names.some((n) => n === null)) return null;
    if (stages !== undefined && (!Array.isArray(stages) || stages.length < 2 || stages.length > MAX_PICTURE_STAGES)) return null;
    const steps = (stages ?? []).map((s) => line(s, 160));
    if (steps.some((s) => s === null)) return null;
    notes.push({ id, goal, title: caption, shows: what, labels: names as string[], ...(steps.length ? { stages: steps as string[] } : {}) });
  }
  return notes;
}
