import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from "firebase/firestore/lite";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { FUNCTIONS_REGION } from "@codeeaq/shared-types";
import type {
  ChapterPlan,
  GetChapterPlanRequest,
  GetPicturesRequest,
  GetPicturesResponse,
  GetQuizRequest,
  GetSyllabusRequest,
  Quiz,
  StartVoiceRequest,
  StartVoiceResponse,
  Syllabus,
} from "@codeeaq/shared-types";

/** True when the app talks to the local Firebase emulators instead of the live project. */
export const USING_EMULATORS = process.env.NEXT_PUBLIC_USE_FUNCTIONS_EMULATOR !== "false";
const EMULATOR_HOST = "127.0.0.1";

// In development this module can be evaluated again while the app it created
// lives on; services are then looked up instead of being set up a second time.
const existing = getApps()[0];
const app =
  existing ??
  initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-ceeq",
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-key",
    ...(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ? { authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN } : {}),
    ...(process.env.NEXT_PUBLIC_FIREBASE_APP_ID ? { appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID } : {}),
  });

/** Sign-in by number and code. Students stay signed in on the device until they sign out. */
export const auth = getAuth(app);
/** Each student's profile and progress. The lite client is enough: the device copy gives speed and offline use. */
export const db = existing ? getFirestore(app) : initializeFirestore(app, { ignoreUndefinedProperties: true });
const functions = getFunctions(app, FUNCTIONS_REGION);

if (USING_EMULATORS && !existing) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
}

const getSyllabusFn = httpsCallable<GetSyllabusRequest, Syllabus>(functions, "getSyllabus", { timeout: 130_000 });
const getChapterPlanFn = httpsCallable<GetChapterPlanRequest, ChapterPlan>(functions, "getChapterPlan", { timeout: 95_000 });
const getQuizFn = httpsCallable<GetQuizRequest, Quiz>(functions, "getQuiz", { timeout: 95_000 });
const createVoiceSessionFn = httpsCallable<StartVoiceRequest, StartVoiceResponse>(functions, "createVoiceSession");
// The first student to open a module waits while its pictures are drawn and checked: a few minutes at most.
const getPicturesFn = httpsCallable<GetPicturesRequest, GetPicturesResponse>(functions, "getPictures", { timeout: 545_000 });

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

export async function fetchPictures(request: GetPicturesRequest) {
  return (await getPicturesFn(request)).data;
}
