import { describe, expect, it } from 'vitest';
import type { GetPicturesRequest } from '@codeeaq/shared-types';
import {
  buildCheckPrompt,
  buildDrawPrompt,
  buildPicturePlanPrompt,
  buildAddPrompt,
  buildFirstStagePrompt,
  buildStageCheckPrompt,
  DRAWINGS,
  getModulePictures,
  moduleKey,
  parsePicturePlan,
  parseVerdict,
  preparePictures,
  RETRY_MS,
  WAIT_MS,
  type Drawn,
  type Image,
  type PictureMaker,
  type PictureSpec,
  type PictureStore,
  type StoredModule,
  type StoredNote,
  type Verdict,
} from './pictures';
import { picturesSection } from './voice';

const request: GetPicturesRequest = {
  profile: { board: 'cbse', classLevel: 6, language: 'en' },
  subject: 'Science',
  chapter: 'The Leaf',
  module: { title: 'Introduction to the Leaf', goals: ['Name the parts of a leaf', 'Describe how a seed germinates', 'Define venation'] },
};

const leaf: PictureSpec = {
  id: 'leaf-parts',
  goal: 0,
  title: 'Parts of a leaf',
  shows: 'A simple leaf on a short stem, with its parts named.',
  draw: 'A single mango leaf seen flat from above, attached to a short stem.',
  labels: ['Petiole', 'Leaf base', 'Lamina', 'Midrib'],
};
const seed: PictureSpec = {
  id: 'germination',
  goal: 1,
  title: 'A seed germinates',
  shows: 'A bean seed growing into a seedling.',
  draw: 'A bean seed in soil, its root growing down and its shoot growing up.',
  labels: ['Seed', 'Root', 'Shoot'],
  stages: [
    { adds: 'The bean seed in moist soil', labels: ['Seed'] },
    { adds: 'A root growing down from the seed', labels: ['Root'] },
    { adds: 'A shoot growing up out of the soil', labels: ['Shoot'] },
  ],
};

/** A maker whose drawings are named after the prompt that made them, and whose checker gives the verdicts it is handed, in turn. */
function fakeMaker(specs: PictureSpec[], verdicts: Verdict[] = []) {
  const calls: string[] = [];
  let n = 0;
  const maker: PictureMaker = {
    plan: async () => specs,
    draw: async (prompt) => (calls.push('draw'), { data: Buffer.from(`drawing ${++n}: ${prompt.slice(0, 40)}`), mimeType: 'image/png' }),
    edit: async (_image, prompt) => (calls.push('edit'), { data: Buffer.from(`edit ${++n}: ${prompt.slice(0, 40)}`), mimeType: 'image/png' }),
    check: async () => (calls.push('check'), verdicts.shift() ?? { ok: true, problems: [] }),
    shrink: async (image) => ({ ...image, mimeType: 'image/webp' }),
  };
  return { maker, calls };
}

describe('planning pictures', () => {
  it('asks for the real things the student must see, as the textbook shows them, and no flowcharts', () => {
    const prompt = buildPicturePlanPrompt(request);
    expect(prompt).toContain('CBSE, Class 6 Science, chapter "The Leaf"');
    expect(prompt).toContain('1. Name the parts of a leaf');
    expect(prompt).toContain('exactly as the textbook names the parts');
    expect(prompt).toContain('give each its own name too');
    expect(prompt).toContain('Do not make pictures of flowcharts');
  });

  it('keeps well-formed pictures, with goals counted from 0, unique ids and stages only when they name every part', () => {
    const reply = JSON.stringify({
      pictures: [
        { goal: 1, id: 'Leaf Parts', title: 'Parts of a leaf', shows: 'A leaf.', draw: 'A leaf.', labels: ['Petiole', 'Lamina'] },
        { goal: 1, id: 'leaf-parts', title: 'Veins', shows: 'Veins.', draw: 'Veins.', labels: [] },
        { goal: 2, id: 'seed', title: 'Germination', shows: 'A seed.', draw: 'A seed.', labels: ['Seed', 'Root'], stages: [{ adds: 'Seed', labels: ['Seed'] }, { adds: 'Root', labels: ['Root'] }] },
        { goal: 2, id: 'half', title: 'Half', shows: 'x', draw: 'x', labels: ['A', 'B'], stages: [{ adds: 'A', labels: ['A'] }, { adds: 'C', labels: [] }] },
        { goal: 9, id: 'nowhere', title: 'No goal', shows: 'x', draw: 'x', labels: [] },
      ],
    });
    const specs = parsePicturePlan(reply, 3);
    expect(specs.map((s) => [s.id, s.goal])).toEqual([
      ['leaf-parts', 0],
      ['leaf-parts-2', 0],
      ['seed', 1],
      ['half', 1],
    ]);
    expect(specs[2].stages).toHaveLength(2);
    // Stages that leave a part unnamed are not used: the picture is shown complete.
    expect(specs[3].stages).toBeUndefined();
  });
});

