// The whiteboard: a list of blocks that lay themselves out top to bottom, and
// are drawn in front of the student one after another as Ceeq speaks.
// The model only sends data. It never sends markup, code or CSS, and nothing
// reaches the screen without passing validateBoardUpdate.
//
// Pictures of real things (a leaf and its parts, a circuit) are drawn for the
// module before the lesson and checked before anyone sees them (see
// pictures.ts); one at a time stands on the board, beside the blocks. Photos
// searched for on the web were tried and dropped: too often they showed
// something else.

export const BOARD_COLORS = ['accent', 'blue', 'green', 'amber', 'red', 'gray'] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

/** Styles of callout. "why" says why the lesson or idea is worth learning. */
export const CALLOUT_TONES = ['why', 'tip', 'remember', 'example', 'question'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Diagram coordinates: a 400 × 240 canvas, origin top-left. */
export const DIAGRAM_WIDTH = 400;
export const DIAGRAM_HEIGHT = 240;

export interface Point {
  x: number;
  y: number;
}

/**
 * One of the app's own drawings, named by the emoji that shows it ("☀️", "🌱",
 * "🔋"). It can only ever be a picture of the thing named.
 */
export type Picture = string;

/** One of the kinds, cases or examples set side by side in a panels block. */
export interface Panel {
  title: string;
  picture?: Picture;
  text?: string;
  color?: BoardColor;
}

/** One step of a flow. `then` is what happens on the way to the next step, written along the arrow. */
export interface FlowStep {
  label: string;
  picture?: Picture;
  note?: string;
  then?: string;
}

/** Something that goes into, comes out of, or belongs to the thing in the middle of a labelled block. */
export interface PictureLabel {
  text: string;
  picture?: Picture;
  side: 'left' | 'right';
  /** "in": an arrow from the label to the thing. "out": from the thing to the label. "none": a plain line. */
  arrow: 'in' | 'out' | 'none';
}

export type DiagramShape =
  | { type: 'circle'; x: number; y: number; r: number; color?: BoardColor; filled?: boolean; label?: string }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color?: BoardColor; filled?: boolean; label?: string }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color?: BoardColor; arrow?: boolean; dashed?: boolean }
  | { type: 'polygon'; points: Point[]; color?: BoardColor; filled?: boolean }
  | { type: 'text'; x: number; y: number; text: string; color?: BoardColor; size?: number }
  /** A picture centred on a point, with an optional label under it. */
  | { type: 'picture'; x: number; y: number; picture: Picture; size?: number; label?: string }
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
  | { kind: 'callout'; id: string; text: string; tone: CalloutTone }
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
  /**
   * The notes of the goal being taught: what the student should carry away,
   * written a line at a time as Ceeq explains. Sent again under the same id,
   * the block grows: lines it does not have yet are added to it.
   */
  | { kind: 'notes'; id: string; title?: string; points: string[] }
  /** Two to four kinds, cases or examples side by side, each with its own picture. */
  | { kind: 'panels'; id: string; panels: Panel[] }
  /** A process, a chain of cause and effect or, with `loop`, a cycle: steps joined by arrows. */
  | { kind: 'flow'; id: string; steps: FlowStep[]; loop?: boolean; caption?: string }
  /**
   * One thing in the middle, with what goes into it, comes out of it or
   * belongs to it on either side. With no labels it is simply a picture and
   * its name.
   */
  | { kind: 'labelled'; id: string; picture?: Picture; title?: string; labels: PictureLabel[] };

export type BoardBlockKind = BoardBlock['kind'];

/** One call of the whiteboard tool, applied in order: clear, remove, add, highlight. */
export interface BoardUpdate {
  clear?: boolean;
  remove?: string[];
  add?: BoardBlock[];
  highlight?: string | null;
  /** The id of a prepared picture to put on the board. The app looks it up (see showPicture). */
  picture?: string;
}

/** A prepared picture, as it stands on the board. */
export interface BoardPicture {
  id: string;
  src: string;
  title: string;
  /** What it shows, for those who cannot see it. */
  alt: string;
  /** For a picture that builds up: how it looks after each stage but the last. It plays them in order. */
  frames?: string[];
  /** The number of the update that put it up, as for blocks (see BoardState.born). */
  born: number;
}

