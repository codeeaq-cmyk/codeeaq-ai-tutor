import { createHash } from 'node:crypto';
import {
  boardName,
  MAX_MODULE_PICTURES,
  MAX_PICTURE_LABELS,
  MAX_PICTURE_STAGES,
  pictureId,
  streamName,
  type GetPicturesRequest,
  type GetPicturesResponse,
  type ModulePicture,
  type PictureNote,
} from '@codeeaq/shared-types';
import { Type, type Schema } from '@google/genai';
import { extractJson, plain } from './ai';

// The pictures a module is taught from. A student must never be left in doubt
// by one, so each goes through three hands before anyone sees it:
//   1. a text model plans them: which real things the student must see, what
//      each must show, and the textbook's names for its parts;
//   2. an image model draws each one, in the style of a textbook figure;
//   3. a second model looks at the drawing and checks it against the plan:
//      every label there and spelled right, each pointing at the right part,
//      nothing wrong or extra. What it finds wrong goes into the next drawing.
// A picture that has not passed after a few drawings is dropped: the lesson
// does without it. Those that pass are kept, and every student who takes the
// module is shown the same ones.
//
// A process is best seen building up. For one, its first stage is drawn and
// checked; then each stage is added to the frame before it, so that every
// frame matches the others, and each frame is checked in turn, the last as the
// complete picture. (Taking stages away from a finished picture was tried
// first: image models leave too much behind.) If any frame fails, a complete
// picture is drawn and shown on its own.

/** One stage of a picture that builds up: what it adds, and the names that come with it. */
export interface StageSpec {
  adds: string;
  labels: string[];
}

/** A picture as planned, before it is drawn: what Ceeq will be told of it, and the brief it is drawn from. */
export interface PictureSpec extends Omit<PictureNote, 'stages'> {
  draw: string;
  /** For a picture that builds up: its stages, in order. */
  stages?: StageSpec[];
}

export interface Image {
  data: Buffer;
  mimeType: string;
}

/** What the checker made of a drawing. */
export interface Verdict {
  ok: boolean;
  problems: string[];
}

/** The hands a picture goes through. */
export interface PictureMaker {
  plan(request: GetPicturesRequest): Promise<PictureSpec[]>;
  draw(prompt: string): Promise<Image>;
  /** Changes a drawing as the prompt says, leaving the rest as it was. */
  edit(image: Image, prompt: string): Promise<Image>;
  check(image: Image, prompt: string): Promise<Verdict>;
  /** Makes a drawing small enough to keep and send, without spoiling its words. */
  shrink(image: Image): Promise<Image>;
}

/**
 * How many times a picture is drawn before it is given up. A busy figure (the
 * digestive system, with eight names) often needs a few: each drawing tends to
 * get something different wrong, and the checkers' findings go into the next.
 */
export const DRAWINGS = 4;
/**
 * Changed whenever the way pictures are planned, drawn or checked changes, so
 * that every module's pictures are made again the new way.
 */
export const PICTURE_STYLE = 1;

function describe({ profile, subject, chapter, unit }: GetPicturesRequest): { cls: string; where: string } {
  const cls = [boardName(profile.board), `Class ${profile.classLevel}`, streamName(profile.stream)].filter(Boolean).join(', ');
  return { cls, where: `${cls} ${plain(subject, 60)}${unit ? ` (${plain(unit, 60)})` : ''}, chapter "${plain(chapter)}"` };
}

// ---------- 1. Planning ----------

const TEXT: Schema = { type: Type.STRING };
export const PICTURE_PLAN_SHAPE: Schema = {
  type: Type.OBJECT,
  properties: {
    pictures: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          goal: { type: Type.INTEGER },
          id: TEXT,
          title: TEXT,
          shows: TEXT,
          draw: TEXT,
          labels: { type: Type.ARRAY, items: TEXT },
          stages: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { adds: TEXT, labels: { type: Type.ARRAY, items: TEXT } }, required: ['adds', 'labels'] },
          },
        },
        required: ['goal', 'id', 'title', 'shows', 'draw', 'labels'],
      },
    },
  },
  required: ['pictures'],
};

