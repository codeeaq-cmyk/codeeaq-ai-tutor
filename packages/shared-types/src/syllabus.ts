import type { BoardId, ClassLevel, StreamId } from './profile.js';

export interface Chapter {
  id: string;
  title: string;
  /** Book or unit the chapter belongs to, e.g. "History" within Social Science. */
  unit?: string;
}

export interface Subject {
  id: string;
  name: string;
  chapters: Chapter[];
}

export interface Syllabus {
  board: BoardId;
  classLevel: ClassLevel;
  stream?: StreamId;
  subjects: Subject[];
  /** curated: checked-in data. ai: compiled by Gemini from web search. */
  source: 'curated' | 'ai';
  /** Session year or textbook edition the syllabus reflects, if known. */
  edition?: string;
}

export interface GetSyllabusRequest {
  board: BoardId;
  classLevel: ClassLevel;
  stream?: StreamId;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

/** Builds a syllabus from plain names, assigning stable ids. */
export function defineSubjects(
  subjects: { name: string; units: { unit?: string; chapters: string[] }[] }[],
): Subject[] {
  return subjects.map((subject) => {
    const seen = new Set<string>();
    const chapters: Chapter[] = [];
    for (const { unit, chapters: titles } of subject.units) {
      for (const title of titles) {
        let id = slugify(title);
        while (seen.has(id)) id = `${id}-2`;
        seen.add(id);
        chapters.push(unit ? { id, title, unit } : { id, title });
      }
    }
    return { id: slugify(subject.name), name: subject.name, chapters };
  });
}