export interface BoardState {
  blocks: BoardBlock[];
  highlight: string | null;
  /**
   * A clear arrived with nothing to put in its place. It is carried out when
   * the next blocks arrive, so the student is never left looking at a blank
   * board while Ceeq talks.
   */
  clearPending?: boolean;
  /**
   * For each block, the number of the update that put it on the board (or
   * last replaced it). Blocks that arrived together are drawn one after the
   * other, and a block that is replaced is drawn afresh.
   */
  born?: Record<string, number>;
  /** How many updates have added something so far. */
  updates?: number;
  /**
   * For a block that was replaced by a longer version of itself (notes, or a
   * list, with lines added): how many of its lines were there already. Those
   * stand as they are; only the new ones are written.
   */
  kept?: Record<string, number>;
  /** The prepared picture on the board, if there is one. It stands below the first heading. */
  picture?: BoardPicture;
}

export const EMPTY_BOARD: BoardState = { blocks: [], highlight: null };

export const MAX_BOARD_BLOCKS = 24;
/** A goal's notes are a few lines, not a page. */
export const MAX_NOTES = 8;

export function applyBoardUpdate(board: BoardState, update: BoardUpdate): BoardState {
  const adding = (update.add?.length ?? 0) > 0;
  const wantsClear = update.clear === true || board.clearPending === true;
  // Wipe only when there is something to show instead; otherwise remember to.
  const wipe = wantsClear && adding;
  const from: BoardState = wipe ? { ...EMPTY_BOARD, updates: board.updates } : { blocks: board.blocks, highlight: board.highlight, born: board.born, updates: board.updates, kept: board.kept };
  const applied = applyTo(from, update);
  // The picture goes with a wipe, like everything else on the board.
  const result = !wipe && board.picture ? { ...applied, picture: board.picture } : applied;
  return wantsClear && !adding && (board.blocks.length > 0 || board.picture) ? { ...result, clearPending: true } : result;
}

/**
 * Puts a prepared picture on the board, in place of any picture there. It is
 * something new to show, so a wipe that was waiting for one is carried out.
 */
export function showPicture(board: BoardState, picture: Omit<BoardPicture, 'born'>): BoardState {
  const updates = (board.updates ?? 0) + 1;
  const kept: BoardState = board.clearPending ? { ...EMPTY_BOARD } : { blocks: board.blocks, highlight: board.highlight, born: board.born, kept: board.kept };
  return { ...kept, updates, picture: { ...picture, born: updates } };
}

function applyTo(board: BoardState, update: BoardUpdate): BoardState {
  let { blocks, highlight } = board;
  if (update.remove?.length) {
    const gone = new Set(update.remove);
    blocks = blocks.filter((b) => !gone.has(b.id));
    if (highlight && gone.has(highlight)) highlight = null;
  }
  const adding = (update.add?.length ?? 0) > 0;
  const updates = (board.updates ?? 0) + (adding ? 1 : 0);
  const stamped: Record<string, number> = {};
  const standing: Record<string, number> = {};
  for (const incoming of update.add ?? []) {
    const index = blocks.findIndex((b) => b.id === incoming.id);
    const old = index === -1 ? undefined : blocks[index];
    const block = old ? grown(old, incoming) : incoming;
    blocks = old ? blocks.map((b, i) => (i === index ? block : b)) : [...blocks, block];
    stamped[block.id] = updates;
    standing[block.id] = old ? sharedLines(old, block) : 0;
  }
  if (blocks.length > MAX_BOARD_BLOCKS) blocks = blocks.slice(-MAX_BOARD_BLOCKS);
  if (update.highlight !== undefined) highlight = update.highlight;
  // Only blocks still on the board keep their number.
  const born: Record<string, number> = {};
  const kept: Record<string, number> = {};
  for (const b of blocks) {
    born[b.id] = stamped[b.id] ?? board.born?.[b.id] ?? 0;
    kept[b.id] = standing[b.id] ?? board.kept?.[b.id] ?? 0;
  }
  return { blocks, highlight, born, updates, kept };
}

/** The lines of a block that is written a line at a time. */
function linesOf(block: BoardBlock): string[] | undefined {
  return block.kind === 'notes' ? block.points : block.kind === 'list' ? block.items : undefined;
}

