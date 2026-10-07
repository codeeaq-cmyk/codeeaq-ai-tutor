import type { BoardBlock, BoardColor, DiagramShape } from "@codeeaq/shared-types";
import { DIAGRAM_HEIGHT, DIAGRAM_WIDTH } from "@codeeaq/shared-types";

const ink = (c: BoardColor | undefined, fallback = "var(--fg)") => (c ? `var(--ink-${c})` : fallback);
const FONT = "var(--font-geist-sans), system-ui, sans-serif";
const EDGE = 4;

/** Rough rendered width of text; exact metrics aren't available before paint. */
const textWidth = (text: string, size: number) => text.length * size * 0.56;

/**
 * Keeps a centred label on the canvas: text that would spill over an edge is
 * anchored to that edge instead, and text wider than `maxWidth` is scaled down.
 */
function fit(text: string, x: number, size: number, maxWidth = DIAGRAM_WIDTH - 2 * EDGE) {
  const fontSize = Math.max(8, Math.min(size, (maxWidth / textWidth(text, size)) * size));
  const half = textWidth(text, fontSize) / 2;
  if (x - half < EDGE) return { x: EDGE, anchor: "start" as const, fontSize };
  if (x + half > DIAGRAM_WIDTH - EDGE) return { x: DIAGRAM_WIDTH - EDGE, anchor: "end" as const, fontSize };
  return { x, anchor: "middle" as const, fontSize };
}

