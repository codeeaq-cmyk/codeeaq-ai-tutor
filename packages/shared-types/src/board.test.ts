import { describe, expect, it } from 'vitest';
import { applyBoardUpdate, EMPTY_BOARD, validateBoardUpdate } from './board.js';
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

  it('accepts image blocks by search phrase only, never by URL', () => {
    const { update, errors } = validateBoardUpdate({
      add: [
        { kind: 'image', id: 'i1', query: 'insect anatomy diagram', caption: 'Parts of an insect' },
        { kind: 'photo', id: 'i2', query: 'honey bee' },
        { kind: 'image', id: 'i3', query: 'https://evil.example/x.png' },
        { kind: 'image', id: 'i4' },
      ],
    });
    expect(update.add).toEqual([
      { kind: 'image', id: 'i1', query: 'insect anatomy diagram', caption: 'Parts of an insect' },
      { kind: 'image', id: 'i2', query: 'honey bee' },
    ]);
    expect(errors).toHaveLength(2);
  });

  it('rejects impossible ranges', () => {
    expect(validateBoardUpdate({ add: [{ kind: 'number_line', id: 'n', min: 5, max: 1 }] }).update.add).toBeUndefined();
    expect(
      validateBoardUpdate({ add: [{ kind: 'graph', id: 'g', xMin: 0, xMax: 0, yMin: 0, yMax: 1, series: [] }] }).update.add,
    ).toBeUndefined();
  });
});

describe('applyBoardUpdate', () => {
  it('clears, removes, replaces by id and highlights', () => {
    let board = applyBoardUpdate(EMPTY_BOARD, {
      add: [
        { kind: 'text', id: 'a', text: 'one' },
        { kind: 'text', id: 'b', text: 'two' },
      ],
      highlight: 'a',
    });
    board = applyBoardUpdate(board, { add: [{ kind: 'text', id: 'b', text: 'TWO' }], remove: ['a'] });
    expect(board).toEqual({ blocks: [{ kind: 'text', id: 'b', text: 'TWO' }], highlight: null });
    expect(applyBoardUpdate(board, { clear: true })).toEqual(EMPTY_BOARD);
  });
});

describe('lesson tool arguments', () => {
  it('parses progress and answers defensively', () => {
    expect(parseProgressUpdate({ goal: 2, status: 'understood' }, 3)).toEqual({ index: 1, status: 'understood' });
    expect(parseProgressUpdate({ goal: 4, status: 'understood' }, 3)).toBeNull();
    expect(parseProgressUpdate({ goal: 1, status: 'done' }, 3)).toBeNull();
    expect(parseAnswer({ correct: false, mistake: 'mixed up I and R' })).toEqual({ correct: false, mistake: 'mixed up I and R' });
    expect(parseAnswer({ correct: 'yes' })).toBeNull();
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
