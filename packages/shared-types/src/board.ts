// The whiteboard: a list of blocks that lay themselves out top to bottom.
// The model only sends data. It never sends markup, code or CSS, and nothing
// reaches the screen without passing validateBoardUpdate.

export const BOARD_COLORS = ['accent', 'blue', 'green', 'amber', 'red', 'gray'] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

/** Diagram coordinates: a 400 × 240 canvas, origin top-left. */
export const DIAGRAM_WIDTH = 400;
export const DIAGRAM_HEIGHT = 240;

export interface Point {
  x: number;
  y: number;
}

export type DiagramShape =
  | { type: 'circle'; x: number; y: number; r: number; color?: BoardColor; filled?: boolean; label?: string }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color?: BoardColor; filled?: boolean; label?: string }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color?: BoardColor; arrow?: boolean; dashed?: boolean }
  | { type: 'polygon'; points: Point[]; color?: BoardColor; filled?: boolean }
  | { type: 'text'; x: number; y: number; text: string; color?: BoardColor; size?: number }
  /** A circle cut into equal slices with some shaded, for fractions. */
  | { type: 'pie'; x: number; y: number; r: number; parts: number; shaded: number; color?: BoardColor }
  /** A bar cut into equal parts with some shaded, for fractions. */
  | { type: 'bar'; x: number; y: number; w: number; h: number; parts: number; shaded: number; color?: BoardColor };

export interface GraphSeries {
  points: Point[];
  style?: 'line' | 'points';
  color?: BoardColor;
  label?: string;
}

export type BoardBlock =
  | { kind: 'heading'; id: string; text: string }
  /** Text may contain inline maths between $...$. */
  | { kind: 'text'; id: string; text: string }
  | { kind: 'math'; id: string; latex: string }
  | { kind: 'list'; id: string; items: string[]; ordered?: boolean }
  | { kind: 'callout'; id: string; text: string; tone: 'tip' | 'remember' | 'example' | 'question' }
  | { kind: 'table'; id: string; headers: string[]; rows: string[][] }
  | { kind: 'number_line'; id: string; min: number; max: number; step?: number; marks?: { value: number; label?: string }[] }
  | {
      kind: 'graph';
      id: string;
      xMin: number;
      xMax: number;
      yMin: number;
      yMax: number;
      xLabel?: string;
      yLabel?: string;
      series: GraphSeries[];
    }
  | { kind: 'diagram'; id: string; caption?: string; shapes: DiagramShape[] }
  /** A real photo or labelled diagram, found by the app from a short search query. */
  | { kind: 'image'; id: string; query: string; caption?: string };

export type BoardBlockKind = BoardBlock['kind'];

/** One call of the whiteboard tool, applied in order: clear, remove, add, highlight. */
export interface BoardUpdate {
  clear?: boolean;
  remove?: string[];
  add?: BoardBlock[];
  highlight?: string | null;
}

export interface BoardState {
  blocks: BoardBlock[];
  highlight: string | null;
}

export const EMPTY_BOARD: BoardState = { blocks: [], highlight: null };

export const MAX_BOARD_BLOCKS = 24;

export function applyBoardUpdate(board: BoardState, update: BoardUpdate): BoardState {
  let blocks = update.clear ? [] : board.blocks;
  let highlight = update.clear ? null : board.highlight;
  if (update.remove?.length) {
    const gone = new Set(update.remove);
    blocks = blocks.filter((b) => !gone.has(b.id));
    if (highlight && gone.has(highlight)) highlight = null;
  }
  for (const block of update.add ?? []) {
    const index = blocks.findIndex((b) => b.id === block.id);
    blocks = index === -1 ? [...blocks, block] : blocks.map((b, i) => (i === index ? block : b));
  }
  if (blocks.length > MAX_BOARD_BLOCKS) blocks = blocks.slice(-MAX_BOARD_BLOCKS);
  if (update.highlight !== undefined) highlight = update.highlight;
  return { blocks, highlight };
}

// ---------- Validation ----------

const MAX_TEXT = 400;
const MAX_ITEMS = 12;
const MAX_SHAPES = 40;
const MAX_POINTS = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function str(v: unknown, max = MAX_TEXT): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
}

function color(v: unknown): BoardColor | undefined {
  return BOARD_COLORS.find((c) => c === v);
}

function strings(v: unknown, max = MAX_ITEMS): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((s) => str(s)).filter((s): s is string => !!s).slice(0, max);
  return out.length ? out : undefined;
}

function points(v: unknown, clampToCanvas: boolean): Point[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Point[] = [];
  for (const p of v.slice(0, MAX_POINTS)) {
    if (!isObj(p) || !num(p.x) || !num(p.y)) continue;
    out.push(clampToCanvas ? { x: cx(p.x), y: cy(p.y) } : { x: p.x, y: p.y });
  }
  return out.length ? out : undefined;
}

