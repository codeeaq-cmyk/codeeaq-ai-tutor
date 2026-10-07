import {
  boardName,
  parseChapterPlan,
  parseQuizQuestions,
  QUIZ_LENGTH,
  streamName,
  type ChapterPlan,
  type ChapterRef,
  type GetQuizRequest,
  type QuizQuestion,
} from '@codeeaq/shared-types';
import { extractJson, plain, type Ask } from './ai';

// Splits a chapter into modules and writes each module's quiz. Both answer
// from the model's own knowledge of the textbook: fast, and no search quota.

function describe({ profile, subject, chapter, unit }: ChapterRef): string {
  const cls = [boardName(profile.board), `Class ${profile.classLevel}`, streamName(profile.stream)].filter(Boolean).join(', ');
  return `${cls} ${plain(subject, 60)}${unit ? ` (${plain(unit, 60)})` : ''}, chapter "${plain(chapter)}"`;
}

export function buildPlanPrompt(ref: ChapterRef): string {
  return `Split this chapter into study modules for a student: ${describe(ref)}.

Follow the sections of the prescribed textbook, in textbook order, covering the whole chapter and nothing outside it.
Use 3 to 6 modules. Each module is one sitting of about 10 minutes with a tutor.
Give each module 2 to 4 goals: specific things the student will be able to do or explain afterwards, in teaching order, each under 15 words.

Reply with JSON only, in exactly this shape:
{"modules": [{"title": "<short module title>", "goals": ["<goal>"]}]}`;
}

export function parsePlanReply(text: string): ChapterPlan {
  const plan = parseChapterPlan(extractJson(text));
  if (!plan) throw new Error('Reply has no usable modules');
  return plan;
}

export function buildQuizPrompt(request: GetQuizRequest): string {
  const goals = request.module.goals.map((g, i) => `${i + 1}. ${plain(g, 160)}`).join('\n');
  const avoid = (request.avoid ?? []).slice(0, 15).map((q) => `- ${plain(q, 200)}`);
  return `Write a ${QUIZ_LENGTH}-question multiple-choice quiz for a student: ${describe(request)}.

The quiz checks only this module: "${plain(request.module.title)}". Its goals:
${goals}

Rules:
- Test understanding and application at the level of this class and board's exams, not trivia or wording.
- Cover different goals. Mix question styles: concept, worked calculation or example, and one applied or real-life question.
- Exactly 4 options each, one clearly correct. Wrong options should reflect common mistakes. No "all of the above" or "none of the above".
- "answer" is the index (0 to 3) of the correct option.
- "explanation": one or two sentences on why the answer is right, written to the student.
- Write maths between $...$ in LaTeX (e.g. $\\\\frac{1}{2}$, $x^2$). Keep everything else plain text.
${avoid.length ? `- Do not repeat or closely rephrase these earlier questions:\n${avoid.join('\n')}\n` : ''}
Reply with JSON only, in exactly this shape:
{"questions": [{"question": "<text>", "options": ["<a>", "<b>", "<c>", "<d>"], "answer": 0, "explanation": "<text>"}]}`;
}

export function parseQuizReply(text: string, random: () => number = Math.random): QuizQuestion[] {
  const questions = parseQuizQuestions(extractJson(text), random);
  if (questions.length < 3) throw new Error('Reply has too few usable questions');
  return questions;
}

// Plans rarely change; share them across requests on a warm instance.
const planCache = new Map<string, Promise<ChapterPlan>>();

export function generateChapterPlan(ask: Ask, ref: ChapterRef): Promise<ChapterPlan> {
  const { profile } = ref;
  const key = [profile.board, profile.classLevel, profile.stream ?? '', ref.subject, ref.unit ?? '', ref.chapter].join('|').toLowerCase();
  let pending = planCache.get(key);
  if (!pending) {
    pending = ask(buildPlanPrompt(ref), parsePlanReply);
    planCache.set(key, pending);
    pending.catch(() => planCache.delete(key));
  }
  return pending;
}

export function generateQuiz(ask: Ask, request: GetQuizRequest): Promise<QuizQuestion[]> {
  return ask(buildQuizPrompt(request), parseQuizReply);
}