export function buildPicturePlanPrompt(request: GetPicturesRequest): string {
  const goals = request.module.goals.map((g, i) => `${i + 1}. ${plain(g, 160)}`).join('\n');
  return `You are preparing the pictures for one module of a lesson: ${describe(request).where}, module "${plain(request.module.title)}". Its goals:
${goals}

A tutor teaches each goal on a whiteboard and talks the student through the picture for it. Choose the pictures the student must SEE to understand this module: the real things it is about (a structure and its parts, an organism, an apparatus or experiment set-up, a circuit, a map, a process in a real setting), drawn as the prescribed textbook shows them. Make one picture for each goal that has something to look at, showing what that goal itself is about, and give it that goal's number (the first goal above is 1). Never put two goals into one picture, and never leave a goal with something to see without its own. None for a goal that is only a definition, a rule, a calculation or an idea with nothing to see. At most ${MAX_MODULE_PICTURES} in all.

For each picture:
- "goal": the number of the goal it teaches.
- "id": a short lowercase id with hyphens, e.g. "leaf-parts".
- "title": its caption, at most 6 words, e.g. "Parts of a leaf".
- "shows": one sentence saying what it shows, for the tutor.
- "draw": a precise brief for the illustrator: what to draw, seen from where, what each part looks like and where it is, so that the drawing matches the textbook in every detail. Mention only the parts in "labels", and what must be there for them to make sense (left unnamed).
- "labels": the names to write on it, exactly as the textbook names the parts, in the order they are best taught: the 2 to 6 that matter most for the goal (a few clear names teach better than many), or none if the picture needs no names. If it shows two or more things side by side (two states, such as an open and a closed stomatal pore, or two kinds), give each its own name too, so that the student can tell which is which.
- "stages": for a process or a sequence in a real setting that is best seen building up (a seed germinating, the water cycle, food passing through the gut), and always when the goal asks the student to trace, follow or describe the steps of something: its 2 to ${MAX_PICTURE_STAGES} stages in order, each with "adds" (what that stage adds, said as the tutor would say it, e.g. "The root grows down from the seed", never as an instruction to the illustrator) and "labels" (the names that come with it). Together the stages' labels are the picture's labels. Leave "stages" empty for anything else, such as a structure and its parts.

Do not make pictures of flowcharts, tables, word diagrams, graphs or formulas: the tutor draws those on the board herself.
Everything must be correct for this class and board's textbook, and nothing may go beyond the syllabus.

Reply with JSON only, in exactly this shape:
{"pictures": [{"goal": 1, "id": "<id>", "title": "<caption>", "shows": "<sentence>", "draw": "<brief>", "labels": ["<part>"], "stages": [{"adds": "<what>", "labels": ["<part>"]}]}]}`;
}

/** The planned pictures, checked; malformed ones are left out. */
export function parsePicturePlan(text: string, goalCount: number): PictureSpec[] {
  const raw = extractJson(text).pictures;
  if (!Array.isArray(raw)) throw new Error('Reply has no pictures');
  const line = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const specs: PictureSpec[] = [];
  for (const item of raw) {
    if (specs.length >= MAX_MODULE_PICTURES || typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    const goal = typeof v.goal === 'number' && Number.isInteger(v.goal) ? v.goal - 1 : -1;
    const title = line(v.title, 80);
    const shows = line(v.shows, 300);
    const draw = line(v.draw, 1500);
    if (goal < 0 || goal >= goalCount || !title || !shows || !draw) continue;
    const labels = (Array.isArray(v.labels) ? v.labels : []).map((l) => line(l, 40)).filter(Boolean).slice(0, MAX_PICTURE_LABELS);
    let id = pictureId(line(v.id, 60) || title, `picture-${specs.length + 1}`);
    while (specs.some((s) => s.id === id)) id = `${id.slice(0, 36)}-${specs.length + 1}`;
    // Stages only if there are enough of them, each adding something, and between them naming every part.
    const stages = (Array.isArray(v.stages) ? v.stages : [])
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({ adds: line(s.adds, 160), labels: (Array.isArray(s.labels) ? s.labels : []).map((l) => line(l, 40)).filter((l) => labels.includes(l)) }))
      .filter((s) => s.adds);
    const named = new Set(stages.flatMap((s) => s.labels));
    const builds = stages.length >= 2 && stages.length <= MAX_PICTURE_STAGES && labels.every((l) => named.has(l));
    specs.push({ id, goal, title, shows, draw, labels, ...(builds ? { stages } : {}) });
  }
  return specs;
}

