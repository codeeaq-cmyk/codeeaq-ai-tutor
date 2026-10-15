import { describe, expect, it } from 'vitest';
import { applyBoardUpdate, EMPTY_BOARD, showPicture, startTopic, validateBoardUpdate } from './board.js';
import {
  bestAttempt,
  chapterMastery,
  emptyModuleProgress,
  moduleState,
  parseAnswer,
  parseProgressUpdate,
  type ChapterProgress,
} from './lesson.js';
import { parseProfile } from './profile.js';

describe('validateBoardUpdate', () => {
  it('keeps valid blocks and reports invalid ones', () => {
    const { update, errors } = validateBoardUpdate({
      clear: true,
      add: [
        { kind: 'heading', id: 'h1', text: 'Ohm’s law' },
        { kind: 'math', id: 'm1', latex: 'V = IR' },
        { kind: 'script', id: 'x', code: 'alert(1)' },
        { kind: 'text', id: 't1' },
      ],
    });
    expect(update.clear).toBe(true);
    expect(update.add?.map((b) => b.id)).toEqual(['h1', 'm1']);
    expect(errors).toHaveLength(2);
  });

  it('clamps diagram shapes to the canvas and drops unknown colours', () => {
    const { update } = validateBoardUpdate({
      add: [
        {
          kind: 'diagram',
          id: 'd1',
          shapes: [
            { type: 'circle', x: 9999, y: -5, r: 40, color: 'javascript:alert(1)' },
            { type: 'pie', x: 100, y: 100, r: 50, parts: 4, shaded: 9 },
            { type: 'image', href: 'http://evil' },
          ],
        },
      ],
    });
    const diagram = update.add?.[0];
    expect(diagram).toEqual({
      kind: 'diagram',
      id: 'd1',
      shapes: [
        { type: 'circle', x: 400, y: 0, r: 40 },
        { type: 'pie', x: 100, y: 100, r: 50, parts: 4, shaded: 4 },
      ],
    });
  });

  it('replaces unsafe ids and pads table rows to the header width', () => {
    const { update } = validateBoardUpdate({
      add: [{ kind: 'table', id: '<img onerror>', headers: ['a', 'b'], rows: [['1'], ['2', '3', '4']] }],
    });
    const table = update.add?.[0];
    expect(table?.id).toMatch(/^b\d+$/);
    expect(table).toMatchObject({ rows: [['1', ''], ['2', '3']] });
  });

  it('keeps a "why" callout and falls back to a tip for unknown tones', () => {
    const { update } = validateBoardUpdate({
      add: [
        { kind: 'callout', id: 'w', tone: 'why', text: 'Current is what charges your phone.' },
        { kind: 'callout', id: 'x', tone: 'shouting', text: 'Hello' },
      ],
    });
    expect(update.add).toEqual([
      { kind: 'callout', id: 'w', tone: 'why', text: 'Current is what charges your phone.' },
      { kind: 'callout', id: 'x', tone: 'tip', text: 'Hello' },
    ]);
  });

  it('accepts common near-miss block names and fields', () => {
    const { update, errors } = validateBoardUpdate({
      add: [
        { kind: 'formula', id: 'f', text: 'E = mc^2' },
        { kind: 'steps', id: 's', items: ['one', 'two'] },
        { kind: 'definition', id: 'd', text: 'A fraction is part of a whole.' },
      ],
    });
    expect(errors).toEqual([]);
    expect(update.add).toEqual([
      { kind: 'math', id: 'f', latex: 'E = mc^2' },
      { kind: 'list', id: 's', items: ['one', 'two'], ordered: true },
      { kind: 'callout', id: 'd', text: 'A fraction is part of a whole.', tone: 'remember' },
    ]);
  });

  it('no longer takes pictures searched for on the web', () => {
    const { update, errors } = validateBoardUpdate({ add: [{ kind: 'image', id: 'i1', query: 'insect anatomy diagram' }, { kind: 'photo', id: 'i2', query: 'honey bee' }] });
    expect(update.add).toBeUndefined();
    expect(errors).toHaveLength(2);
  });

  it('sets kinds side by side in panels, each with its own picture', () => {
    const { update, errors } = validateBoardUpdate({
      add: [
        {
          kind: 'panels',
          id: 'heat',
          panels: [
            { title: 'Conduction', picture: '🔥', text: 'Heat passes along a solid.', color: 'red' },
            { title: 'Convection', picture: 'pot', text: 'Hot water rises, cool water sinks.' },
            { title: 'Radiation', picture: '☀️ the sun', color: 'purple' },
            { picture: '🧊' },
          ],
        },
        { kind: 'panels', id: 'one', panels: [{ title: 'Charging a phone', picture: '🔋' }] },
        { kind: 'panels', id: 'none', panels: [{ picture: '🔋' }] },
      ],
    });
    expect(update.add).toEqual([
      {
        kind: 'panels',
        id: 'heat',
        panels: [
          { title: 'Conduction', picture: '🔥', text: 'Heat passes along a solid.', color: 'red' },
          // A plain name for a picture is understood; an unknown colour is dropped.
          { title: 'Convection', picture: '🍲', text: 'Hot water rises, cool water sinks.' },
          { title: 'Radiation', picture: '☀️' },
        ],
      },
      // One panel compares nothing, but is still a picture with its name.
      { kind: 'panels', id: 'one', panels: [{ title: 'Charging a phone', picture: '🔋' }] },
    ]);
    // A panel with no title is left out, and a block left with no panel at all is refused.
    expect(errors).toHaveLength(1);
  });

  it('joins the steps of a process with arrows, and closes a cycle', () => {
    const { update } = validateBoardUpdate({
      add: [
        { kind: 'flow', id: 'grow', steps: ['Seed', { label: 'Seedling', picture: '🌱', then: 'weeks' }, { label: 'Tree', picture: '🌳', then: 'nothing follows' }], caption: 'How a plant grows' },
        { kind: 'cycle', id: 'water', steps: [{ label: 'Sea', picture: '🌊', then: 'evaporation' }, { label: 'Cloud', picture: '☁️', then: 'rain' }] },
        { kind: 'flow', id: 'short', steps: [{ label: 'Only one' }] },
      ],
    });
    expect(update.add).toEqual([
      // Nothing happens after the last step of a process that does not go round.
      { kind: 'flow', id: 'grow', steps: [{ label: 'Seed' }, { label: 'Seedling', picture: '🌱', then: 'weeks' }, { label: 'Tree', picture: '🌳' }], caption: 'How a plant grows' },
      { kind: 'flow', id: 'water', loop: true, steps: [{ label: 'Sea', picture: '🌊', then: 'evaporation' }, { label: 'Cloud', picture: '☁️', then: 'rain' }] },
    ]);
  });

  it('puts what goes into a thing and what comes out of it on either side', () => {
    const { update } = validateBoardUpdate({
      add: [
        {
          kind: 'labelled',
          id: 'photo',
          picture: '🌿',
          title: 'Leaf',
          labels: [{ text: 'Sunlight', picture: '☀️', side: 'left', arrow: 'in' }, { text: 'Oxygen', side: 'right', arrow: 'out' }, 'Water', { text: 'Glucose', arrow: 'sideways' }],
        },
        { kind: 'labelled', id: 'named', title: 'Parliament', labels: ['Lok Sabha', 'Rajya Sabha'] },
        { kind: 'labelled', id: 'alone', picture: '📜', title: 'The Rowlatt Act' },
        { kind: 'labelled', id: 'dam', picture: '🧱', labels: [{ text: 'River', arrow: 'in' }, { text: 'Power', arrow: 'out' }, { text: 'Irrigation', arrow: 'out' }] },
        { kind: 'labelled', id: 'empty', labels: ['Nothing in the middle'] },
        { kind: 'labelled', id: 'bare', picture: 'A', title: 'Ammeter' },
      ],
    });
    expect(update.add).toEqual([
      {
        kind: 'labelled',
        id: 'photo',
        picture: '🌿',
        title: 'Leaf',
        labels: [
          { text: 'Sunlight', picture: '☀️', side: 'left', arrow: 'in' },
          { text: 'Oxygen', side: 'right', arrow: 'out' },
          // Sides are taken by turns, and a plain line drawn, when nothing is said.
          { text: 'Water', side: 'left', arrow: 'none' },
          { text: 'Glucose', side: 'right', arrow: 'none' },
        ],
      },
      // With no picture for it, the thing in the middle is shown by its name.
      { kind: 'labelled', id: 'named', title: 'Parliament', labels: [{ text: 'Lok Sabha', side: 'left', arrow: 'none' }, { text: 'Rajya Sabha', side: 'right', arrow: 'none' }] },
      // A picture and its name make a drawing by themselves.
      { kind: 'labelled', id: 'alone', picture: '📜', title: 'The Rowlatt Act', labels: [] },
      // Unless told, what goes in stands on the left and what comes out on the right.
      { kind: 'labelled', id: 'dam', picture: '🧱', labels: [{ text: 'River', side: 'left', arrow: 'in' }, { text: 'Power', side: 'right', arrow: 'out' }, { text: 'Irrigation', side: 'right', arrow: 'out' }] },
      // A letter is no picture, but the name can stand by itself.
      { kind: 'labelled', id: 'bare', title: 'Ammeter', labels: [] },
    ]);
  });

  it('takes a picture only if it is an emoji, and only the first', () => {
    const { update } = validateBoardUpdate({
      add: [
        {
          kind: 'diagram',
          id: 'sky',
          shapes: [
            { type: 'picture', x: 60, y: 50, picture: '☀️🏠', size: 500, label: 'The sun' },
            { type: 'picture', x: 300, y: 150, picture: '👩🏽‍🔬' },
            { type: 'picture', x: 200, y: 100, picture: 'https://evil.example/x.png' },
            { type: 'picture', x: 200, y: 100, picture: 'a drawing of heat' },
          ],
        },
      ],
    });
    expect(update.add).toEqual([
      {
        kind: 'diagram',
        id: 'sky',
        shapes: [
          { type: 'picture', x: 60, y: 50, picture: '☀️', size: 120, label: 'The sun' },
          { type: 'picture', x: 300, y: 150, picture: '👩🏽‍🔬' },
        ],
      },
    ]);
  });

  it('takes the notes of a goal, under the names models reach for', () => {
    const { update } = validateBoardUpdate({
      add: [
        { kind: 'notes', id: 'n1', points: ['Current is the rate of flow of charge.', '', 'Its unit is the ampere.'], title: 'Electric current' },
        { kind: 'summary', id: 'n2', items: ['One point.'] },
        { kind: 'notes', id: 'n3', text: 'First line.\nSecond line.' },
        { kind: 'notes', id: 'n4' },
      ],
    });
    expect(update.add).toEqual([
      { kind: 'notes', id: 'n1', points: ['Current is the rate of flow of charge.', 'Its unit is the ampere.'], title: 'Electric current' },
      { kind: 'notes', id: 'n2', points: ['One point.'] },
      { kind: 'notes', id: 'n3', points: ['First line.', 'Second line.'] },
    ]);
  });

  it('fits the axes of a graph to its points when no range is given', () => {
    const { update } = validateBoardUpdate({
      add: [
        { kind: 'graph', id: 'g', series: [{ points: [{ x: 1, y: 100 }, { x: 4, y: 10 }] }] },
        { kind: 'graph', id: 'flat', xMin: 5, xMax: 5, yMin: 0, yMax: 0, series: [{ points: [{ x: 3, y: 2 }] }] },
        { kind: 'graph', id: 'none' },
      ],
    });
    expect(update.add).toMatchObject([
      { kind: 'graph', id: 'g', xMin: 0, xMax: 4, yMin: 0, yMax: 100 },
      { kind: 'graph', id: 'flat', xMin: 2, xMax: 4, yMin: 1, yMax: 3 },
    ]);
  });

  it('rejects impossible ranges', () => {
    expect(validateBoardUpdate({ add: [{ kind: 'number_line', id: 'n', min: 5, max: 1 }] }).update.add).toBeUndefined();
    expect(
      validateBoardUpdate({ add: [{ kind: 'graph', id: 'g', xMin: 0, xMax: 0, yMin: 0, yMax: 1, series: [] }] }).update.add,
    ).toBeUndefined();
  });
});