/**
 * Notes sent again under the same id grow. Ceeq is asked to send every line
 * each time, but sometimes sends only the new one: either way the lines the
 * block already had stay, and those it did not have are added after them.
 */
function grown(old: BoardBlock, incoming: BoardBlock): BoardBlock {
  if (old.kind !== 'notes' || incoming.kind !== 'notes') return incoming;
  const points = [...old.points, ...incoming.points.filter((p) => !old.points.includes(p))].slice(-MAX_NOTES);
  return { ...incoming, points };
}

/** How many lines at the top of a replaced block are the same as before. */
function sharedLines(old: BoardBlock, block: BoardBlock): number {
  const before = linesOf(old);
  const after = linesOf(block);
  if (!before || !after || old.kind !== block.kind) return 0;
  let n = 0;
  while (n < before.length && n < after.length && before[n] === after[n]) n++;
  return n;
}

/**
 * A new topic begins: what was on the board for the last one is wiped. `since`
 * is how many updates the board had seen when Ceeq began her turn: blocks put
 * up after that already belong to the new topic, and stay. If there are none
 * yet, the board is wiped when the first of them arrives, so that the student
 * is never left looking at a blank board.
 */
export function startTopic(board: BoardState, since: number): BoardState {
  const fresh = board.blocks.filter((b) => (board.born?.[b.id] ?? 0) > since);
  const picture = board.picture && board.picture.born > since ? board.picture : undefined;
  if (fresh.length === board.blocks.length && picture === board.picture) return board;
  if (!fresh.length && !picture) return { ...board, clearPending: true };
  const born: Record<string, number> = {};
  const kept: Record<string, number> = {};
  for (const b of fresh) {
    born[b.id] = board.born?.[b.id] ?? 0;
    kept[b.id] = board.kept?.[b.id] ?? 0;
  }
  const highlight = board.highlight && fresh.some((b) => b.id === board.highlight) ? board.highlight : null;
  return { blocks: fresh, highlight, born, kept, updates: board.updates, ...(picture ? { picture } : {}) };
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

// One emoji: a pictograph, with its variation selector, skin tone or joined parts, or a flag.
const EMOJI = /\p{Extended_Pictographic}\uFE0F?[\u{1F3FB}-\u{1F3FF}]?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*|[\u{1F1E6}-\u{1F1FF}]{2}/u;

// Names the model sometimes writes in place of the emoji itself.
const PICTURE_NAMES: Record<string, Picture> = {
  sun: '☀️', moon: '🌙', star: '⭐', earth: '🌍', globe: '🌍', cloud: '☁️', rain: '🌧️', snow: '❄️', ice: '🧊', water: '💧', drop: '💧',
  fire: '🔥', flame: '🔥', lightning: '⚡', electricity: '⚡', wind: '🌬️', wave: '🌊', sea: '🌊', river: '🏞️', mountain: '⛰️', volcano: '🌋',
  plant: '🌱', seedling: '🌱', leaf: '🍃', tree: '🌳', flower: '🌸', seed: '🌰', fruit: '🍎', apple: '🍎', food: '🍲', rice: '🍚',
  animal: '🐾', cow: '🐄', dog: '🐕', bird: '🐦', fish: '🐟', insect: '🐜', bee: '🐝', butterfly: '🦋', frog: '🐸',
  person: '🧑', student: '🧑‍🎓', teacher: '🧑‍🏫', farmer: '🧑‍🌾', scientist: '🧑‍🔬', people: '👥', family: '👪',
  heart: '🫀', lungs: '🫁', brain: '🧠', eye: '👁️', ear: '👂', tooth: '🦷', bone: '🦴', hand: '✋', muscle: '💪', blood: '🩸',
  cell: '🦠', bacteria: '🦠', virus: '🦠', dna: '🧬', microscope: '🔬', telescope: '🔭', magnet: '🧲', battery: '🔋', bulb: '💡',
  lamp: '💡', plug: '🔌', thermometer: '🌡️', beaker: '🧪', 'test tube': '🧪', flask: '⚗️', atom: '⚛️', gear: '⚙️', rocket: '🚀',
  satellite: '🛰️', car: '🚗', bus: '🚌', train: '🚆', bicycle: '🚲', cycle: '🚲', ship: '🚢', plane: '✈️', ball: '⚽', cricket: '🏏',
  house: '🏠', home: '🏠', school: '🏫', factory: '🏭', hospital: '🏥', bank: '🏦', temple: '🛕', market: '🛒', farm: '🌾', field: '🌾',
  book: '📖', pencil: '✏️', pen: '🖊️', ruler: '📏', clock: '⏰', calendar: '📅', money: '💰', coin: '🪙', scale: '⚖️', balance: '⚖️',
  map: '🗺️', flag: '🚩', india: '🇮🇳', crown: '👑', scroll: '📜', law: '⚖️', vote: '🗳️', phone: '📱', computer: '💻', pot: '🍲',
  kettle: '🫖', cup: '☕', glass: '🥛', spoon: '🥄', salt: '🧂', soap: '🧼', key: '🔑', lock: '🔒', bell: '🔔', mirror: '🪞',
};

/**
 * The picture the model named, or undefined. Only an emoji (or one of a few
 * plain names for one) is taken: a picture is never guessed at, because a wrong
 * one teaches the wrong thing.
 */
function picture(v: unknown): Picture | undefined {
  if (typeof v !== 'string') return undefined;
  const found = EMOJI.exec(v);
  return found ? found[0] : PICTURE_NAMES[v.trim().toLowerCase()];
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
      // Models now and then put the words of a text shape under "label".
      const text = str(v.text ?? v.label, 80);
      if (!num(v.x) || !num(v.y) || !text) return null;
      return optional<DiagramShape>({ type: 'text', x: cx(v.x), y: cy(v.y), text }, { ...common, size: num(v.size) ? clamp(v.size, 8, 48) : undefined });
    }
    case 'picture': {
      const pic = picture(v.picture ?? v.emoji ?? v.text);
      if (!num(v.x) || !num(v.y) || !pic) return null;
      return optional<DiagramShape>({ type: 'picture', x: cx(v.x), y: cy(v.y), picture: pic }, { size: num(v.size) ? clamp(v.size, 16, 120) : undefined, label: str(v.label, 40) });
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
  keypoints: { kind: 'notes' },
  key_points: { kind: 'notes' },
  summary: { kind: 'notes' },
  definition: { kind: 'callout', tone: 'remember' },
  note: { kind: 'callout', tone: 'remember' },
  why: { kind: 'callout', tone: 'why' },
  tip: { kind: 'callout', tone: 'tip' },
  example: { kind: 'callout', tone: 'example' },
  question: { kind: 'callout', tone: 'question' },
  compare: { kind: 'panels' },
  comparison: { kind: 'panels' },
  columns: { kind: 'panels' },
  cards: { kind: 'panels' },
  kinds: { kind: 'panels' },
  process: { kind: 'flow' },
  sequence: { kind: 'flow' },
  chain: { kind: 'flow' },
  timeline: { kind: 'flow' },
  cycle: { kind: 'flow', loop: true },
  labeled: { kind: 'labelled' },
  parts: { kind: 'labelled' },
};

/** Fills common slips: an alias kind, or content under a neighbouring field name. */
function normalise(v: Obj): Obj {
  const alias = typeof v.kind === 'string' ? KIND_ALIASES[v.kind.toLowerCase()] : undefined;
  const out: Obj = alias ? { ...v, ...alias, tone: v.tone ?? alias.tone, ordered: v.ordered ?? alias.ordered } : { ...v };
  // The contents of the three picture blocks, under the names models reach for.
  if (out.kind === 'panels' && out.panels === undefined) out.panels = out.items ?? out.columns ?? out.cards;
  if (out.kind === 'flow' && out.steps === undefined) out.steps = out.items ?? out.stages;
  if (out.kind === 'labelled' && out.labels === undefined) out.labels = out.items ?? out.parts;
  if (out.kind === 'notes' && out.points === undefined) out.points = out.items ?? out.notes ?? out.lines ?? (typeof out.text === 'string' ? out.text.split(/\n+/) : undefined);
  if (out.kind === 'math' && out.latex === undefined) out.latex = out.text;
  if ((out.kind === 'heading' || out.kind === 'text' || out.kind === 'callout') && out.text === undefined) {
    out.text = out.latex ?? (Array.isArray(out.items) ? out.items.join(' ') : undefined);
  }
  // The lines of a list, under the other names for them, or as one piece of text.
  if (out.kind === 'list' && out.items === undefined) {
    out.items = out.points ?? out.steps ?? out.lines ?? (typeof out.text === 'string' ? out.text.split(/\n+/) : undefined);
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
      const tone = CALLOUT_TONES.find((t) => t === v.tone) ?? 'tip';
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
      const given = num(v.xMin) && num(v.xMax) && num(v.yMin) && num(v.yMax) && v.xMax > v.xMin && v.yMax > v.yMin;
      // With no range, or an impossible one, the axes are made to fit the points (and to show zero when it is near).
      const range = given ? { xMin: v.xMin as number, xMax: v.xMax as number, yMin: v.yMin as number, yMax: v.yMax as number } : rangeOf(series);
      if (!range) return null;
      return optional<BoardBlock>({ kind: 'graph', id, ...range, series }, { xLabel: str(v.xLabel, 40), yLabel: str(v.yLabel, 40) });
    }
    case 'diagram': {
      const shapes = Array.isArray(v.shapes)
        ? v.shapes.slice(0, MAX_SHAPES).map(shape).filter((s): s is DiagramShape => s !== null)
        : [];
      return shapes.length ? optional<BoardBlock>({ kind: 'diagram', id, shapes }, { caption: str(v.caption, 120) }) : null;
    }
    case 'notes': {
      const points = strings(v.points, MAX_NOTES);
      return points ? optional<BoardBlock>({ kind: 'notes', id, points }, { title: str(v.title, 40) }) : null;
    }
    case 'panels': {
      const panels = (Array.isArray(v.panels) ? v.panels : []).filter(isObj).slice(0, 4).flatMap((p) => {
        const title = str(p.title ?? p.label ?? p.heading, 40);
        if (!title) return [];
        return [optional<Panel>({ title }, { picture: picture(p.picture ?? p.emoji ?? p.icon), text: str(p.text ?? p.caption ?? p.note, 140), color: color(p.color) })];
      });
      // One panel compares nothing, but is still a picture with its name and a line about it.
      return panels.length ? { kind: 'panels', id, panels } : null;
    }
    case 'flow': {
      const steps = (Array.isArray(v.steps) ? v.steps : []).slice(0, 6).flatMap((raw) => {
        // A bare string is a step with nothing but its name.
        const s: unknown = typeof raw === 'string' ? { label: raw } : raw;
        if (!isObj(s)) return [];
        const label = str(s.label ?? s.title ?? s.text, 40);
        if (!label) return [];
        return [optional<FlowStep>({ label }, { picture: picture(s.picture ?? s.emoji ?? s.icon), note: str(s.note ?? s.caption, 80), then: str(s.then ?? s.arrow, 30) })];
      });
      if (steps.length < 2) return null;
      // Only a cycle has anything happening after its last step.
      if (v.loop !== true) delete steps[steps.length - 1].then;
      return optional<BoardBlock>({ kind: 'flow', id, steps }, { loop: v.loop === true || undefined, caption: str(v.caption, 120) });
    }
    case 'labelled': {
      const labels = (Array.isArray(v.labels) ? v.labels : []).slice(0, 6).flatMap((raw, i) => {
        const l: unknown = typeof raw === 'string' ? { text: raw } : raw;
        if (!isObj(l)) return [];
        const text = str(l.text ?? l.label, 60);
        if (!text) return [];
        const arrow = l.arrow === 'in' || l.arrow === 'out' ? l.arrow : 'none';
        // Unless told: what goes in stands on the left, what comes out on the right, and the rest take sides by turns.
        const side = l.side === 'left' || l.side === 'right' ? l.side : arrow === 'in' ? 'left' : arrow === 'out' ? 'right' : i % 2 === 0 ? 'left' : 'right';
        return [optional<PictureLabel>({ text, side, arrow }, { picture: picture(l.picture ?? l.emoji ?? l.icon) })];
      });
      const pic = picture(v.picture ?? v.emoji);
      const title = str(v.title ?? v.text, 40);
      // The middle needs something to show: a picture, or failing that its name.
      if (!pic && !title) return null;
      return optional<BoardBlock>({ kind: 'labelled', id, labels }, { picture: pic, title });
    }
    default:
      return null;
  }
}