// ---------- 2. Drawing ----------

/** How names of whole things are written, as against names of parts: said alike to the artist and to the checkers. */
const CAPTIONS =
  'If the picture shows two or more things side by side (two states or two kinds), the name of each whole thing is written centred under it as its caption, with no line.';

export function buildDrawPrompt(request: GetPicturesRequest, spec: PictureSpec, problems: string[] = []): string {
  const { cls } = describe(request);
  const names = spec.labels.length
    ? `Name exactly these parts and nothing else, spelled exactly as written here: ${spec.labels.join(', ')}. Each name sits beside the drawing, joined to its part by a thin straight line that ends exactly on that part. ${CAPTIONS}`
    : 'Write no words on it.';
  const avoid = problems.length ? `\nAn earlier drawing of this was rejected for these faults. This one must not have any of them:\n${problems.map((p) => `- ${plain(p, 300)}`).join('\n')}` : '';
  return `Draw one clear, accurate educational illustration for a ${cls} ${plain(request.subject, 60)} lesson, chapter "${plain(request.chapter)}".

What to draw: ${spec.draw}
${names}
No title, no caption, no numbers, no watermark, and no words other than those names.

Style: a clean, flat textbook figure like those in NCERT textbooks; soft natural colours; a plain white background; the subject large and centred, with room around it for the names; the names in a clear dark sans-serif font, large enough to read on a phone. Correct in every detail for the textbook: shapes, positions, numbers of parts, and colours where they matter.${avoid}`;
}

// ---------- 3. Checking ----------

export const CHECK_SHAPE: Schema = {
  type: Type.OBJECT,
  properties: { ok: { type: Type.BOOLEAN }, problems: { type: Type.ARRAY, items: TEXT } },
  required: ['ok', 'problems'],
};

export function buildCheckPrompt(request: GetPicturesRequest, spec: PictureSpec): string {
  const { cls } = describe(request);
  const names = spec.labels.length ? `Its names should be exactly these, and no other words: ${spec.labels.join(', ')}.` : 'It should have no words on it.';
  return `You are checking a picture before a school student sees it in a ${cls} ${plain(request.subject, 60)} lesson. If anything in it is wrong, the student will learn it wrong, so be strict.

It should show: ${spec.shows}
It was drawn from this brief: ${spec.draw}
${names}

Check:
1. Is every one of those names on it, spelled exactly right? Is there any other text, any misspelling, or any garbled lettering?
2. Does the line from each name end on the right part? (${CAPTIONS})
3. Is everything drawn correct for the textbook: shapes, positions, numbers of parts, colours where they matter?
4. Is anything confusing, misleading or unsuitable for a school student?

Reply with JSON only: {"ok": true or false, "problems": ["<each problem, in one sentence>"]}. "ok" is true only if there are no problems at all.`;
}

/** How a picture that builds up looks after its first `count` stages: what a frame is checked against. */
export function buildStageCheckPrompt(request: GetPicturesRequest, spec: PictureSpec, count: number): string {
  const { cls } = describe(request);
  const stages = spec.stages ?? [];
  const shown = stages.slice(0, count);
  const later = stages.slice(count);
  const names = shown.flatMap((s) => s.labels);
  return `You are checking one frame of a picture that builds up stage by stage, before a school student sees it in a ${cls} ${plain(request.subject, 60)} lesson. If anything in it is wrong, the student will learn it wrong, so be strict.

The complete picture shows: ${spec.shows}
This frame must show only its first ${count} ${count === 1 ? 'stage' : 'stages'}:
${shown.map((s, i) => `${i + 1}. ${s.adds}`).join('\n')}
None of what the later stages add may be on it yet:
${later.map((s, i) => `${count + i + 1}. ${s.adds}`).join('\n')}
${names.length ? `Its names should be exactly these, and no other words: ${names.join(', ')}.` : 'It should have no words on it.'}

Check:
1. Does it show exactly those stages, and nothing from the later ones?
2. Is every one of those names on it, spelled exactly right, with its line ending on the right part? Any other text, misspelling or garbled lettering?
3. Is everything drawn correct for the textbook?
4. Is anything confusing, misleading or unsuitable for a school student?

Reply with JSON only: {"ok": true or false, "problems": ["<each problem, in one sentence>"]}. "ok" is true only if there are no problems at all.`;
}