describe('applyBoardUpdate', () => {
  const two = applyBoardUpdate(EMPTY_BOARD, {
    add: [
      { kind: 'text', id: 'a', text: 'one' },
      { kind: 'text', id: 'b', text: 'two' },
    ],
    highlight: 'a',
  });

  it('removes, replaces by id and highlights', () => {
    const board = applyBoardUpdate(two, { add: [{ kind: 'text', id: 'b', text: 'TWO' }], remove: ['a'] });
    expect(board).toMatchObject({ blocks: [{ kind: 'text', id: 'b', text: 'TWO' }], highlight: null });
  });

  it('clears and writes the new content in one call', () => {
    const board = applyBoardUpdate(two, { clear: true, add: [{ kind: 'heading', id: 'h', text: 'Recap' }] });
    expect(board).toMatchObject({ blocks: [{ kind: 'heading', id: 'h', text: 'Recap' }], highlight: null });
    expect(board.clearPending).toBeUndefined();
  });

  it('remembers which update put each block there, so blocks that came together are drawn in turn', () => {
    expect(two.born).toEqual({ a: 1, b: 1 });
    // Pointing at a block draws nothing new.
    const pointed = applyBoardUpdate(two, { highlight: 'b' });
    expect(pointed.born).toEqual({ a: 1, b: 1 });
    // A block that is replaced is drawn afresh; one that is removed is forgotten.
    const next = applyBoardUpdate(pointed, { add: [{ kind: 'text', id: 'b', text: 'TWO' }, { kind: 'text', id: 'c', text: 'three' }], remove: ['a'] });
    expect(next.born).toEqual({ b: 2, c: 2 });
    // A cleared board goes on counting, so a block with an old id is still new.
    const wiped = applyBoardUpdate(next, { clear: true, add: [{ kind: 'text', id: 'b', text: 'again' }] });
    expect(wiped.born).toEqual({ b: 3 });
  });

  it('never leaves the board blank: a clear with nothing to show waits for the next content', () => {
    const held = applyBoardUpdate(two, { clear: true });
    expect(held.blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(held.clearPending).toBe(true);
    // Pointing at something does not use up the pending clear.
    expect(applyBoardUpdate(held, { highlight: 'b' }).clearPending).toBe(true);
    const next = applyBoardUpdate(held, { add: [{ kind: 'heading', id: 'h', text: 'Next idea' }] });
    expect(next).toMatchObject({ blocks: [{ kind: 'heading', id: 'h', text: 'Next idea' }], highlight: null });
    expect(next.clearPending).toBeUndefined();
  });

  it('adds to the notes line by line, and knows which lines were there already', () => {
    const one = applyBoardUpdate(EMPTY_BOARD, { add: [{ kind: 'notes', id: 'n', points: ['First.'] }] });
    expect(one.kept).toEqual({ n: 0 });
    // Sent again with everything so far and one more line.
    const twoLines = applyBoardUpdate(one, { add: [{ kind: 'notes', id: 'n', points: ['First.', 'Second.'] }] });
    expect(twoLines.blocks).toEqual([{ kind: 'notes', id: 'n', points: ['First.', 'Second.'] }]);
    expect(twoLines.kept).toEqual({ n: 1 });
    // Sent again with only the new line: the earlier ones are not lost.
    const three = applyBoardUpdate(twoLines, { add: [{ kind: 'notes', id: 'n', points: ['Third.'] }] });
    expect(three.blocks).toEqual([{ kind: 'notes', id: 'n', points: ['First.', 'Second.', 'Third.'] }]);
    expect(three.kept).toEqual({ n: 2 });
    // A list that is sent again with more items is written from where it stopped; one that changed is written afresh.
    const list = applyBoardUpdate(EMPTY_BOARD, { add: [{ kind: 'list', id: 'l', items: ['a', 'b'] }] });
    expect(applyBoardUpdate(list, { add: [{ kind: 'list', id: 'l', items: ['a', 'b', 'c'] }] }).kept).toEqual({ l: 2 });
    expect(applyBoardUpdate(list, { add: [{ kind: 'list', id: 'l', items: ['x', 'b'] }] }).kept).toEqual({ l: 0 });
  });

  it('wipes the board for a new topic, keeping what was already put up for it', () => {
    const old = applyBoardUpdate(EMPTY_BOARD, { add: [{ kind: 'heading', id: 'h1', text: 'Goal one' }, { kind: 'notes', id: 'n1', points: ['A note.'] }], highlight: 'h1' });
    // The new topic is announced before anything is drawn for it: the wipe waits for the first block.
    const waiting = startTopic(old, old.updates ?? 0);
    expect(waiting.blocks).toHaveLength(2);
    expect(waiting.clearPending).toBe(true);
    const next = applyBoardUpdate(waiting, { add: [{ kind: 'heading', id: 'h2', text: 'Goal two' }] });
    expect(next.blocks.map((b) => b.id)).toEqual(['h2']);
    // …or after its first blocks have gone up in the same turn: those stay, and the rest goes.
    const drawn = applyBoardUpdate(old, { add: [{ kind: 'heading', id: 'h2', text: 'Goal two' }] });
    const wiped = startTopic(drawn, old.updates ?? 0);
    expect(wiped.blocks.map((b) => b.id)).toEqual(['h2']);
    expect(wiped.highlight).toBeNull();
    expect(wiped.clearPending).toBeUndefined();
    // With nothing older on it, the board is left alone.
    expect(startTopic(wiped, old.updates ?? 0)).toBe(wiped);
  });

  it('has nothing to hold back when the board is already empty', () => {
    const board = applyBoardUpdate(EMPTY_BOARD, { clear: true });
    expect(board).toMatchObject(EMPTY_BOARD);
    expect(board.clearPending).toBeUndefined();
  });
});

describe('lesson tool arguments', () => {
  it('parses progress and answers defensively', () => {
    expect(parseProgressUpdate({ goal: 2, status: 'understood' }, 3)).toEqual({ index: 1, status: 'understood' });
    expect(parseProgressUpdate({ goal: 4, status: 'understood' }, 3)).toBeNull();
    expect(parseProgressUpdate({ goal: 1, status: 'done' }, 3)).toBeNull();
    expect(parseAnswer({ correct: false, mistake: 'mixed up I and R' }, 3)).toEqual({ correct: false, mistake: 'mixed up I and R' });
    expect(parseAnswer({ correct: 'yes' }, 3)).toBeNull();
    // The goal an answer was about is kept only when it exists in the module.
    expect(parseAnswer({ goal: 2, correct: true, mistake: 'ignored when right' }, 3)).toEqual({ correct: true, index: 1 });
    expect(parseAnswer({ goal: 9, correct: false }, 3)).toEqual({ correct: false });
  });
});

describe('module progress', () => {
  it('moves from new to learning to quiz-ready to passed, keeping the best attempt', () => {
    const m = emptyModuleProgress(2);
    expect(moduleState(undefined)).toBe('new');
    expect(moduleState(m)).toBe('new');
    expect(moduleState({ ...m, goals: ['learning', 'todo'] })).toBe('learning');
    expect(moduleState({ ...m, learned: true })).toBe('quiz-ready');
    const failed = { ...m, attempts: [{ score: 2, total: 5, at: 1 }] };
    expect(moduleState(failed)).toBe('quiz-ready');
    const passed = { ...failed, attempts: [...failed.attempts, { score: 4, total: 5, at: 2 }, { score: 3, total: 5, at: 3 }] };
    expect(moduleState(passed)).toBe('passed');
    expect(bestAttempt(passed)).toEqual({ score: 4, total: 5, at: 2 });
  });

  it('measures chapter mastery as the share of modules passed', () => {
    const plan = { modules: [{ id: 'a', title: 'A', goals: ['x'] }, { id: 'b', title: 'B', goals: ['y'] }] };
    const progress: ChapterProgress = {
      plan,
      modules: { a: { ...emptyModuleProgress(1), attempts: [{ score: 5, total: 5, at: 1 }] } },
      updatedAt: 1,
    };
    expect(chapterMastery(progress)).toBe(0.5);
    expect(chapterMastery(undefined)).toBe(0);
  });
});

describe('parseProfile', () => {
  it('requires a stream only for classes 11 and 12', () => {
    expect(parseProfile({ board: 'cbse', classLevel: 10, language: 'en', stream: 'commerce' })).toEqual({
      board: 'cbse',
      classLevel: 10,
      language: 'en',
    });
    expect(parseProfile({ board: 'cbse', classLevel: 12, language: 'en' })).toBeNull();
    expect(parseProfile({ board: 'nope', classLevel: 10, language: 'en' })).toBeNull();
  });
});

describe('prepared pictures on the board', () => {
  const leaf = { id: 'leaf-parts', src: 'data:image/webp;base64,AAAA', title: 'Parts of a leaf', alt: 'A leaf with its parts named.' };

  it('takes a picture block as the id of a prepared picture to show, not as a block', () => {
    const { update, errors } = validateBoardUpdate({ add: [{ kind: 'heading', id: 'h', text: 'The leaf' }, { kind: 'picture', id: 'leaf-parts' }] });
    expect(errors).toEqual([]);
    expect(update.add).toEqual([{ kind: 'heading', id: 'h', text: 'The leaf' }]);
    expect(update.picture).toBe('leaf-parts');
    expect(validateBoardUpdate({ add: [{ kind: 'picture' }] }).errors).toHaveLength(1);
  });

  it('shows one picture at a time, and carries out a wipe that was waiting for something new', () => {
    const old = applyBoardUpdate(EMPTY_BOARD, { add: [{ kind: 'heading', id: 'h1', text: 'Goal one' }] });
    const waiting = startTopic(old, old.updates ?? 0);
    expect(waiting.clearPending).toBe(true);
    const shown = showPicture(waiting, leaf);
    expect(shown.blocks).toEqual([]);
    expect(shown.clearPending).toBeUndefined();
    expect(shown.picture).toEqual({ ...leaf, born: 2 });
    // Another picture takes its place.
    expect(showPicture(shown, { ...leaf, id: 'veins' }).picture?.id).toBe('veins');
  });

  it('keeps the picture as blocks are added, and lets it go with a wipe or the next topic', () => {
    const shown = showPicture(EMPTY_BOARD, leaf);
    const added = applyBoardUpdate(shown, { add: [{ kind: 'heading', id: 'h', text: 'The leaf' }] });
    expect(added.picture?.id).toBe('leaf-parts');
    expect(applyBoardUpdate(added, { clear: true, add: [{ kind: 'heading', id: 'k', text: 'Key points' }] }).picture).toBeUndefined();
    // A new topic, begun after the picture went up: it goes, once there is something to show instead.
    const next = startTopic(added, added.updates ?? 0);
    expect(next.clearPending).toBe(true);
    expect(applyBoardUpdate(next, { add: [{ kind: 'heading', id: 'h2', text: 'Goal two' }] }).picture).toBeUndefined();
    // Put up for the new topic itself, it stays.
    const forIt = showPicture(startTopic(added, added.updates ?? 0), leaf);
    expect(startTopic(forIt, added.updates ?? 0).picture?.id).toBe('leaf-parts');
  });
});
