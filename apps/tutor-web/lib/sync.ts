import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore/lite";
import { db } from "./firebase";
import { adoptDeviceProfile, mergeProfile, onProfileSaved, readStoredProfile } from "./profile";
import { adoptDeviceProgress, mergeProgress, onProgressSaved, readChapterProgress } from "./progress";
import { readJson, studentKey, writeJson } from "./storage";

// Keeps a student's profile and progress in their account, so they follow the
// student to any device they sign in on.
//
// The copy on the device is the one the app works from: every change is
// written there first and shows at once, then is saved to the account a moment
// later. When a student signs in, the account's copy is fetched and combined
// with the device's, the later change winning (see mergeChapters).
//
// Stored as students/{uid} (phone, profile) and students/{uid}/chapters/{id}
// (one document per chapter). Security rules allow each student only their own.

/** Changes are saved together after this pause, since tool calls come in bursts. */
const SAVE_DELAY_MS = 1200;
/** On a device new to the student, how long to wait for their data before showing the app anyway. */
const FIRST_LOAD_TIMEOUT_MS = 8000;
const SYNCED = "synced:v1";

let current: string | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const studentDoc = (uid: string) => doc(db, "students", uid);
// A chapter key is "class/subject/chapter"; document ids cannot contain a slash.
const chapterDoc = (uid: string, key: string) => doc(db, "students", uid, "chapters", key.replaceAll("/", "~"));

async function saveChapter(uid: string, key: string): Promise<void> {
  const chapter = uid === current ? readChapterProgress(key) : undefined;
  if (!chapter) return;
  try {
    await setDoc(chapterDoc(uid, key), { ...chapter, key });
  } catch (err) {
    // Still on the device, and saved again the next time the student opens the app.
    console.warn("Progress was not saved to the account:", err);
  }
}

async function saveProfileToAccount(uid: string): Promise<void> {
  const profile = uid === current ? readStoredProfile() : undefined;
  if (!profile) return;
  try {
    await setDoc(studentDoc(uid), { profile }, { merge: true });
  } catch (err) {
    console.warn("The class was not saved to the account:", err);
  }
}

function queueChapter(key: string): void {
  const uid = current;
  if (!uid) return;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void saveChapter(uid, key);
    }, SAVE_DELAY_MS),
  );
}

/** Saves anything still waiting, e.g. before signing out or when the tab is put away. */
export async function flushSync(): Promise<void> {
  const uid = current;
  const keys = [...timers.keys()];
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  if (uid) await Promise.all(keys.map((key) => saveChapter(uid, key)));
}

async function fetchAccount(uid: string, phone: string): Promise<void> {
  const [record, chapters] = await Promise.all([getDoc(studentDoc(uid)), getDocs(collection(studentDoc(uid), "chapters"))]);
  if (uid !== current) return;

  const deviceProfileIsNewer = mergeProfile(record.data()?.profile);
  const cloud: Record<string, unknown> = {};
  chapters.forEach((chapter) => {
    const data = chapter.data();
    if (typeof data.key === "string") cloud[data.key] = data;
  });
  const stale = mergeProgress(cloud);
  writeJson(studentKey(SYNCED), Date.now());

  // Send back whatever this device has that the account does not. Not awaited by the caller's UI.
  void Promise.all([
    setDoc(studentDoc(uid), { phone, lastSeenAt: Date.now(), ...(deviceProfileIsNewer ? { profile: readStoredProfile() } : {}) }, { merge: true }),
    ...stale.map((key) => saveChapter(uid, key)),
  ]).catch((err: unknown) => console.warn("The account was not brought up to date:", err));
}

/**
 * Starts keeping this student's data in step with their account. Returns true
 * when the device already holds their data, so the app can be shown at once;
 * otherwise `onReady` is called when their data has arrived (or could not be
 * fetched, in which case they start from what the device has).
 */
export function startSync(uid: string, phone: string, onReady: () => void): boolean {
  current = uid;
  adoptDeviceProfile();
  adoptDeviceProgress();
  const known = readJson(studentKey(SYNCED)) !== undefined;

  let told = known;
  const ready = () => {
    if (told || uid !== current) return;
    told = true;
    onReady();
  };
  const timeout = setTimeout(ready, FIRST_LOAD_TIMEOUT_MS);
  fetchAccount(uid, phone)
    .catch((err: unknown) => console.warn("Could not fetch the account's progress:", err))
    .finally(() => {
      clearTimeout(timeout);
      ready();
    });
  return known;
}

export function stopSync(): void {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  current = null;
}

onProgressSaved(queueChapter);
onProfileSaved(() => {
  if (current) void saveProfileToAccount(current);
});

if (typeof document !== "undefined") {
  // A tab that is hidden may never come back; save what is waiting while there is still time.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushSync();
  });
}
