import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./useCamera";

describe("useCamera", () => {
  it("fetches the detector's engine for the version of MediaPipe installed", () => {
    const main = createRequire(import.meta.url).resolve("@mediapipe/tasks-vision");
    const installed = JSON.parse(readFileSync(join(dirname(main), "package.json"), "utf8")).version;
    expect(ENGINE_VERSION).toBe(installed);
  });
});