describe('drawing and checking', () => {
  it('asks for exactly the names, in a textbook style, and passes on what was wrong last time', () => {
    const prompt = buildDrawPrompt(request, leaf, ['The label "Lamina" points at the stem.']);
    expect(prompt).toContain('spelled exactly as written here: Petiole, Leaf base, Lamina, Midrib');
    expect(prompt).toContain('NCERT');
    // Quotation marks are taken out of what goes back into a prompt.
    expect(prompt).toContain('- The label Lamina points at the stem.');
    expect(buildCheckPrompt(request, leaf)).toContain('Its names should be exactly these, and no other words: Petiole, Leaf base, Lamina, Midrib');
  });

  it('passes a drawing only when the checker says so and finds nothing wrong', () => {
    expect(parseVerdict('{"ok": true, "problems": []}')).toEqual({ ok: true, problems: [] });
    expect(parseVerdict('{"ok": true, "problems": ["Midrib is misspelled."]}').ok).toBe(false);
    expect(parseVerdict('{"ok": false, "problems": []}').ok).toBe(false);
  });

  it('draws again until the checker passes it, and gives the picture up after the last try', async () => {
    const fixed = fakeMaker([leaf], [{ ok: false, problems: ['Lamina points at the stem.'] }]);
    const [kept] = await preparePictures(fixed.maker, request);
    expect(fixed.calls).toEqual(['draw', 'check', 'draw', 'check']);
    expect(kept.note).toEqual({ id: 'leaf-parts', goal: 0, title: 'Parts of a leaf', shows: leaf.shows, labels: leaf.labels });
    expect(String(kept.image.data)).toMatch(/^drawing 2/);

    const hopeless = fakeMaker([leaf], Array.from({ length: DRAWINGS }, () => ({ ok: false, problems: ['Wrong.'] })));
    expect(await preparePictures(hopeless.maker, request)).toEqual([]);
    expect(hopeless.calls.filter((c) => c === 'draw')).toHaveLength(DRAWINGS);
  });
});

describe('pictures that build up', () => {
  it('draws the first stage, adds each stage to the frame before, and checks every frame', async () => {
    const { maker, calls } = fakeMaker([seed]);
    const [kept] = await preparePictures(maker, request);
    expect(calls).toEqual(['draw', 'check', 'edit', 'check', 'edit', 'check']);
    expect(kept.frames).toHaveLength(2);
    // The complete picture is the last frame made.
    expect(String(kept.image.data)).toMatch(/^edit 3/);
    expect(kept.note.stages).toEqual(['The bean seed in moist soil', 'A root growing down from the seed', 'A shoot growing up out of the soil']);
  });

  it('checks a frame for its own stages and names, and for nothing from the later ones', () => {
    const prompt = buildStageCheckPrompt(request, seed, 2);
    expect(prompt).toContain('1. The bean seed in moist soil\n2. A root growing down from the seed');
    expect(prompt).toContain('3. A shoot growing up out of the soil');
    expect(prompt).toContain('exactly these, and no other words: Seed, Root.');
    const first = buildFirstStagePrompt(request, seed);
    expect(first).toContain('Draw only its first stage now: The bean seed in moist soil.');
    expect(first).toContain('spelled exactly as written here: Seed.');
    expect(buildAddPrompt(seed.stages![2])).toContain('Add this to the picture: A shoot growing up out of the soil. Name what it adds, spelled exactly as written here: Shoot');
  });

  it('draws the picture complete instead if a frame never passes', async () => {
    const { maker, calls } = fakeMaker([seed], [{ ok: true, problems: [] }, { ok: false, problems: ['x'] }, { ok: false, problems: ['x'] }]);
    const [kept] = await preparePictures(maker, request);
    expect(calls).toEqual(['draw', 'check', 'edit', 'check', 'edit', 'check', 'draw', 'check']);
    expect(kept.frames).toBeUndefined();
    expect(kept.note.stages).toBeUndefined();
    expect(kept.note.labels).toEqual(['Seed', 'Root', 'Shoot']);
  });
});

