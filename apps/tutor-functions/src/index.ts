import { logger, setGlobalOptions } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import {
  FUNCTIONS_REGION,
  parseProfile,
  type ChapterPlan,
  type ChapterRef,
  type GetChapterPlanRequest,
  type GetQuizRequest,
  type GetSyllabusRequest,
  type Quiz,
  type StartVoiceRequest,
  type StartVoiceResponse,
  type Syllabus,
} from '@codeeaq/shared-types';
import { createAsker, type Ask } from './ai';
import { generateChapterPlan, generateQuiz } from './course';
import { findCuratedSyllabus } from './syllabus/curated';
import { cachedSyllabus, generateSyllabus } from './syllabus/generate';
import { mintVoiceToken } from './voice';

// Called straight from students' browsers, so the endpoints must be publicly invokable.
// Each function validates its own input; abuse limits (App Check, rate limiting) are still to add.
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10, invoker: 'public' });

const geminiApiKey = defineSecret('GEMINI_API_KEY');
// Tried in order; the lite models keep working when the larger ones are over quota or busy.
const textModels = defineString('GEMINI_SYLLABUS_MODELS', {
  default: 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest',
});
// Chapter plans and quizzes are requested while the student waits, so the fast models go first.
const courseModels = defineString('GEMINI_COURSE_MODELS', {
  default: 'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.8-flash',
});
const liveModel = defineString('GEMINI_LIVE_MODEL', { default: 'models/gemini-3.1-flash-live-preview' });
const voiceName = defineString('GEMINI_VOICE', { default: 'Sulafat' });

function requireKey(): string {
  const key = geminiApiKey.value();
  if (!key) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY is not set');
  return key;
}

const list = (value: string) => value.split(',').map((m) => m.trim()).filter(Boolean);

// Kept across requests on a warm instance so it remembers which model answers.
let courseAsker: { key: string; ask: Ask } | undefined;
function getCourseAsker(): Ask {
  const key = requireKey();
  if (courseAsker?.key !== key) courseAsker = { key, ask: createAsker(key, list(courseModels.value()), 'no-search', 20_000) };
  return courseAsker.ask;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
}

function texts(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const out = value.map((v) => text(v, maxLength));
  return out.every((v): v is string => v !== undefined) ? out : undefined;
}

/** Validates the chapter a request is about; throws invalid-argument otherwise. */
function chapterRef(data: Partial<ChapterRef> | undefined): ChapterRef {
  const profile = parseProfile(data?.profile);
  const subject = text(data?.subject, 80);
  const chapter = text(data?.chapter, 160);
  const unit = data?.unit === undefined ? undefined : text(data.unit, 80);
  if (!profile || !subject || !chapter || (data?.unit !== undefined && !unit)) {
    throw new HttpsError('invalid-argument', 'profile, subject and chapter are required');
  }
  return { profile, subject, chapter, ...(unit ? { unit } : {}) };
}

function moduleRef(data: { module?: { title?: unknown; goals?: unknown } } | undefined) {
  const title = text(data?.module?.title, 100);
  const goals = texts(data?.module?.goals, 6, 200);
  if (!title || !goals?.length) throw new HttpsError('invalid-argument', 'module title and goals are required');
  return { title, goals };
}

/**
 * Returns every subject and chapter for a board and class. Curated syllabi
 * return instantly; anything else is compiled once with web search and cached.
 */
export const getSyllabus = onCall<GetSyllabusRequest, Promise<Syllabus>>(
  { secrets: [geminiApiKey], timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    // The profile parser validates board, class and stream; language is irrelevant here.
    const profile = parseProfile({ ...(request.data ?? {}), language: 'en' });
    if (!profile) throw new HttpsError('invalid-argument', 'A valid board, class and stream are required');
    const query: GetSyllabusRequest = { board: profile.board, classLevel: profile.classLevel, stream: profile.stream };

    const curated = findCuratedSyllabus(query);
    if (curated) return curated;

    const key = requireKey();
    try {
      return await cachedSyllabus(query, () => generateSyllabus(key, list(textModels.value()), query));
    } catch (err) {
      logger.error('Syllabus generation failed', { query, err: String(err) });
      throw new HttpsError('unavailable', 'Could not load the syllabus right now. Please try again.');
    }
  },
);

/** Splits a chapter into modules, each with a few learning goals. */
export const getChapterPlan = onCall<GetChapterPlanRequest, Promise<ChapterPlan>>(
  { secrets: [geminiApiKey], timeoutSeconds: 90 },
  async (request) => {
    const ref = chapterRef(request.data);
    try {
      return await generateChapterPlan(getCourseAsker(), ref);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error('Chapter plan failed', { chapter: ref.chapter, err: String(err) });
      throw new HttpsError('unavailable', 'Could not plan this chapter right now.');
    }
  },
);

/** Writes a fresh multiple-choice quiz for one module. */
export const getQuiz = onCall<GetQuizRequest, Promise<Quiz>>(
  { secrets: [geminiApiKey], timeoutSeconds: 90 },
  async (request) => {
    const ref = chapterRef(request.data);
    const module = moduleRef(request.data);
    const avoid = request.data.avoid === undefined ? [] : texts(request.data.avoid, 30, 400);
    if (!avoid) throw new HttpsError('invalid-argument', 'avoid must be a short list of questions');
    try {
      const questions = await generateQuiz(getCourseAsker(), { ...ref, module, avoid });
      return { questions, createdAt: Date.now() };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error('Quiz generation failed', { module: module.title, err: String(err) });
      throw new HttpsError('unavailable', 'Could not write the quiz right now. Please try again.');
    }
  },
);

/** Mints a one-use Gemini Live token for one module's lesson. */
export const createVoiceSession = onCall<StartVoiceRequest, Promise<StartVoiceResponse>>(
  { secrets: [geminiApiKey], timeoutSeconds: 30 },
  async (request) => {
    const ref = chapterRef(request.data);
    const module = moduleRef(request.data);
    const chapterModules = texts(request.data.chapterModules, 10, 100);
    if (!chapterModules) throw new HttpsError('invalid-argument', 'chapterModules must be a list of titles');

    const key = requireKey();
    const model = liveModel.value();
    try {
      const token = await mintVoiceToken(key, model, voiceName.value(), { ...ref, module, chapterModules });
      return { token, model };
    } catch (err) {
      logger.error('Gemini voice token mint failed', { model, err: String(err) });
      throw new HttpsError('internal', 'Could not start a voice session.');
    }
  },
);
