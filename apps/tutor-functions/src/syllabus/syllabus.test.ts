import { describe, expect, it } from 'vitest';
import { findCuratedSyllabus } from './curated';
import { buildChaptersPrompt, buildSubjectsPrompt, cachedSyllabus, parseChaptersReply, parseSubjectsReply } from './generate';

const request = { board: 'cbse', classLevel: 8 } as const;

describe('curated syllabi', () => {
  it('has CBSE Class 10 with unique chapter ids per subject', () => {
    const syllabus = findCuratedSyllabus({ board: 'cbse', classLevel: 10 });
    expect(syllabus?.subjects.map((s) => s.name)).toContain('Mathematics');
    for (const subject of syllabus!.subjects) {
      const ids = subject.chapters.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('returns nothing for classes without curated data', () => {
    expect(findCuratedSyllabus(request)).toBeUndefined();
  });
});

describe('syllabus replies', () => {
  it('reads subjects from JSON wrapped in prose or code fences, without duplicates', () => {
    const reply = 'Here you go:\n```json\n{"edition":"2026-27","subjects":["Science"," Science ","Mathematics",""]}\n```';
    expect(parseSubjectsReply(reply)).toEqual({ edition: '2026-27', subjects: ['Science', 'Mathematics'] });
  });

  it('keeps units and drops malformed chapters', () => {
    const reply = JSON.stringify({ units: [{ unit: 'History', chapters: ['Tribes', 42, ''] }, { chapters: 'nope' }, { chapters: ['Maps'] }] });
    expect(parseChaptersReply(reply)).toEqual([{ unit: 'History', chapters: ['Tribes'] }, { chapters: ['Maps'] }]);
  });

  it('rejects replies with nothing usable', () => {
    expect(() => parseSubjectsReply('sorry, no idea')).toThrow();
    expect(() => parseSubjectsReply('{"subjects":[]}')).toThrow();
    expect(() => parseChaptersReply('{"units":[{"chapters":[]}]}')).toThrow();
  });

  it('asks about the right class, stream and subject', () => {
    expect(buildSubjectsPrompt({ board: 'cbse', classLevel: 11, stream: 'commerce' })).toContain('CBSE, Class 11, Commerce');
    expect(buildChaptersPrompt({ board: 'cisce', classLevel: 10 }, 'Physics')).toContain('chapters of Physics only');
  });
});

describe('cachedSyllabus', () => {
  it('shares one generation between concurrent requests and retries after failure', async () => {
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new Error('boom'));
    };
    const key = { board: 'kerala', classLevel: 3 } as const;
    await Promise.allSettled([cachedSyllabus(key, failing), cachedSyllabus(key, failing)]);
    expect(calls).toBe(1);
    await cachedSyllabus(key, failing).catch(() => {});
    expect(calls).toBe(2);
  });
});