const cx = (v: number) => clamp(v, 0, DIAGRAM_WIDTH);
const cy = (v: number) => clamp(v, 0, DIAGRAM_HEIGHT);
const size = (v: number) => clamp(v, 1, DIAGRAM_WIDTH);

function optional<T extends object>(base: T, extra: Obj): T {
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (base as Obj)[k] = v;
  return base;
}

function shape(v: unknown): DiagramShape | null {
  if (!isObj(v)) return null;
  const common = { color: color(v.color) };
  switch (v.type) {
    case 'circle':
      if (!num(v.x) || !num(v.y) || !num(v.r)) return null;
      return optional<DiagramShape>({ type: 'circle', x: cx(v.x), y: cy(v.y), r: size(v.r) }, { ...common, filled: v.filled === true || undefined, label: str(v.label, 60) });
    case 'rect':
      if (!num(v.x) || !num(v.y) || !num(v.w) || !num(v.h)) return null;
      return optional<DiagramShape>({ type: 'rect', x: cx(v.x), y: cy(v.y), w: size(v.w), h: size(v.h) }, { ...common, filled: v.filled === true || undefined, label: str(v.label, 60) });
    case 'line':
      if (!num(v.x1) || !num(v.y1) || !num(v.x2) || !num(v.y2)) return null;
      return optional<DiagramShape>(
        { type: 'line', x1: cx(v.x1), y1: cy(v.y1), x2: cx(v.x2), y2: cy(v.y2) },
        { ...common, arrow: v.arrow === true || undefined, dashed: v.dashed === true || undefined },
      );
    case 'polygon': {
      const pts = points(v.points, true);
      if (!pts || pts.length < 3) return null;
      return optional<DiagramShape>({ type: 'polygon', points: pts }, { ...common, filled: v.filled === true || undefined });
    }
    case 'text': {
      const text = str(v.text, 80);
      if (!num(v.x) || !num(v.y) || !text) return null;
      return optional<DiagramShape>({ type: 'text', x: cx(v.x), y: cy(v.y), text }, { ...common, size: num(v.size) ? clamp(v.size, 8, 48) : undefined });
    }
    case 'pie':
    case 'bar': {
      if (!num(v.x) || !num(v.y) || !num(v.parts) || !num(v.shaded)) return null;
      const parts = clamp(Math.round(v.parts), 1, 24);
      const shaded = clamp(Math.round(v.shaded), 0, parts);
      if (v.type === 'pie') {
        if (!num(v.r)) return null;
        return optional<DiagramShape>({ type: 'pie', x: cx(v.x), y: cy(v.y), r: size(v.r), parts, shaded }, common);
      }
      if (!num(v.w) || !num(v.h)) return null;
      return optional<DiagramShape>({ type: 'bar', x: cx(v.x), y: cy(v.y), w: size(v.w), h: size(v.h), parts, shaded }, common);
    }
    default:
      return null;
  }
}

// Near-miss names models sometimes use, mapped to real block kinds.
const KIND_ALIASES: Record<string, Obj> = {
  title: { kind: 'heading' },
  subheading: { kind: 'heading' },
  paragraph: { kind: 'text' },
  formula: { kind: 'math' },
  equation: { kind: 'math' },
  bullets: { kind: 'list' },
  points: { kind: 'list' },
  steps: { kind: 'list', ordered: true },
  definition: { kind: 'callout', tone: 'remember' },
  note: { kind: 'callout', tone: 'remember' },
  tip: { kind: 'callout', tone: 'tip' },
  example: { kind: 'callout', tone: 'example' },
  question: { kind: 'callout', tone: 'question' },
  photo: { kind: 'image' },
  picture: { kind: 'image' },
  figure: { kind: 'image' },
};

/** Fills common slips: an alias kind, or content under a neighbouring field name. */
function normalise(v: Obj): Obj {
  const alias = typeof v.kind === 'string' ? KIND_ALIASES[v.kind.toLowerCase()] : undefined;
  const out: Obj = alias ? { ...v, ...alias, tone: v.tone ?? alias.tone } : { ...v };
  if (out.kind === 'math' && out.latex === undefined) out.latex = out.text;
  if ((out.kind === 'heading' || out.kind === 'text' || out.kind === 'callout') && out.text === undefined) {
    out.text = out.latex ?? (Array.isArray(out.items) ? out.items.join(' ') : undefined);
  }
  if (out.kind === 'list' && out.items === undefined && typeof out.text === 'string') {
    out.items = out.text.split(/\n+/);
  }
  return out;
}

