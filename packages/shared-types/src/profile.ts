// What the student picks once: board, class, stream and teaching language.

export const BOARDS = [
  { id: 'cbse', name: 'CBSE' },
  { id: 'cisce', name: 'ICSE / ISC' },
  { id: 'kerala', name: 'Kerala State Board' },
  { id: 'tamil-nadu', name: 'Tamil Nadu State Board' },
  { id: 'karnataka', name: 'Karnataka State Board' },
  { id: 'maharashtra', name: 'Maharashtra State Board' },
  { id: 'andhra-pradesh', name: 'Andhra Pradesh State Board' },
  { id: 'telangana', name: 'Telangana State Board' },
  { id: 'up', name: 'UP Board' },
  { id: 'west-bengal', name: 'West Bengal Board' },
] as const;
export type BoardId = (typeof BOARDS)[number]['id'];

export const CLASS_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type ClassLevel = (typeof CLASS_LEVELS)[number];

/** Streams apply to classes 11 and 12 only. */
export const STREAMS = [
  { id: 'science-pcm', name: 'Science (PCM)' },
  { id: 'science-pcb', name: 'Science (PCB)' },
  { id: 'commerce', name: 'Commerce' },
  { id: 'humanities', name: 'Humanities' },
] as const;
export type StreamId = (typeof STREAMS)[number]['id'];

export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'hi', name: 'Hindi' },
  { id: 'ml', name: 'Malayalam' },
  { id: 'ta', name: 'Tamil' },
  { id: 'te', name: 'Telugu' },
  { id: 'kn', name: 'Kannada' },
  { id: 'mr', name: 'Marathi' },
  { id: 'bn', name: 'Bengali' },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]['id'];

export interface StudentProfile {
  board: BoardId;
  classLevel: ClassLevel;
  stream?: StreamId;
  language: LanguageId;
}

export function needsStream(classLevel: number): boolean {
  return classLevel >= 11;
}

export function boardName(id: BoardId): string {
  return BOARDS.find((b) => b.id === id)?.name ?? id;
}

export function streamName(id: StreamId | undefined): string | undefined {
  return STREAMS.find((s) => s.id === id)?.name;
}

export function languageName(id: LanguageId): string {
  return LANGUAGES.find((l) => l.id === id)?.name ?? id;
}

/** Validates untrusted input (a callable's data, or localStorage) into a profile. */
export function parseProfile(value: unknown): StudentProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const board = BOARDS.find((b) => b.id === v.board)?.id;
  const classLevel = CLASS_LEVELS.find((c) => c === v.classLevel);
  const language = LANGUAGES.find((l) => l.id === v.language)?.id;
  if (!board || !classLevel || !language) return null;
  if (!needsStream(classLevel)) return { board, classLevel, language };
  const stream = STREAMS.find((s) => s.id === v.stream)?.id;
  return stream ? { board, classLevel, stream, language } : null;
}
