import type { Shape } from "./whiteboard-state";

const WIDTH = 800;
const HEIGHT = 400;
const STROKE = "currentColor";

function wedgePath(cx: number, cy: number, r: number, part: number, parts: number) {
  const a0 = (2 * Math.PI * part) / parts - Math.PI / 2;
  const a1 = (2 * Math.PI * (part + 1)) / parts - Math.PI / 2;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
}

function renderShape(shape: Shape) {
  const x = "x" in shape ? (shape.x ?? WIDTH / 2) : 0;
  const y = "y" in shape ? (shape.y ?? HEIGHT / 2) : 0;
  const hl = shape.highlight?.color;

  switch (shape.type) {
    case "draw_circle": {
      const parts = shape.parts ?? 1;
      return (
        <g key={shape.key}>
          {hl && shape.highlight?.part !== undefined ? (
            <path d={wedgePath(x, y, shape.radius, shape.highlight.part, parts)} fill={hl} opacity={0.5} />
          ) : null}
          <circle cx={x} cy={y} r={shape.radius} fill="none" stroke={hl ?? STROKE} strokeWidth={3} />
          {parts > 1 &&
            Array.from({ length: parts }, (_, i) => {
              const a = (2 * Math.PI * i) / parts - Math.PI / 2;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={y}
                  x2={x + shape.radius * Math.cos(a)}
                  y2={y + shape.radius * Math.sin(a)}
                  stroke={STROKE}
                  strokeWidth={2}
                />
              );
            })}
        </g>
      );
    }
    case "draw_rectangle":
      return (
        <rect
          key={shape.key}
          x={x - shape.width / 2}
          y={y - shape.height / 2}
          width={shape.width}
          height={shape.height}
          fill={hl ?? "none"}
          fillOpacity={hl ? 0.4 : undefined}
          stroke={STROKE}
          strokeWidth={3}
        />
      );
    case "draw_line":
    case "draw_arrow":
      return (
        <line
          key={shape.key}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={hl ?? STROKE}
          strokeWidth={3}
          markerEnd={shape.type === "draw_arrow" ? "url(#arrowhead)" : undefined}
        />
      );
    case "draw_text":
    case "draw_number":
      return (
        <text key={shape.key} x={x} y={y} fontSize={shape.fontSize ?? 28} textAnchor="middle" fill={hl ?? STROKE}>
          {shape.type === "draw_text" ? shape.text : shape.value}
        </text>
      );
    case "draw_fraction": {
      const size = shape.size ?? 120;
      const fontSize = size * 0.35;
      return (
        <g key={shape.key} fill={hl ?? STROKE} textAnchor="middle">
          <text x={x} y={y - fontSize * 0.25} fontSize={fontSize}>
            {shape.numerator}
          </text>
          <line x1={x - size / 4} y1={y} x2={x + size / 4} y2={y} stroke={hl ?? STROKE} strokeWidth={3} />
          <text x={x} y={y + fontSize * 0.95} fontSize={fontSize}>
            {shape.denominator}
          </text>
        </g>
      );
    }
    case "draw_grid":
      return (
        <g key={shape.key}>
          {Array.from({ length: shape.rows * shape.cols }, (_, i) => (
            <rect
              key={i}
              x={x + (i % shape.cols) * shape.cellSize}
              y={y + Math.floor(i / shape.cols) * shape.cellSize}
              width={shape.cellSize}
              height={shape.cellSize}
              fill={shape.highlight?.part === i ? hl : "none"}
              fillOpacity={0.5}
              stroke={STROKE}
              strokeWidth={2}
            />
          ))}
        </g>
      );
  }
}

export function Whiteboard({ shapes }: { shapes: Shape[] }) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-full w-full text-slate-800"
      role="img"
      aria-label="Ceeq's whiteboard"
    >
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
          <polygon points="0 0, 10 4, 0 8" fill="currentColor" />
        </marker>
      </defs>
      {shapes.map(renderShape)}
    </svg>
  );
}
