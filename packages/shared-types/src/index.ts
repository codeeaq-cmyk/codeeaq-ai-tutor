// Contracts shared by tutor-web and tutor-api. See README sections 9–12, 16, 20–21.

export const CHARACTER_STATES = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'happy',
  'encouraging',
  'celebrating',
] as const;
export type CharacterState = (typeof CHARACTER_STATES)[number];

export const TEACHING_STATES = [
  'INTRODUCTION',
  'EXPLAINING',
  'ASKING',
  'LISTENING',
  'ASSESSING',
  'RE_EXPLAINING',
  'PRACTICING',
  'COMPLETED',
] as const;
export type TeachingState = (typeof TEACHING_STATES)[number];

export const TEACHING_STRATEGIES = [
  'EXPLAIN',
  'SIMPLIFY',
  'EXAMPLE',
  'ANALOGY',
  'VISUALIZE',
  'DEMONSTRATE',
  'GUIDED_QUESTION',
  'PRACTICE',
  'RECAP',
  'INCREASE_DIFFICULTY',
] as const;
export type TeachingStrategy = (typeof TEACHING_STRATEGIES)[number];

// Whiteboard actions: the only drawing operations the LLM may request.
// The frontend renders them; the LLM never touches the DOM.
interface Positioned {
  id?: string;
  x?: number;
  y?: number;
}

export type WhiteboardAction =
  | { type: 'clear' }
  | ({ type: 'draw_circle'; radius: number } & Positioned)
  | { type: 'divide_circle'; targetId: string; parts: number }
  | ({ type: 'draw_rectangle'; width: number; height: number } & Positioned)
  | { type: 'draw_line'; id?: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'draw_arrow'; id?: string; x1: number; y1: number; x2: number; y2: number }
  | ({ type: 'draw_text'; text: string; fontSize?: number } & Positioned)
  | ({ type: 'draw_number'; value: number; fontSize?: number } & Positioned)
  | ({ type: 'draw_fraction'; numerator: number; denominator: number; size?: number } & Positioned)
  | ({ type: 'draw_grid'; rows: number; cols: number; cellSize: number } & Positioned)
  | { type: 'highlight'; targetId: string; part?: number; color?: string }
  | { type: 'erase'; targetId: string };

export type WhiteboardActionType = WhiteboardAction['type'];

export const WHITEBOARD_ACTION_TYPES: readonly WhiteboardActionType[] = [
  'clear',
  'draw_circle',
  'divide_circle',
  'draw_rectangle',
  'draw_line',
  'draw_arrow',
  'draw_text',
  'draw_number',
  'draw_fraction',
  'draw_grid',
  'highlight',
  'erase',
];

export interface TutorMessageRequest {
  sessionId: string;
  studentId: string;
  message: string;
  lessonId: string;
}

export interface TutorResponse {
  message: { text: string };
  voice: { enabled: boolean };
  character: { state: CharacterState };
  teaching: { strategy: TeachingStrategy; state: TeachingState };
  whiteboard: { actions: WhiteboardAction[] };
  assessment: { required: boolean };
}

export interface CharacterStateEvent {
  type: 'CHARACTER_STATE';
  state: CharacterState;
}

export interface StudentProgress {
  studentId: string;
  topic: string;
  attempts: number;
  correct: number;
  incorrect: number;
  /** Internal estimate only, not an educational measurement. */
  mastery: number;
  lastStrategy: TeachingStrategy | null;
  commonMistakes: string[];
}