/** The first stage of a picture that builds up, drawn on its own with room for the rest. */
export function buildFirstStagePrompt(request: GetPicturesRequest, spec: PictureSpec, problems: string[] = []): string {
  const [first, ...later] = spec.stages ?? [];
  const brief = `${spec.draw}
This picture will be built up in stages. Draw only its first stage now: ${first.adds}. Leave room for what is added later, and draw none of it yet: ${later.map((s) => s.adds).join('; ')}.`;
  return buildDrawPrompt(request, { ...spec, draw: brief, labels: first.labels }, problems);
}

/** Adds the next stage to the frame before it. */
export function buildAddPrompt(stage: StageSpec, problems: string[] = []): string {
  const names = stage.labels.length
    ? ` Name what it adds, spelled exactly as written here: ${stage.labels.join(', ')}, each joined to its part by a thin straight line in the same style as the names already there.`
    : ' Add no words.';
  const avoid = problems.length ? `\nAn earlier attempt was rejected for these faults. This one must not have any of them:\n${problems.map((p) => `- ${plain(p, 300)}`).join('\n')}` : '';
  return `Add this to the picture: ${stage.adds}.${names} Leave everything already in it exactly as it is: the same drawing, in the same place, size, colours and style, with the same names. Draw it in the same clean, flat textbook style, on the same white background.${avoid}`;
}

export function parseVerdict(text: string): Verdict {
  const v = extractJson(text);
  const problems = (Array.isArray(v.problems) ? v.problems : []).filter((p): p is string => typeof p === 'string' && !!p.trim()).map((p) => p.trim());
  // A drawing passes only if the checker says so and has nothing against it.
  return { ok: v.ok === true && problems.length === 0, problems };
}

// ---------- The whole of it ----------

/** A picture that passed, ready to keep. */
export interface Drawn {
  note: PictureNote;
  image: Image;
  /** For a picture that builds up: how it looks after each stage but the last. */
  frames?: Image[];
}

/** Draws one picture until it passes the check, at most DRAWINGS times. Null if it never does. */
export async function drawChecked(maker: PictureMaker, request: GetPicturesRequest, spec: PictureSpec): Promise<Drawn | null> {
  let problems: string[] = [];
  for (let attempt = 1; attempt <= DRAWINGS; attempt++) {
    const image = await maker.shrink(await maker.draw(buildDrawPrompt(request, spec, problems)));
    // What is checked is what the student will see.
    const verdict = await maker.check(image, buildCheckPrompt(request, spec));
    if (verdict.ok) {
      const { draw: _brief, stages: _stages, ...note } = spec;
      return { note, image };
    }
    problems = verdict.problems.length ? verdict.problems : ['The checker did not accept it.'];
  }
  return null;
}

/** How many times each frame of a picture that builds up is made before the picture is shown complete instead. */
export const FRAME_TRIES = 2;

/**
 * A picture that builds up, frame by frame: its first stage drawn, then each
 * stage added to the frame before. Every frame is checked, the last as the
 * complete picture. Null if a frame never passes.
 */
export async function buildUp(maker: PictureMaker, request: GetPicturesRequest, spec: PictureSpec): Promise<{ frames: Image[]; complete: Image } | null> {
  const stages = spec.stages ?? [];
  if (stages.length < 2) return null;
  const frames: Image[] = [];
  for (let count = 1; count <= stages.length; count++) {
    const before = frames.at(-1);
    let problems: string[] = [];
    let frame: Image | null = null;
    for (let attempt = 1; attempt <= FRAME_TRIES && !frame; attempt++) {
      const made = before ? await maker.edit(before, buildAddPrompt(stages[count - 1], problems)) : await maker.draw(buildFirstStagePrompt(request, spec, problems));
      const image = await maker.shrink(made);
      const verdict = await maker.check(image, count === stages.length ? buildCheckPrompt(request, spec) : buildStageCheckPrompt(request, spec, count));
      if (verdict.ok) frame = image;
      else problems = verdict.problems.length ? verdict.problems : ['The checker did not accept it.'];
    }
    if (!frame) return null;
    frames.push(frame);
  }
  const complete = frames.pop()!;
  return { frames, complete };
}

