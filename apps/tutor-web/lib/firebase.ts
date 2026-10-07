import { getApps, initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { FUNCTIONS_REGION } from "@codeeaq/shared-types";
import type {
  ChapterPlan,
  GetChapterPlanRequest,
  GetQuizRequest,
  GetSyllabusRequest,
  Quiz,
  StartVoiceRequest,
  StartVoiceResponse,
  Syllabus,
} from "@codeeaq/shared-types";

const app =
  getApps()[0] ??
  initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-ceeq",
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-key",
  });

const functions = getFunctions(app, FUNCTIONS_REGION);
if (process.env.NEXT_PUBLIC_USE_FUNCTIONS_EMULATOR !== "false") {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

const getSyllabusFn = httpsCallable<GetSyllabusRequest, Syllabus>(functions, "getSyllabus", { timeout: 130_000 });
const getChapterPlanFn = httpsCallable<GetChapterPlanRequest, ChapterPlan>(functions, "getChapterPlan", { timeout: 95_000 });
const getQuizFn = httpsCallable<GetQuizRequest, Quiz>(functions, "getQuiz", { timeout: 95_000 });
const createVoiceSessionFn = httpsCallable<StartVoiceRequest, StartVoiceResponse>(functions, "createVoiceSession");

export async function fetchSyllabus(request: GetSyllabusRequest) {
  return (await getSyllabusFn(request)).data;
}

export async function startVoice(request: StartVoiceRequest) {
  return (await createVoiceSessionFn(request)).data;
}

export async function fetchChapterPlan(request: GetChapterPlanRequest) {
  return (await getChapterPlanFn(request)).data;
}

export async function fetchQuiz(request: GetQuizRequest) {
  return (await getQuizFn(request)).data;
}
