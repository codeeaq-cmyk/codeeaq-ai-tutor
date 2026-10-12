import { describe, expect, it } from 'vitest';
import { emptyModuleProgress, parseQuizQuestions } from './lesson.js';
import {
  applyQuizAnswers,
  dueGoals,
  markMissed,
  markRevised,
  parseRevisionTopics,
  parseWeakSpot,
  REVIEW_GAPS_DAYS,
  revisionTopics,
  weakGoals,
} from './revision.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

describe('weak spots', () => {
  it('marks a goal as due for revision when the student gets it wrong', () => {
    const m = markMissed(emptyModuleProgress(3), 1, 'mixed up series and parallel', NOW);
    expect(m.weak).toEqual([null, { misses: 1, notes: ['mixed up series and parallel'], step: 0, dueAt: NOW }, null]);
    expect(dueGoals(m, NOW).map((g) => g.index)).toEqual([1]);
  });

  it('counts repeated misses and keeps each note once', () => {
    let m = markMissed(emptyModuleProgress(2), 0, 'forgot the unit', NOW);
    m = markMissed(m, 0, 'forgot the unit', NOW + 1);
    m = markMissed(m, 0, undefined, NOW + 2);
    expect(m.weak[0]).toMatchObject({ misses: 3, notes: ['forgot the unit'] });
  });

  it('ignores a goal that is not in the module', () => {
    const m = emptyModuleProgress(2);
    expect(markMissed(m, 5, 'x', NOW)).toBe(m);
    expect(markMissed(m, -1, 'x', NOW)).toBe(m);
  });

  it('schedules a check after a good revision, and clears the goal once the check is passed', () => {
    let m = markMissed(emptyModuleProgress(1), 0, 'note', NOW);
    m = markRevised(m, 0, NOW + 60_000);
    const checkAt = NOW + 60_000 + REVIEW_GAPS_DAYS[0] * DAY;
    expect(m.weak[0]).toMatchObject({ step: 1, dueAt: checkAt });
    expect(weakGoals(m, NOW + DAY)).toEqual([{ index: 0, spot: m.weak[0], due: false }]);
    expect(dueGoals(m, NOW + DAY)).toEqual([]);
    expect(dueGoals(m, checkAt)).toHaveLength(1);
    expect(markRevised(m, 0, checkAt).weak[0]).toBeNull();
  });

  it('does not clear a goal when it is passed twice in one sitting', () => {
    let m = markMissed(emptyModuleProgress(1), 0, 'note', NOW);
    m = markRevised(m, 0, NOW + 1000);
    expect(markRevised(m, 0, NOW + 2000)).toEqual(m);
  });

  it('starts again when a goal is missed at its check', () => {
    let m = markMissed(emptyModuleProgress(1), 0, 'first', NOW);
    m = markRevised(m, 0, NOW);
    m = markMissed(m, 0, 'second', NOW + 4 * DAY);
    expect(m.weak[0]).toEqual({ misses: 2, notes: ['first', 'second'], step: 0, dueAt: NOW + 4 * DAY });
  });

  it('leaves a goal alone when it was never weak', () => {
    const m = emptyModuleProgress(2);
    expect(markRevised(m, 0, NOW).weak).toEqual([null, null]);
  });
});

describe('quiz results', () => {
  const answer = (correct: boolean, goal?: number) => ({ question: `Q about goal ${goal}?`, goal, correct });

  it('marks the goal each missed question tested', () => {
    const m = applyQuizAnswers(emptyModuleProgress(3), [answer(true, 1), answer(false, 2), answer(false, 2), answer(true, 3), answer(true, 1)], NOW);
    expect(m.weak[0]).toBeNull();
    expect(m.weak[1]).toMatchObject({ misses: 2, step: 0, dueAt: NOW });
    expect(m.weak[1]?.notes[0]).toBe('Quiz question missed: Q about goal 2?');
    expect(m.weak[2]).toBeNull();
  });

  it('never clears a weak spot on a right answer', () => {
    const before = markMissed(emptyModuleProgress(2), 0, 'note', NOW);
    expect(applyQuizAnswers(before, [answer(true, 1), answer(true, 2)], NOW + 1)).toEqual(before);
  });

  it('marks the whole module when a failed quiz names no goals', () => {
    const m = applyQuizAnswers(emptyModuleProgress(2), [answer(false), answer(false), answer(false), answer(true), answer(true)], NOW);
    expect(m.weak.every((spot) => spot?.notes[0] === 'Did not pass the module quiz')).toBe(true);
  });

  it('marks nothing for an untagged miss when the quiz was passed', () => {
    const m = applyQuizAnswers(emptyModuleProgress(2), [answer(false), answer(true), answer(true), answer(true), answer(true)], NOW);
    expect(m.weak).toEqual([null, null]);
  });

  it('keeps the goal a question tests through parsing, twice over', () => {
    const raw = {
      questions: [
        { question: 'Q1?', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '', goal: 2 },
        { question: 'Q2?', options: ['a', 'b', 'c', 'd'], answer: 1, explanation: '', goal: 'two' },
        { question: 'Q3?', options: ['a', 'b', 'c', 'd'], answer: 1, explanation: '', goal: 0 },
      ],
    };
    const once = parseQuizQuestions(raw, () => 0.5);
    expect(once.map((q) => q.goal)).toEqual([2, undefined, undefined]);
    expect(parseQuizQuestions({ questions: once })).toEqual(once);
  });
});

describe('revision topics', () => {
  it('asks for a re-teach first and only a check after one good revision', () => {
    let m = markMissed(emptyModuleProgress(3), 0, 'first note', NOW);
    m = markMissed(m, 2, 'third note', NOW);
    m = markRevised(m, 2, NOW);
    const later = NOW + 10 * DAY;
    expect(revisionTopics(dueGoals(m, later))).toEqual([
      { goal: 1, notes: ['first note'], check: false },
      { goal: 3, notes: ['third note'], check: true },
    ]);
  });

  it('validates topics sent to the backend', () => {
    expect(parseRevisionTopics([{ goal: 2, notes: ['  a   note '], check: true }], 3)).toEqual([{ goal: 2, notes: ['a note'], check: true }]);
    expect(parseRevisionTopics([{ goal: 1 }], 3)).toEqual([{ goal: 1, notes: [], check: false }]);
    expect(parseRevisionTopics([{ goal: 4, notes: [] }], 3)).toBeNull();
    expect(parseRevisionTopics([{ goal: 1 }, { goal: 1 }], 3)).toBeNull();
    expect(parseRevisionTopics([], 3)).toBeNull();
    expect(parseRevisionTopics('goal 1', 3)).toBeNull();
    expect(parseRevisionTopics([{ goal: 1, notes: 'not a list' }], 3)).toBeNull();
  });

  it('reads stored weak spots defensively', () => {
    expect(parseWeakSpot({ misses: 2, notes: ['a', 7], step: 9, dueAt: 5 })).toEqual({ misses: 2, notes: ['a'], step: REVIEW_GAPS_DAYS.length, dueAt: 5 });
    expect(parseWeakSpot({ misses: 2 })).toBeNull();
    expect(parseWeakSpot(null)).toBeNull();
  });
});
