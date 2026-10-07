import { describe, expect, it, vi } from 'vitest';
import type { Ask } from './ai';
import { buildPlanPrompt, buildQuizPrompt, generateChapterPlan, parsePlanReply, parseQuizReply } from './course';

const ref = { profile: { board: 'cbse', classLevel: 10, language: 'en' }, subject: 'Science', chapter: 'Electricity' } as const;
const module = { title: "Ohm's law", goals: ['State the law'] };

const question = (n: number, extra: object = {}) => ({
  question: `Q${n}?`,
  options: ['right', 'wrong a', 'wrong b', 'wrong c'],
  answer: 0,
  explanation: 'because',
  ...extra,
});

describe('chapter plan', () => {
  it('reads modules and gives them unique ids', () => {
    const plan = parsePlanReply(
      JSON.stringify({ modules: [{ title: 'Current', goals: ['Define current'] }, { title: 'Current', goals: ['Use I = Q/t'] }, { title: 'Empty', goals: [] }] }),
    );
    expect(plan.modules.map((m) => m.id)).toEqual(['current', 'current-2']);
  });

  it('rejects a reply with no usable modules', () => {
    expect(() => parsePlanReply('{"modules":[]}')).toThrow();
  });

  it('asks about the right chapter and generates it once per chapter', async () => {
    expect(buildPlanPrompt(ref)).toContain('CBSE, Class 10 Science, chapter "Electricity"');
    const ask = vi.fn(async () => ({ modules: [] }));
    const other = { ...ref, chapter: 'Light' };
    await Promise.all([generateChapterPlan(ask as unknown as Ask, other), generateChapterPlan(ask as unknown as Ask, other)]);
    expect(ask).toHaveBeenCalledOnce();
  });
});

describe('quiz', () => {
  it('shuffles options and keeps the answer pointing at the right one', () => {
    const reply = JSON.stringify({ questions: [1, 2, 3].map((n) => question(n)) });
    // A random source that always picks index 0 moves the first option to the end.
    const questions = parseQuizReply(reply, () => 0);
    for (const q of questions) expect(q.options[q.answer]).toBe('right');
    expect(questions[0].answer).not.toBe(0);
  });

  it('drops malformed questions and needs at least three good ones', () => {
    const bad = [question(1, { options: ['a', 'b', 'c'] }), question(2, { answer: 7 }), question(3, { options: ['a', 'a', 'b', 'c'] })];
    expect(() => parseQuizReply(JSON.stringify({ questions: [...bad, question(4), question(5)] }))).toThrow('too few');
    expect(parseQuizReply(JSON.stringify({ questions: [...bad, question(4), question(5), question(6)] }))).toHaveLength(3);
  });

  it('caps the quiz at five questions', () => {
    const reply = JSON.stringify({ questions: Array.from({ length: 9 }, (_, n) => question(n)) });
    expect(parseQuizReply(reply)).toHaveLength(5);
  });

  it('tells the model which earlier questions to avoid', () => {
    const prompt = buildQuizPrompt({ ...ref, module, avoid: ['What is 1 ohm?'] });
    expect(prompt).toContain(`checks only this module: "Ohm's law"`);
    expect(prompt).toContain('- What is 1 ohm?');
    expect(buildQuizPrompt({ ...ref, module })).not.toContain('Do not repeat');
  });
});