function block(raw: unknown, fallbackId: string): BoardBlock | null {
  if (!isObj(raw)) return null;
  const v = normalise(raw);
  const id = typeof v.id === 'string' && ID_RE.test(v.id) ? v.id : fallbackId;
  switch (v.kind) {
    case 'heading':
    case 'text': {
      const text = str(v.text, v.kind === 'heading' ? 120 : MAX_TEXT);
      return text ? { kind: v.kind, id, text } : null;
    }
    case 'math': {
      const latex = str(v.latex, 300);
      return latex ? { kind: 'math', id, latex } : null;
    }
    case 'list': {
      const items = strings(v.items);
      return items ? optional<BoardBlock>({ kind: 'list', id, items }, { ordered: v.ordered === true || undefined }) : null;
    }
    case 'callout': {
      const text = str(v.text);
      const tone = (['tip', 'remember', 'example', 'question'] as const).find((t) => t === v.tone) ?? 'tip';
      return text ? { kind: 'callout', id, text, tone } : null;
    }
    case 'table': {
      const headers = strings(v.headers, 6);
      if (!headers || !Array.isArray(v.rows)) return null;
      const rows = v.rows
        .slice(0, MAX_ITEMS)
        .filter(Array.isArray)
        .map((row: unknown[]) => headers.map((_, i) => str(row[i], 80) ?? ''));
      return rows.length ? { kind: 'table', id, headers, rows } : null;
    }
    case 'number_line': {
      if (!num(v.min) || !num(v.max) || v.max <= v.min) return null;
      const span = v.max - v.min;
      const step = num(v.step) && v.step > 0 && span / v.step <= 40 ? v.step : undefined;
      const marks = Array.isArray(v.marks)
        ? v.marks
            .filter((m): m is Obj => isObj(m) && num(m.value) && (m.value as number) >= (v.min as number) && (m.value as number) <= (v.max as number))
            .slice(0, MAX_ITEMS)
            .map((m) => optional({ value: m.value as number }, { label: str(m.label, 20) }))
        : undefined;
      return optional<BoardBlock>({ kind: 'number_line', id, min: v.min, max: v.max }, { step, marks: marks?.length ? marks : undefined });
    }
    case 'graph': {
      if (!num(v.xMin) || !num(v.xMax) || !num(v.yMin) || !num(v.yMax) || v.xMax <= v.xMin || v.yMax <= v.yMin) return null;
      const series: GraphSeries[] = Array.isArray(v.series)
        ? v.series
            .filter(isObj)
            .slice(0, 4)
            .flatMap((s) => {
              const pts = points(s.points, false);
              if (!pts) return [];
              const style = s.style === 'points' ? 'points' : 'line';
              return [optional({ points: pts, style } as GraphSeries, { color: color(s.color), label: str(s.label, 40) })];
            })
        : [];
      return optional<BoardBlock>(
        { kind: 'graph', id, xMin: v.xMin, xMax: v.xMax, yMin: v.yMin, yMax: v.yMax, series },
        { xLabel: str(v.xLabel, 40), yLabel: str(v.yLabel, 40) },
      );
    }
    case 'diagram': {
      const shapes = Array.isArray(v.shapes)
        ? v.shapes.slice(0, MAX_SHAPES).map(shape).filter((s): s is DiagramShape => s !== null)
        : [];
      return shapes.length ? optional<BoardBlock>({ kind: 'diagram', id, shapes }, { caption: str(v.caption, 120) }) : null;
    }
    case 'image': {
      // Only a search phrase is accepted, never a URL: the app chooses the source.
      const query = str(v.query ?? v.text, 80);
      if (!query || /https?:|\/\//i.test(query)) return null;
      return optional<BoardBlock>({ kind: 'image', id, query }, { caption: str(v.caption, 120) });
    }
    default:
      return null;
  }
}

let autoId = 0;

/**
 * Turns untrusted whiteboard tool arguments into a safe update. Anything
 * malformed is dropped and reported, so the model can correct itself.
 */
export function validateBoardUpdate(args: unknown): { update: BoardUpdate; errors: string[] } {
  const errors: string[] = [];
  const update: BoardUpdate = {};
  if (!isObj(args)) return { update, errors: ['Arguments must be an object.'] };

  if (args.clear === true) update.clear = true;
  const remove = strings(args.remove, MAX_BOARD_BLOCKS);
  if (remove) update.remove = remove;

  if (Array.isArray(args.add)) {
    const add: BoardBlock[] = [];
    args.add.slice(0, 8).forEach((raw, i) => {
      const b = block(raw, `b${++autoId}`);
      if (b) add.push(b);
      else errors.push(`add[${i}] was not a valid block and was skipped.`);
    });
    if (add.length) update.add = add;
  }

  if (typeof args.highlight === 'string') update.highlight = ID_RE.test(args.highlight) ? args.highlight : null;
  else if (args.highlight === null) update.highlight = null;

  return { update, errors };
}

// ---------- Tool schema (what the voice model sees) ----------

const pointSchema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
};