describe('keeping pictures for every student', () => {
  function memoryStore() {
    const modules = new Map<string, StoredModule>();
    const saved: Drawn[] = [];
    const store: PictureStore = {
      read: async (key) => modules.get(key) ?? null,
      claim: async (key, now) => {
        const kept = modules.get(key);
        if (kept?.status === 'drawing' || kept?.status === 'ready') return false;
        modules.set(key, { status: 'drawing', startedAt: now, notes: [] });
        return true;
      },
      save: async (key, drawn, now) => {
        saved.push(...drawn);
        modules.set(key, { status: 'ready', startedAt: now, notes: drawn.map(({ note, frames }) => ({ ...note, ...(frames ? { frames: frames.length } : {}) })) });
      },
      fail: async (key, retryAt) => void modules.set(key, { status: 'failed', startedAt: 0, notes: [], retryAt }),
      images: async (_key, notes: StoredNote[]) => notes.map(({ frames = 0, ...note }) => ({ ...note, src: 'data:kept', ...(frames ? { frames: Array(frames).fill('data:frame') } : {}) })),
    };
    return { store, modules, saved };
  }
  const clock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };

  it('makes them once, and gives later students the kept ones', async () => {
    const { store } = memoryStore();
    const first = fakeMaker([leaf, seed]);
    const made = await getModulePictures({ maker: first.maker, store, ...clock() }, request);
    expect(made.status).toBe('ready');
    expect(made.pictures.map((p) => p.id)).toEqual(['leaf-parts', 'germination']);
    expect(made.pictures[0].src).toMatch(/^data:image\/webp;base64,/);
    expect(made.pictures[1].frames).toHaveLength(2);
    const second = fakeMaker([leaf]);
    const kept = await getModulePictures({ maker: second.maker, store, ...clock() }, request);
    expect(second.calls).toEqual([]);
    expect(kept.pictures.map((p) => [p.id, p.src, p.frames?.length])).toEqual([
      ['leaf-parts', 'data:kept', undefined],
      ['germination', 'data:kept', 2],
    ]);
  });

  it('waits for pictures another request is making, and tells the student to ask again if they take too long', async () => {
    const { store, modules } = memoryStore();
    const time = clock();
    modules.set(moduleKey(request), { status: 'drawing', startedAt: time.now(), notes: [] });
    const { maker, calls } = fakeMaker([leaf]);
    const answer = await getModulePictures({ maker, store, ...time }, request);
    expect(answer).toEqual({ status: 'drawing', pictures: [] });
    expect(time.now()).toBeGreaterThanOrEqual(1_000_000 + WAIT_MS);
    expect(calls).toEqual([]);
  });

  it('does not try again for a while after the pictures could not be made', async () => {
    const { store, modules } = memoryStore();
    const time = clock();
    const broken: PictureMaker = { ...fakeMaker([leaf]).maker, draw: async (): Promise<Image> => Promise.reject(new Error('429 quota')) };
    await expect(getModulePictures({ maker: broken, store, ...time }, request)).rejects.toThrow('429');
    expect(modules.get(moduleKey(request))).toMatchObject({ status: 'failed', retryAt: 1_000_000 + RETRY_MS });
    expect(await getModulePictures({ maker: broken, store, ...time }, request)).toEqual({ status: 'unavailable', pictures: [] });
  });

  it('keeps one set for each module of each class, and makes them afresh when the way of making them changes', () => {
    expect(moduleKey(request)).toBe(moduleKey({ ...request, profile: { ...request.profile, language: 'hi' } }));
    expect(moduleKey(request)).not.toBe(moduleKey({ ...request, profile: { ...request.profile, classLevel: 7 } }));
    expect(moduleKey(request)).not.toBe(moduleKey({ ...request, module: { ...request.module, title: 'Venation' } }));
  });
});

describe("Ceeq's instructions about pictures", () => {
  it('lists the prepared pictures, their names and stages, and how to teach from them', () => {
    const text = picturesSection(
      [
        { id: 'leaf-parts', goal: 0, title: 'Parts of a leaf', shows: 'A leaf.', labels: ['Petiole', 'Lamina'] },
        { id: 'germination', goal: 1, title: 'A seed germinates', shows: 'A seed.', labels: ['Seed', 'Root'], stages: ['The seed', 'The root'] },
      ],
      3,
    );
    expect(text).toContain('- "leaf-parts", for goal 1: Parts of a leaf. A leaf. Names on it: Petiole, Lamina.');
    expect(text).toContain('It builds up in 2 stages: 1. The seed 2. The root');
    expect(text).toContain('the app puts it on the board for you');
    expect(text).toContain('never ask a question whose answer is a name written on it');
    expect(picturesSection([], 3)).toContain('Some goals may have a real picture');
  });
});