/** Axes that take in every point of the series, or undefined when there are no points to fit. */
function rangeOf(series: GraphSeries[]): { xMin: number; xMax: number; yMin: number; yMax: number } | undefined {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return undefined;
  const fit = (values: number[]) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    // Start from zero when the values are all on one side of it and not far away.
    const min = low >= 0 && low <= high / 2 ? 0 : low;
    const max = high <= 0 && high >= low / 2 ? 0 : high;
    return max > min ? [min, max] : [min - 1, max + 1];
  };
  const [xMin, xMax] = fit(all.map((p) => p.x));
  const [yMin, yMax] = fit(all.map((p) => p.y));
  return { xMin, xMax, yMin, yMax };
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
      // A prepared picture is not a block: it is looked up by its id, and stands beside them.
      if (isObj(raw) && raw.kind === 'picture') {
        const id = str(raw.id, 40) ?? str(raw.picture, 40);
        if (id) update.picture = id;
        else errors.push(`add[${i}] is a picture with no id: give the id of one of the prepared pictures.`);
        return;
      }
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
    'Update the whiteboard next to you. Blocks stack top to bottom automatically and are drawn in front of the student, one after another, as you speak. Every explanation needs something to look at: a prepared picture, or a panels, flow, diagram, graph, number_line or table block, not only text. A prepared picture is shown with a block {"kind": "picture", "id": "<its id>"}; there is one on the board at a time. In panels and flow, a "picture" is ONE emoji, and only where the emoji is that very thing (☀️ the sun, 💧 water, 🔥 a flame, 🔋 a battery, 💡 a bulb, 🧲 a magnet); never use one to stand for a part, a place or an idea, and leave it out whenever in doubt. Keep text short. Re-using an id replaces that block, so you can build a diagram up step by step.',
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
              enum: ['heading', 'text', 'math', 'list', 'callout', 'table', 'number_line', 'graph', 'diagram', 'panels', 'flow', 'notes', 'picture'],
              description:
                'picture: one of the pictures prepared for this module, by its id. panels: kinds, cases or examples side by side. flow: a process, cause and effect, or a cycle, as steps joined by arrows. notes: the lines the student should copy down for the goal you are teaching.',
            },
            id: { type: 'string', description: 'Short unique id, e.g. "def1". For a picture, the id of the prepared picture.' },
            text: { type: 'string', description: 'heading, text, callout. Inline maths goes between $...$.' },
            latex: { type: 'string', description: 'math: a LaTeX formula, e.g. "\\frac{a}{b}" or "\\ce{2H2 + O2 -> 2H2O}".' },
            items: { type: 'array', items: { type: 'string' }, description: 'list items (inline $maths$ allowed).' },
            ordered: { type: 'boolean', description: 'list: numbered steps.' },
            tone: {
              type: 'string',
              enum: [...CALLOUT_TONES],
              description: 'callout style. "why" is for saying why the lesson or idea matters.',
            },
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
            panels: {
              type: 'array',
              description: 'panels: 2 to 4 things set side by side, e.g. the three ways heat travels, or solid, liquid and gas.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Its name, 1 to 3 words.' },
                  picture: { type: 'string', description: 'One emoji, only if it is that very thing.' },
                  text: { type: 'string', description: 'One short line about it.' },
                  color: colorSchema,
                },
                required: ['title'],
              },
            },
            steps: {
              type: 'array',
              description: 'flow: 2 to 6 steps in order, e.g. seed, seedling, plant, flower; or water, vapour, cloud, rain with loop.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'The step, 1 to 3 words.' },
                  picture: { type: 'string', description: 'One emoji, only if it is that very thing.' },
                  note: { type: 'string', description: 'A few words under the step.' },
                  then: { type: 'string', description: 'What happens on the way to the next step, 1 or 2 words written along the arrow, e.g. "evaporation".' },
                },
                required: ['label'],
              },
            },
            loop: { type: 'boolean', description: 'flow: the last step leads back to the first, making a cycle.' },
            points: {
              type: 'array',
              items: { type: 'string' },
              description:
                'notes: the lines of the notes, each a complete statement of at most twelve words (inline $maths$ allowed). Use one notes block for a goal, with the same id every time, and send it with all its lines so far and the new one last: only the new line is written.',
            },
            title: { type: 'string', description: 'notes: a heading for them, if "Notes" will not do.' },
            caption: { type: 'string', description: 'diagram or flow caption.' },
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
