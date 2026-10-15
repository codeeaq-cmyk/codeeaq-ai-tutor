import type { ModulePicture } from '@codeeaq/shared-types';
import { GoogleGenAI, type ContentListUnion } from '@google/genai';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import sharp from 'sharp';
import type { Ask } from './ai';
import {
  buildPicturePlanPrompt,
  CHECK_SHAPE,
  dataUrl,
  DRAWING_MS,
  parsePicturePlan,
  parseVerdict,
  PICTURE_PLAN_SHAPE,
  type Image,
  type PictureMaker,
  type PictureStore,
  type StoredModule,
  type StoredNote,
  type Verdict,
} from './pictures';

// What pictures.ts needs from outside: Google's models to plan, draw, change
// and check pictures, a way to make them small, and somewhere to keep them.

/** Drawing one picture can take a while on a busy day. */
const DRAW_TIMEOUT_MS = 150_000;
const CHECK_TIMEOUT_MS = 90_000;
/** A kept picture must fit in one database document (1 MiB) with room to spare. */
const MAX_IMAGE_BYTES = 700_000;

/** Makes a drawing small enough to keep and send: at most 1280 pixels across, as WebP, which keeps the names sharp. */
export async function shrink(image: Image): Promise<Image> {
  for (const quality of [88, 76, 64]) {
    const data = await sharp(image.data).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
    if (data.length <= MAX_IMAGE_BYTES) return { data, mimeType: 'image/webp' };
  }
  throw new Error('The picture is too large to keep');
}

const withImage = (image: Image, prompt: string): ContentListUnion => [
  { role: 'user', parts: [{ inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } }, { text: prompt }] },
];

/**
 * Google's models at work on pictures. The image models are tried in order:
 * the next is asked if one refuses (quota, load) or fails. Every checking
 * model looks at each picture, and it passes only if all those that answer
 * pass it: they notice different things (in a trial, one let through a "Leaf
 * base" pointing at the wrong place that the other caught). A picture is never
 * passed unchecked: if no checker answers, the attempt fails.
 */
