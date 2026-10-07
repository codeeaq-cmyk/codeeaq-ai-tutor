import {
  boardName,
  defineSubjects,
  streamName,
  type GetSyllabusRequest,
  type Syllabus,
} from '@codeeaq/shared-types';
import { extractJson, type Ask } from '../ai';

// A syllabus is compiled in two steps: first the list of subjects, then each
// subject's chapters, all subjects in parallel. Small, single-subject answers
// stay accurate even on lighter models; one long answer tends to mix subjects up.

const MAX_SUBJECTS = 12;
/** Chapter requests in flight at once; more trips per-minute rate limits. */
const CONCURRENCY = 4;
const MAX_UNITS = 12;
const MAX_CHAPTERS = 40;

function describe({ board, classLevel, stream }: GetSyllabusRequest): string {
  return [boardName(board), `Class ${classLevel}`, streamName(stream)].filter(Boolean).join(', ');
}

export function buildSubjectsPrompt(request: GetSyllabusRequest): string {
  return `Find the current official syllabus for ${describe(request)}, for the latest academic session.

List the subjects a student in this class studies${request.stream ? ' in this stream' : ''}: every compulsory subject, including languages, plus the most widely chosen electives. At most 10 subjects. Use the subject names the board uses.

Reply with JSON only, no prose, in exactly this shape:
{"edition": "<session year or textbook edition>", "subjects": ["<subject>"]}`;
}

export function buildChaptersPrompt(request: GetSyllabusRequest, subject: string): string {
  return `Find the current official ${subject} syllabus for ${describe(request)}, for the latest academic session.

List the individual chapters of ${subject} only, not just unit or theme names: a student picks one chapter to study in a single sitting, so a subject normally has 8 to 25 of them.
Use the chapter names from the prescribed textbooks (for CBSE, the current NCERT books) in textbook order. Where the board prescribes no single textbook, break each syllabus unit into the chapters or topics its official syllabus document lists.
Leave out chapters officially removed from the syllabus.
Group the chapters by book or unit when the subject has more than one (e.g. History, Geography within Social Science; Algebra, Geometry within Mathematics). Leave "unit" out otherwise.

Reply with JSON only, no prose, in exactly this shape:
{"units": [{"unit": "<book or unit>", "chapters": ["<chapter title>"]}]}`;
}

const clean = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function parseSubjectsReply(text: string): { edition?: string; subjects: string[] } {
  const raw = extractJson(text);
  const subjects = Array.isArray(raw.subjects)
    ? [...new Set(raw.subjects.map((s) => clean(s, 60)).filter(Boolean))].slice(0, MAX_SUBJECTS)
    : [];
  if (!subjects.length) throw new Error('Reply has no subjects');
  const edition = clean(raw.edition, 60);
  return edition ? { edition, subjects } : { subjects };
}

export function parseChaptersReply(text: string): { unit?: string; chapters: string[] }[] {
  const raw = extractJson(text);
  const units = Array.isArray(raw.units)
    ? raw.units.slice(0, MAX_UNITS).flatMap((u: { unit?: unknown; chapters?: unknown }) => {
        const chapters = Array.isArray(u?.chapters)
          ? u.chapters.map((c) => clean(c)).filter(Boolean).slice(0, MAX_CHAPTERS)
          : [];
        const unit = clean(u?.unit, 60);
        return chapters.length ? [unit ? { unit, chapters } : { chapters }] : [];
      })
    : [];
  if (!units.length) throw new Error('Reply has no chapters');
  return units;
}

/** Runs tasks with at most `limit` in flight, keeping results in order. */
async function settleLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * `ask` should try fast answers before web search and be shared across
 * requests, so it remembers which model responds: a student is waiting.
 */
export async function generateSyllabus(ask: Ask, request: GetSyllabusRequest): Promise<Syllabus> {
  const { edition, subjects: names } = await ask(buildSubjectsPrompt(request), parseSubjectsReply);

  const results = await settleLimited(
    names.map((name) => async () => ({ name, units: await ask(buildChaptersPrompt(request, name), parseChaptersReply) })),
    CONCURRENCY,
  );
  // A subject that fails on its own is left out rather than failing the class.
  const subjects = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!subjects.length) throw new Error('No subject chapters could be loaded');

  return {
    board: request.board,
    classLevel: request.classLevel,
    ...(request.stream ? { stream: request.stream } : {}),
    source: 'ai',
    ...(edition ? { edition } : {}),
    subjects: defineSubjects(subjects),
  };
}

// Shared across requests on a warm instance; concurrent requests for the same
// class wait on one generation instead of starting their own.
const cache = new Map<string, Promise<Syllabus>>();

export function cachedSyllabus(request: GetSyllabusRequest, load: () => Promise<Syllabus>): Promise<Syllabus> {
  const key = [request.board, request.classLevel, request.stream ?? ''].join('|');
  let pending = cache.get(key);
  if (!pending) {
    pending = load();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending;
}