/** One picture, checked: for a process, built up stage by stage if it can be, and otherwise complete. */
async function prepare(maker: PictureMaker, request: GetPicturesRequest, spec: PictureSpec): Promise<Drawn | null> {
  if (spec.stages) {
    const built = await buildUp(maker, request, spec);
    if (built) {
      const { draw: _brief, stages, ...note } = spec;
      return { note: { ...note, stages: stages.map((s) => s.adds) }, image: built.complete, frames: built.frames };
    }
  }
  // Without its frames it is still a good picture, shown complete.
  return drawChecked(maker, request, spec);
}

/** Plans the module's pictures and makes them all at once, keeping those that pass. */
export async function preparePictures(maker: PictureMaker, request: GetPicturesRequest): Promise<Drawn[]> {
  const specs = await maker.plan(request);
  const drawn = await Promise.all(specs.map((spec) => prepare(maker, request, spec)));
  return drawn.filter((d): d is Drawn => d !== null);
}

// ---------- Keeping them ----------

/** A kept picture, as recorded with its module. */
export type StoredNote = PictureNote & { frames?: number };

/** Where a module's pictures stand. */
export interface StoredModule {
  status: 'drawing' | 'ready' | 'failed';
  /** When they were last begun. */
  startedAt: number;
  /** What each kept picture shows, and how many frames it has before it is complete. */
  notes: StoredNote[];
  /** After a failure: when to try again. */
  retryAt?: number;
}

export interface PictureStore {
  read(key: string): Promise<StoredModule | null>;
  /** Marks the module's pictures as being drawn by this request. False if another request is drawing them already. */
  claim(key: string, now: number): Promise<boolean>;
  save(key: string, drawn: Drawn[], now: number): Promise<void>;
  fail(key: string, retryAt: number): Promise<void>;
  /** The kept pictures themselves. */
  images(key: string, notes: StoredNote[]): Promise<ModulePicture[]>;
}

/** A module's pictures are the same for every student of that board, class, subject and chapter. */
export function moduleKey(request: GetPicturesRequest): string {
  const { profile, subject, unit, chapter, module } = request;
  const parts = [PICTURE_STYLE, profile.board, profile.classLevel, profile.stream ?? '', subject, unit ?? '', chapter, module.title, ...module.goals];
  return createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex').slice(0, 32);
}

/** A request that finds the pictures being drawn waits this long for them before telling the student to ask again. */
export const WAIT_MS = 240_000;
/** Drawing that has gone on longer than this was cut short (the function ran out of time): it is begun again. */
export const DRAWING_MS = 8 * 60_000;
/** After a failure (no quota, say), pictures are not tried again for this long. */
export const RETRY_MS = 30 * 60_000;
const POLL_MS = 4000;

export const dataUrl = (image: Image) => `data:${image.mimeType};base64,${image.data.toString('base64')}`;

/**
 * A module's pictures: kept ones at once; otherwise made now, or, if another
 * request is already making them, waited for.
 */
export async function getModulePictures(
  deps: { maker: PictureMaker; store: PictureStore; now: () => number; sleep: (ms: number) => Promise<void> },
  request: GetPicturesRequest,
): Promise<GetPicturesResponse> {
  const { maker, store, now, sleep } = deps;
  const key = moduleKey(request);
  const began = now();
  for (;;) {
    const kept = await store.read(key);
    if (kept?.status === 'ready') return { status: 'ready', pictures: await store.images(key, kept.notes) };
    if (kept?.status === 'failed' && (kept.retryAt ?? 0) > now()) return { status: 'unavailable', pictures: [] };
    if (kept?.status === 'drawing' && now() - kept.startedAt < DRAWING_MS) {
      if (now() - began >= WAIT_MS) return { status: 'drawing', pictures: [] };
      await sleep(POLL_MS);
      continue;
    }
    // Another request may have begun them a moment ago: then this one waits for those.
    if (!(await store.claim(key, now()))) continue;
    try {
      const drawn = await preparePictures(maker, request);
      await store.save(key, drawn, now());
      return {
        status: 'ready',
        pictures: drawn.map(({ note, image, frames }) => ({ ...note, src: dataUrl(image), ...(frames ? { frames: frames.map(dataUrl) } : {}) })),
      };
    } catch (err) {
      await store.fail(key, now() + RETRY_MS);
      throw err;
    }
  }
}