const colorSchema = { type: 'string', enum: [...BOARD_COLORS] };

export const WHITEBOARD_TOOL = {
  name: 'whiteboard',
  description:
    'Update the whiteboard next to you. Blocks stack top to bottom automatically. Every explanation needs a visual block (image, diagram, graph, number_line or table), not only text. Use image for anything that exists in the real world: the app finds a real photo or labelled diagram. Keep text short. Re-using an id replaces that block, so you can build a diagram up step by step.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      clear: { type: 'boolean', description: 'Wipe the board first. Do this when starting a new topic.' },
      remove: { type: 'array', items: { type: 'string' }, description: 'Ids of blocks to remove.' },
      highlight: {
        type: 'string',
        description: 'Id of one block to glow while you talk about it. Empty string to clear the highlight.',
      },
      add: {
        type: 'array',
        description: 'Blocks to add, at most 8 per call.',
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['heading', 'text', 'math', 'list', 'callout', 'table', 'number_line', 'graph', 'diagram', 'image'],
            },
            id: { type: 'string', description: 'Short unique id, e.g. "def1".' },
            text: { type: 'string', description: 'heading, text, callout. Inline maths goes between $...$.' },
            latex: { type: 'string', description: 'math: a LaTeX formula, e.g. "\\frac{a}{b}" or "\\ce{2H2 + O2 -> 2H2O}".' },
            items: { type: 'array', items: { type: 'string' }, description: 'list items (inline $maths$ allowed).' },
            ordered: { type: 'boolean', description: 'list: numbered steps.' },
            tone: { type: 'string', enum: ['tip', 'remember', 'example', 'question'], description: 'callout style.' },
            headers: { type: 'array', items: { type: 'string' }, description: 'table column headers (max 6).' },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table rows.' },
            min: { type: 'number', description: 'number_line start.' },
            max: { type: 'number', description: 'number_line end.' },
            step: { type: 'number', description: 'number_line tick spacing.' },
            marks: {
              type: 'array',
              description: 'number_line points to mark.',
              items: { type: 'object', properties: { value: { type: 'number' }, label: { type: 'string' } }, required: ['value'] },
            },
            xMin: { type: 'number' },
            xMax: { type: 'number' },
            yMin: { type: 'number' },
            yMax: { type: 'number' },
            xLabel: { type: 'string' },
            yLabel: { type: 'string' },
            series: {
              type: 'array',
              description: 'graph: data in graph units. style "line" joins points; "points" plots dots.',
              items: {
                type: 'object',
                properties: {
                  points: { type: 'array', items: pointSchema },
                  style: { type: 'string', enum: ['line', 'points'] },
                  color: colorSchema,
                  label: { type: 'string' },
                },
                required: ['points'],
              },
            },
            query: {
              type: 'string',
              description:
                'image: 2 to 4 plain search keywords naming one real thing; add "diagram" for a labelled diagram. E.g. "insect anatomy diagram", "honey bee", "human heart diagram", "Jallianwala Bagh", "India physical map".',
            },
            caption: { type: 'string', description: 'diagram or image caption.' },
            shapes: {
              type: 'array',
              description: `diagram shapes on a ${DIAGRAM_WIDTH}x${DIAGRAM_HEIGHT} canvas, origin top-left, y grows downward. Draw big: use most of the canvas with a 20px margin. Label things with text shapes placed just outside the figure (size 14). Recipes: triangle = polygon of 3 points + a text label at each vertex; angle or force = line with arrow; ray diagram = lines with arrow for rays, a vertical line for the mirror or lens, dashed line for the principal axis; circuit = rect/line segments with text labels; process or cycle = rects with label joined by arrow lines. pie/bar show fractions: parts equal slices, shaded of them coloured.`,
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['circle', 'rect', 'line', 'polygon', 'text', 'pie', 'bar'] },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  r: { type: 'number' },
                  w: { type: 'number' },
                  h: { type: 'number' },
                  x1: { type: 'number' },
                  y1: { type: 'number' },
                  x2: { type: 'number' },
                  y2: { type: 'number' },
                  points: { type: 'array', items: pointSchema },
                  text: { type: 'string' },
                  label: { type: 'string' },
                  size: { type: 'number' },
                  parts: { type: 'integer' },
                  shaded: { type: 'integer' },
                  filled: { type: 'boolean' },
                  arrow: { type: 'boolean' },
                  dashed: { type: 'boolean' },
                  color: colorSchema,
                },
                required: ['type'],
              },
            },
          },
          required: ['kind', 'id'],
        },
      },
    },
  },
};
