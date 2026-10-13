import { Fragment } from "react";
import type { BoardBlock, BoardColor, FlowStep, PictureLabel } from "@codeeaq/shared-types";
import { MathText } from "./MathText";
import { LABEL_MS, PANEL_MS, STEP_MS, startAt } from "./reveal";

// The three blocks that teach with pictures: kinds side by side (panels), a
// process or a cycle (flow), and one thing with what goes in and out of it
// (labelled). Each is laid out by the app, so the model only has to say what
// is in it, and each is drawn piece by piece (see reveal.ts).

/** Fonts that draw emoji in colour, in the order the common systems have them. */
export const PICTURE_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/** One of the app's pictures, popping up at its moment. `size` is a length in pixels or any CSS length. */
export function Picture({ picture, size, at }: { picture: string; size: number | string; at: number }) {
  return (
    <span className="ink-pop select-none leading-none" style={{ ...startAt(at), fontSize: size, fontFamily: PICTURE_FONT }} aria-hidden>
      {picture}
    </span>
  );
}

/** The colours panels take in turn when none is asked for. */
const PANEL_COLORS: BoardColor[] = ["blue", "green", "amber", "red"];

export function Panels({ block, at }: { block: Extract<BoardBlock, { kind: "panels" }>; at: number }) {
  const count = block.panels.length;
  // A panel on its own keeps the width it would have beside another.
  const columns = count === 1 ? "mx-auto max-w-xs grid-cols-1" : count === 2 ? "grid-cols-2" : count === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4";
  return (
    <div className={`grid gap-2 sm:gap-3 ${columns}`}>
      {block.panels.map((panel, i) => {
        const t = at + i * PANEL_MS;
        const color = `var(--ink-${panel.color ?? PANEL_COLORS[i % PANEL_COLORS.length]})`;
        return (
          <section
            key={i}
            className="ink-rise flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-surface-2"
            style={{ ...startAt(t), borderColor: `color-mix(in oklab, ${color} 40%, var(--line))` }}
          >
            <h3 className="px-2 py-2 text-center text-[13px] font-semibold leading-tight sm:text-base" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>
              <MathText text={panel.title} at={t + 150} />
            </h3>
            <div className="flex flex-1 flex-col items-center gap-2 px-2 pb-3 pt-3 text-center sm:px-3 sm:pb-4">
              {panel.picture && <Picture picture={panel.picture} size="clamp(36px, 9vw, 60px)" at={t + 300} />}
              {panel.text && (
                <p className="text-xs leading-snug sm:text-[15px]">
                  <MathText text={panel.text} at={t + 500} />
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const HEADS = {
  right: { box: "0 0 9 10", d: "M0.5 0.5 L8.5 5 L0.5 9.5 z", size: "h-2.5 w-2.25" },
  left: { box: "0 0 9 10", d: "M8.5 0.5 L0.5 5 L8.5 9.5 z", size: "h-2.5 w-2.25" },
  up: { box: "0 0 10 9", d: "M0.5 8.5 L5 0.5 L9.5 8.5 z", size: "h-2.25 w-2.5" },
  down: { box: "0 0 10 9", d: "M0.5 0.5 L5 8.5 L9.5 0.5 z", size: "h-2.25 w-2.5" },
};

/** The head of an arrow. */
function Head({ dir, at }: { dir: keyof typeof HEADS; at: number }) {
  const head = HEADS[dir];
  return (
    <svg viewBox={head.box} className={`ink-fade shrink-0 ${head.size}`} style={startAt(at)} aria-hidden>
      <path d={head.d} fill="currentColor" />
    </svg>
  );
}

/** A line that draws itself from one end, with a head at either end or none. */
function Stroke({ at, head, from }: { at: number; head: "left" | "right" | null; from: "left" | "right" }) {
  return (
    <span className="flex min-w-0 flex-1 items-center">
      {head === "left" && <Head dir="left" at={at + 260} />}
      <span className={`ink-grow h-0.5 flex-1 rounded bg-current ${from === "right" ? "origin-right" : "origin-left"}`} style={startAt(at)} />
      {head === "right" && <Head dir="right" at={at + 260} />}
    </span>
  );
}

/** The name of a step, in a box of its own when the flow has no pictures, and the few words under it. */
function StepName({ step, at, boxed, className = "" }: { step: FlowStep; at: number; boxed: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className={`text-[13px] font-semibold leading-tight sm:text-base ${boxed ? "inline-block rounded-xl border border-line bg-surface-2 px-2.5 py-2" : ""}`}>
        <MathText text={step.label} at={at} />
      </div>
      {step.note && (
        <div className="mt-1 text-xs leading-snug text-muted sm:text-sm">
          <MathText text={step.note} at={at + 150} />
        </div>
      )}
    </div>
  );
}

/** The arrow from one step to the next when the flow runs across, with what happens on the way written over it. */
function AcrossArrow({ at, label, level }: { at: number; label?: string; level: number }) {
  return (
    // `level` is how far down the steps' middle is: the line is drawn there, under its 16px of writing.
    <div className="mx-1 flex min-w-10 shrink-0 flex-col text-muted" style={{ marginTop: level - 21 }} aria-hidden>
      <span className="ink-fade h-4 whitespace-nowrap px-1 text-center text-[11px] leading-4" style={startAt(at + 150)}>
        {label}
      </span>
      <span className="flex h-2.5 items-center">
        <Stroke at={at} head="right" from="left" />
      </span>
    </div>
  );
}

/** The arrow from one step to the next when the flow runs down, with what happens on the way written beside it. */
function DownArrow({ at, label, inset }: { at: number; label?: string; inset: number }) {
  return (
    <div className="flex items-center gap-2 py-1 text-muted" style={{ paddingLeft: inset }} aria-hidden>
      <span className="flex flex-col items-center">
        <span className="ink-grow-y h-4 w-0.5 origin-top rounded bg-current" style={startAt(at)} />
        <Head dir="down" at={at + 260} />
      </span>
      <span className="ink-fade text-[11px]" style={startAt(at + 150)}>
        {label}
      </span>
    </div>
  );
}

/** What takes the last step of a cycle back to the first: a line under the row, or beside the column on a phone. */
function Return({ at, label, count, beside = false }: { at: number; label?: string; count: number; beside?: boolean }) {
  if (beside) {
    return (
      <div className="absolute bottom-5 left-1 top-5 w-4 text-muted" aria-hidden>
        <div className="ink-wipe-up absolute inset-0 rounded-l-2xl border-y-2 border-l-2 border-current" style={startAt(at)} />
        <span className="absolute -top-1 right-0 translate-x-1/2">
          <Head dir="right" at={at + 600} />
        </span>
      </div>
    );
  }
  return (
    // Its ends stand under the middle of the first and last steps, near enough.
    <div className="relative mt-2 h-6 text-muted" style={{ marginInline: `${42 / count}%` }} aria-hidden>
      <div className="ink-wipe-left absolute inset-0 rounded-b-2xl border-x-2 border-b-2 border-current" style={startAt(at)} />
      <span className="absolute -top-2 left-px -translate-x-1/2">
        <Head dir="up" at={at + 600} />
      </span>
      {label && (
        <span className="ink-fade absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 whitespace-nowrap bg-surface px-2 text-[11px]" style={startAt(at + 350)}>
          {label}
        </span>
      )}
    </div>
  );
}

export function Flow({ block, at }: { block: Extract<BoardBlock, { kind: "flow" }>; at: number }) {
  const { steps, loop } = block;
  const pictured = steps.some((s) => s.picture);
  const size = steps.length > 4 ? 40 : 48;
  const end = at + steps.length * STEP_MS;
  const back = loop ? steps.at(-1)?.then : undefined;
  return (
    <figure className="flex flex-col items-center gap-2">
      {/* Across the board where there is room for it… */}
      <div className="hidden w-full sm:block">
        <div className="flex items-start justify-center">
          {steps.map((step, i) => {
            const t = at + i * STEP_MS;
            return (
              <Fragment key={i}>
                <div className="ink-rise flex min-w-0 max-w-44 flex-1 basis-0 flex-col items-center text-center" style={startAt(t)}>
                  {step.picture && <Picture picture={step.picture} size={size} at={t + 120} />}
                  <StepName step={step} at={t + 250} boxed={!pictured} className={pictured ? "mt-1.5" : ""} />
                </div>
                {i < steps.length - 1 && <AcrossArrow at={t + 550} label={step.then} level={pictured ? size / 2 : 18} />}
              </Fragment>
            );
          })}
        </div>
        {loop && <Return at={end} label={back} count={steps.length} />}
      </div>
      {/* …and down it on a phone. */}
      <div className={`relative flex flex-col items-start sm:hidden ${loop ? "pl-8" : ""}`}>
        {steps.map((step, i) => {
          const t = at + i * STEP_MS;
          return (
            <Fragment key={i}>
              <div className="ink-rise flex items-center gap-3" style={startAt(t)}>
                {pictured && <span className="flex w-11 shrink-0 justify-center">{step.picture && <Picture picture={step.picture} size={38} at={t + 120} />}</span>}
                <StepName step={step} at={t + 250} boxed={!pictured} />
              </div>
              {i < steps.length - 1 && <DownArrow at={t + 550} label={step.then} inset={pictured ? 17 : 14} />}
            </Fragment>
          );
        })}
        {loop && <Return at={end} count={steps.length} beside />}
      </div>
      {back && (
        <div className="ink-fade text-[11px] text-muted sm:hidden" style={startAt(end + 400)}>
          ↺ {back}
        </div>
      )}
      {block.caption && (
        <figcaption className={`ink-fade text-sm text-muted ${loop ? "sm:mt-2" : ""}`} style={startAt(end + (loop ? 600 : 0))}>
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

/** One label beside the thing in the middle, joined to it by a line or an arrow. */
function LabelRow({ label, at }: { label: PictureLabel; at: number }) {
  const left = label.side === "left";
  // "in" points at the middle and "out" at the label, whichever side the label is on.
  const head = label.arrow === "none" ? null : left === (label.arrow === "in") ? "right" : "left";
  // The line starts where the arrow starts; a plain line starts at its label.
  const from = head === "right" ? "left" : head === "left" ? "right" : left ? "left" : "right";
  const chip = (
    <span className="ink-rise flex min-w-0 items-center gap-1 rounded-xl border border-line bg-surface-2 px-1.5 py-1.5 text-xs font-medium leading-tight sm:gap-1.5 sm:px-3 sm:text-[15px]" style={startAt(at)}>
      {label.picture && <Picture picture={label.picture} size="clamp(16px, 4.4vw, 20px)" at={at + 80} />}
      <span className="min-w-0 wrap-anywhere">
        <MathText text={label.text} at={at + 120} />
      </span>
    </span>
  );
  const link = (
    <span className="flex w-4 shrink-0 text-muted sm:w-10" aria-hidden>
      <Stroke at={at + 250} head={head} from={from} />
    </span>
  );
  return (
    <div className={`flex items-center gap-1 ${left ? "justify-end" : ""}`}>
      {left ? chip : link}
      {left ? link : chip}
    </div>
  );
}

export function Labelled({ block, at }: { block: Extract<BoardBlock, { kind: "labelled" }>; at: number }) {
  const left = block.labels.filter((l) => l.side === "left");
  const right = block.labels.filter((l) => l.side === "right");
  // The thing in the middle first, then what is on its left, then what is on its right.
  const order = [...left, ...right];
  const when = (label: PictureLabel) => at + 600 + order.indexOf(label) * LABEL_MS;
  return (
    <figure className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1 sm:gap-x-2">
      <div className="flex flex-col gap-3">
        {left.map((label, i) => (
          <LabelRow key={i} label={label} at={when(label)} />
        ))}
      </div>
      <div className="ink-rise flex max-w-36 flex-col items-center px-1 text-center sm:max-w-48" style={startAt(at)}>
        {block.picture && <Picture picture={block.picture} size="clamp(56px, 14vw, 96px)" at={at + 100} />}
        {block.title && (
          <div className={block.picture ? "mt-1.5 text-sm font-semibold leading-tight sm:text-base" : "rounded-2xl border-2 border-accent bg-accent-soft px-3 py-3 text-base font-semibold leading-tight sm:px-4 sm:text-lg"}>
            <MathText text={block.title} at={at + 250} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {right.map((label, i) => (
          <LabelRow key={i} label={label} at={when(label)} />
        ))}
      </div>
    </figure>
  );
}
