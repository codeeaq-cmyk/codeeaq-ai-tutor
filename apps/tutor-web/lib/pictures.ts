import { useEffect, useState } from "react";
import type { ChapterRef, GetPicturesResponse, ModulePicture, ModulePlan, PictureNote } from "@codeeaq/shared-types";
import { fetchPictures } from "@/lib/firebase";

// The pictures a module is taught from: drawn and checked once on the server
// for every student (see packages/shared-types/src/pictures.ts). They are asked
// for as the lesson page opens. Kept ones come at once; the first student to
// open a module may wait a few minutes while they are made, and the lesson does
// not wait for them.

/** While they are being made, they are asked for again this often, this many times. */
const ASK_AGAIN_MS = 30_000;
const ASK_TIMES = 6;

/** What has come back for each module in this visit to the app. A module that has its pictures is not asked again. */
const answers = new Map<string, Promise<GetPicturesResponse>>();

function loadPictures(chapterKey: string, ref: ChapterRef, module: ModulePlan): Promise<GetPicturesResponse> {
  const key = `${chapterKey}/${module.id}`;
  let answer = answers.get(key);
  if (!answer) {
    answer = fetchPictures({ ...ref, module: { title: module.title, goals: module.goals } });
    answers.set(key, answer);
    // Only a final answer is kept: one that says "being drawn", or a failed request, is asked again next time.
    answer.then(
      (a) => a.status !== "ready" && answers.delete(key),
      () => answers.delete(key),
    );
  }
  return answer;
}

/** The module's pictures, once there are any. Empty while they are being made, and if none can be. */
export function usePictures(chapterKey: string, ref: ChapterRef, module: ModulePlan): ModulePicture[] {
  const [pictures, setPictures] = useState<ModulePicture[]>([]);
  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (times: number) => {
      loadPictures(chapterKey, ref, module).then(
        (answer) => {
          if (gone) return;
          if (answer.status === "ready") setPictures(answer.pictures);
          else if (answer.status === "drawing" && times > 1) timer = setTimeout(() => ask(times - 1), ASK_AGAIN_MS);
        },
        (err: unknown) => console.warn("Pictures could not be loaded:", err),
      );
    };
    ask(ASK_TIMES);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
    // The module, not the objects that describe it, decides which pictures are wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterKey, module.id]);
  return pictures;
}

/** What Ceeq is told of a picture: everything but the picture itself. */
export function noteOf({ id, goal, title, shows, labels, stages }: ModulePicture): PictureNote {
  return { id, goal, title, shows, labels, ...(stages ? { stages } : {}) };
}

/** What Ceeq is told of the pictures when they are ready only after her lesson has begun. */
export function picturesReady(pictures: PictureNote[]): string {
  const list = pictures.map((p) => `"${p.id}" for goal ${p.goal + 1}: ${p.title}${p.labels.length ? ` (names on it: ${p.labels.join(", ")})` : ""}`).join("; ");
  return `(The prepared pictures for this module are ready: ${list}. When you start a goal that has one, the app puts it on the board for you. To show one at another time, add a block {"kind": "picture", "id": "<its id>"}, with one of these ids only.)`;
}

/** What Ceeq is told when the app puts a picture on the board for her. */
export function pictureShown(picture: PictureNote): string {
  const names = picture.labels.length ? ` The names on it, in the order to teach them: ${picture.labels.join(", ")}.` : "";
  const stages = picture.stages?.length ? ` It builds up in ${picture.stages.length} stages, one after another as it appears: ${picture.stages.map((s, i) => `${i + 1}. ${s}`).join(" ")}` : "";
  return `The board now shows the prepared picture "${picture.title}" (id "${picture.id}"): ${picture.shows}${names}${stages} Teach this goal from it, telling the student where to look. Do not draw it yourself, and do not mention this note.`;
}