export function geminiPictureMaker(apiKey: string, ask: Ask, imageModels: string[], checkModels: string[]): PictureMaker {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });

  async function image(contents: ContentListUnion, purpose: string): Promise<Image> {
    let last: unknown = new Error('No image model is configured');
    for (const model of imageModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:3' }, abortSignal: AbortSignal.timeout(DRAW_TIMEOUT_MS) },
        });
        const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (part?.inlineData?.data) return { data: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType ?? 'image/png' };
        last = new Error(`${model} gave no picture (${response.candidates?.[0]?.finishReason ?? 'no reason given'})`);
      } catch (err) {
        last = err;
      }
      logger.warn('Image model attempt failed', { model, purpose, err: String(last).slice(0, 300) });
    }
    throw last;
  }

  return {
    plan: (request) => ask(buildPicturePlanPrompt(request), (text) => parsePicturePlan(text, request.module.goals.length), PICTURE_PLAN_SHAPE),
    draw: (prompt) => image(prompt, 'draw'),
    edit: (picture, prompt) => image(withImage(picture, prompt), 'edit'),
    async check(picture, prompt) {
      let last: unknown = new Error('No checking model is configured');
      const verdicts = await Promise.all(
        checkModels.map(async (model) => {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: withImage(picture, prompt),
              config: { responseMimeType: 'application/json', responseSchema: CHECK_SHAPE, temperature: 0, abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
            });
            const verdict = parseVerdict(response.text ?? '');
            if (!verdict.ok) logger.info('Picture turned down by a checker', { model, problems: verdict.problems.slice(0, 6) });
            return verdict;
          } catch (err) {
            last = err;
            logger.warn('Checking model attempt failed', { model, err: String(err).slice(0, 300) });
            return null;
          }
        }),
      );
      const answered = verdicts.filter((v): v is Verdict => v !== null);
      if (!answered.length) throw last;
      return { ok: answered.every((v) => v.ok), problems: answered.flatMap((v) => v.problems) };
    },
    shrink,
  };
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A plain card with a few lines on it, as an image. */
async function card(heading: string, lines: string[]): Promise<Image> {
  const text = lines
    .slice(0, 9)
    .map((l, i) => `<text x="60" y="${250 + i * 46}" font-size="30" fill="#333">${escapeXml(l.slice(0, 70))}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="1024" height="768" fill="#ffffff"/><rect x="20" y="20" width="984" height="728" fill="none" stroke="#c9c9c9" stroke-width="4" stroke-dasharray="18 12"/><text x="60" y="110" font-size="26" fill="#a33">STAND-IN PICTURE (local testing only)</text><text x="60" y="175" font-size="40" font-weight="bold" fill="#111">${escapeXml(heading.slice(0, 48))}</text>${text}</svg>`;
  return { data: await sharp(Buffer.from(svg)).png().toBuffer(), mimeType: 'image/png' };
}

/**
 * For trying the app on the emulators before an image model can be used: the
 * pictures are planned for real, but drawn as plain cards that say what the
 * real ones would show, and passed without a check. Never used in production.
 */
export function standInPictureMaker(ask: Ask): PictureMaker {
  const brief = (prompt: string) => /What to draw: (.*)/.exec(prompt)?.[1] ?? '';
  const names = (prompt: string) => /spelled exactly as written here: (.*?)\./.exec(prompt)?.[1] ?? '';
  const wrap = (text: string) => text.match(/.{1,60}(\s|$)/g)?.map((l) => l.trim()) ?? [];
  return {
    plan: (request) => ask(buildPicturePlanPrompt(request), (text) => parsePicturePlan(text, request.module.goals.length), PICTURE_PLAN_SHAPE),
    draw: (prompt) => card(brief(prompt).slice(0, 48), [...wrap(brief(prompt)).slice(0, 5), '', `Names: ${names(prompt)}`]),
    edit: (_image, prompt) => card('An earlier stage', wrap(prompt.replace(/Leave everything.*/s, ''))),
    check: async () => ({ ok: true, problems: [] }),
    shrink,
  };
}

/**
 * Keeps each module's pictures in the database, for every student who takes
 * the module: what they show in modulePictures/{key}, and the pictures
 * themselves, one document each, in pictureImages. Only the functions read or
 * write them (the security rules give students no access).
 */
export function firestorePictureStore(): PictureStore {
  let db: Firestore | undefined;
  const database = () => {
    if (!db) {
      if (!getApps().length) initializeApp();
      db = getFirestore();
    }
    return db;
  };
  const modules = () => database().collection('modulePictures');
  const images = () => database().collection('pictureImages');
  const imageDoc = (key: string, id: string, frame?: number) => images().doc(`${key}-${id}${frame === undefined ? '' : `-${frame}`}`);
  const keep = (key: string, id: string, image: Image, frame?: number) => imageDoc(key, id, frame).set({ mimeType: image.mimeType, data: image.data });
  const load = async (key: string, id: string, frame?: number) => {
    const doc = (await imageDoc(key, id, frame).get()).data();
    if (!doc || !Buffer.isBuffer(doc.data) || typeof doc.mimeType !== 'string') throw new Error(`A kept picture is missing: ${id}`);
    return dataUrl({ data: doc.data, mimeType: doc.mimeType });
  };

  return {
    async read(key) {
      const doc = await modules().doc(key).get();
      return doc.exists ? (doc.data() as StoredModule) : null;
    },
    claim(key, now) {
      return database().runTransaction(async (tx) => {
        const ref = modules().doc(key);
        const kept = (await tx.get(ref)).data() as StoredModule | undefined;
        if (kept?.status === 'ready') return false;
        if (kept?.status === 'drawing' && now - kept.startedAt < DRAWING_MS) return false;
        if (kept?.status === 'failed' && (kept.retryAt ?? 0) > now) return false;
        tx.set(ref, { status: 'drawing', startedAt: now, notes: [] } satisfies StoredModule);
        return true;
      });
    },
    async save(key, drawn, now) {
      // One at a time would be slow, and all in one batch could pass the limit on a batch's size.
      await Promise.all(drawn.flatMap(({ note, image, frames }) => [keep(key, note.id, image), ...(frames ?? []).map((f, i) => keep(key, note.id, f, i))]));
      const notes: StoredNote[] = drawn.map(({ note, frames }) => ({ ...note, ...(frames?.length ? { frames: frames.length } : {}) }));
      await modules().doc(key).set({ status: 'ready', startedAt: now, notes } satisfies StoredModule);
    },
    async fail(key, retryAt) {
      await modules().doc(key).set({ status: 'failed', startedAt: Date.now(), notes: [], retryAt } satisfies StoredModule);
    },
    images(key, notes) {
      return Promise.all(
        notes.map(async ({ frames = 0, ...note }): Promise<ModulePicture> => {
          const src = await load(key, note.id);
          const before = await Promise.all(Array.from({ length: frames }, (_, i) => load(key, note.id, i)));
          return { ...note, src, ...(before.length ? { frames: before } : {}) };
        }),
      );
    },
  };
}