function wedge(cx: number, cy: number, r: number, i: number, parts: number) {
  if (parts === 1) return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  const a0 = (2 * Math.PI * i) / parts - Math.PI / 2;
  const a1 = (2 * Math.PI * (i + 1)) / parts - Math.PI / 2;
  return `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
}

function Shape({ shape }: { shape: DiagramShape }) {
  const color = ink(shape.color);
  switch (shape.type) {
    case "circle":
      return (
        <g>
          <circle cx={shape.x} cy={shape.y} r={shape.r} stroke={color} strokeWidth={2} fill={shape.filled ? color : "none"} fillOpacity={0.18} />
          {shape.label && <Label x={shape.x} y={shape.y} text={shape.label} maxWidth={shape.r * 1.8} />}
        </g>
      );
    case "rect":
      return (
        <g>
          <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={4} stroke={color} strokeWidth={2} fill={shape.filled ? color : "none"} fillOpacity={0.18} />
          {shape.label && <Label x={shape.x + shape.w / 2} y={shape.y + shape.h / 2} text={shape.label} maxWidth={shape.w - 8} />}
        </g>
      );
    case "line":
      return (
        <line
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={shape.dashed ? "6 5" : undefined}
          markerEnd={shape.arrow ? "url(#arrow)" : undefined}
          style={{ color }}
        />
      );
    case "polygon":
      return (
        <polygon
          points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          fill={shape.filled ? color : "none"}
          fillOpacity={0.18}
        />
      );
    case "text": {
      const f = fit(shape.text, shape.x, shape.size ?? 14);
      return (
        <text x={f.x} y={shape.y} fill={color} fontSize={f.fontSize} fontFamily={FONT} textAnchor={f.anchor} dominantBaseline="middle">
          {shape.text}
        </text>
      );
    }
    case "pie": {
      const fill = ink(shape.color, "var(--ink-accent)");
      return (
        <g>
          {Array.from({ length: shape.parts }, (_, i) => (
            <path key={i} d={wedge(shape.x, shape.y, shape.r, i, shape.parts)} fill={i < shape.shaded ? fill : "none"} fillOpacity={0.35} stroke="var(--fg)" strokeWidth={1.5} strokeLinejoin="round" />
          ))}
        </g>
      );
    }
    case "bar": {
      const fill = ink(shape.color, "var(--ink-accent)");
      const w = shape.w / shape.parts;
      return (
        <g>
          {Array.from({ length: shape.parts }, (_, i) => (
            <rect key={i} x={shape.x + i * w} y={shape.y} width={w} height={shape.h} fill={i < shape.shaded ? fill : "none"} fillOpacity={0.35} stroke="var(--fg)" strokeWidth={1.5} />
          ))}
        </g>
      );
    }
  }
}

function Label({ x, y, text, maxWidth }: { x: number; y: number; text: string; maxWidth?: number }) {
  const f = fit(text, x, 13, maxWidth);
  return (
    <text x={f.x} y={y} fill="var(--fg)" fontSize={f.fontSize} fontFamily={FONT} textAnchor={f.anchor} dominantBaseline="middle">
      {text}
    </text>
  );
}

function ArrowMarker() {
  return (
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
      </marker>
    </defs>
  );
}

export function Diagram({ block }: { block: Extract<BoardBlock, { kind: "diagram" }> }) {
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg
        viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}
        className="w-full max-w-xl overflow-visible"
        style={{ color: "var(--fg)" }}
        role="img"
        aria-label={block.caption ?? "Diagram"}
      >
        <ArrowMarker />
        {block.shapes.map((shape, i) => (
          <Shape key={i} shape={shape} />
        ))}
      </svg>
      {block.caption && <figcaption className="text-sm text-muted">{block.caption}</figcaption>}
    </figure>
  );
}

/** Roughly 5–10 ticks at 1, 2 or 5 × a power of ten. */
function niceStep(span: number, target = 8) {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function ticks(min: number, max: number, step = niceStep(max - min)) {
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(1) : String(Number(v.toFixed(3))));

export function Graph({ block }: { block: Extract<BoardBlock, { kind: "graph" }> }) {
  const W = 400;
  const H = 260;
  const pad = { l: 40, r: 16, t: 14, b: 34 };
  const sx = (x: number) => pad.l + ((x - block.xMin) / (block.xMax - block.xMin)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - ((y - block.yMin) / (block.yMax - block.yMin)) * (H - pad.t - pad.b);
  const x0 = Math.min(Math.max(0, block.xMin), block.xMax);
  const y0 = Math.min(Math.max(0, block.yMin), block.yMax);
  const legend = block.series.filter((s) => s.label);

  return (
    <figure className="flex flex-col items-center gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-lg" role="img" aria-label="Graph" fontFamily={FONT}>
        {ticks(block.xMin, block.xMax).map((x) => (
          <g key={`x${x}`}>
            <line x1={sx(x)} x2={sx(x)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" />
            <text x={sx(x)} y={H - pad.b + 14} fontSize={10} fill="var(--muted)" textAnchor="middle">{fmt(x)}</text>
          </g>
        ))}
        {ticks(block.yMin, block.yMax).map((y) => (
          <g key={`y${y}`}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(y)} y2={sy(y)} stroke="var(--line)" />
            <text x={pad.l - 6} y={sy(y)} fontSize={10} fill="var(--muted)" textAnchor="end" dominantBaseline="middle">{fmt(y)}</text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={sy(y0)} y2={sy(y0)} stroke="var(--fg)" strokeWidth={1.5} />
        <line x1={sx(x0)} x2={sx(x0)} y1={pad.t} y2={H - pad.b} stroke="var(--fg)" strokeWidth={1.5} />
        {block.series.map((s, i) => {
          const color = ink(s.color, ["var(--ink-accent)", "var(--ink-green)", "var(--ink-amber)", "var(--ink-red)"][i]);
          const inRange = s.points.filter((p) => p.x >= block.xMin && p.x <= block.xMax && p.y >= block.yMin && p.y <= block.yMax);
          return s.style === "points" ? (
            <g key={i} fill={color}>
              {inRange.map((p, j) => <circle key={j} cx={sx(p.x)} cy={sy(p.y)} r={3.5} />)}
            </g>
          ) : (
            <polyline key={i} points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" clipPath="url(#plot)" />
          );
        })}
        <clipPath id="plot">
          <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} />
        </clipPath>
        {block.xLabel && <text x={W - pad.r} y={H - 4} fontSize={11} fill="var(--muted)" textAnchor="end">{block.xLabel}</text>}
        {block.yLabel && <text x={pad.l} y={10} fontSize={11} fill="var(--muted)">{block.yLabel}</text>}
      </svg>
      {legend.length > 0 && (
        <figcaption className="flex flex-wrap justify-center gap-3 text-sm text-muted">
          {block.series.map((s, i) =>
            s.label ? (
              <span key={i} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: ink(s.color, ["var(--ink-accent)", "var(--ink-green)", "var(--ink-amber)", "var(--ink-red)"][i]) }} />
                {s.label}
              </span>
            ) : null,
          )}
        </figcaption>
      )}
    </figure>
  );
}

export function NumberLine({ block }: { block: Extract<BoardBlock, { kind: "number_line" }> }) {
  const W = 400;
  const pad = 20;
  const sx = (v: number) => pad + ((v - block.min) / (block.max - block.min)) * (W - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} 70`} className="w-full max-w-lg" role="img" aria-label="Number line" fontFamily={FONT} style={{ color: "var(--fg)" }}>
      <ArrowMarker />
      <line x1={pad - 10} x2={W - pad + 10} y1={30} y2={30} stroke="var(--fg)" strokeWidth={1.5} markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      {ticks(block.min, block.max, block.step).map((v) => (
        <g key={v}>
          <line x1={sx(v)} x2={sx(v)} y1={24} y2={36} stroke="var(--fg)" />
          <text x={sx(v)} y={52} fontSize={11} fill="var(--muted)" textAnchor="middle">{fmt(v)}</text>
        </g>
      ))}
      {block.marks?.map((m, i) => (
        <g key={i}>
          <circle cx={sx(m.value)} cy={30} r={5} fill="var(--ink-accent)" />
          {m.label && <text x={sx(m.value)} y={16} fontSize={12} fill="var(--ink-accent)" textAnchor="middle" fontWeight={600}>{m.label}</text>}
        </g>
      ))}
    </svg>
  );
}
