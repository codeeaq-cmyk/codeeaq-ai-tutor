import type { CharacterState } from "@codeeaq/shared-types";

// Placeholder until the Rive/Live2D character lands (Milestone 2).
// The animation is driven only by `state`; the backend never controls it directly.
const FACES: Record<CharacterState, string> = {
  idle: "🙂",
  listening: "👂",
  thinking: "🤔",
  talking: "🗣️",
  happy: "😄",
  encouraging: "💪",
  celebrating: "🎉",
};

export function CeeqCharacter({ state }: { state: CharacterState }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`flex h-28 w-28 items-center justify-center rounded-full bg-indigo-100 text-6xl ${
          state === "talking" || state === "thinking" ? "animate-pulse" : ""
        }`}
      >
        {FACES[state]}
      </div>
      <div className="text-lg font-bold tracking-widest text-indigo-700">CEEQ</div>
      <div className="text-xs uppercase text-slate-500">{state}</div>
    </div>
  );
}
