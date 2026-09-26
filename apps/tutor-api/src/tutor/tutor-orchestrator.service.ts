import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TutorResponse } from '@codeeaq/shared-types';
import { WhiteboardService } from '../whiteboard/whiteboard.service.js';
import type { TutorMessageDto } from './tutor.dto.js';

/**
 * Entry point for every student turn (README section 8).
 *
 * Placeholder: returns the scripted opening of the fractions demo. Intent
 * detection, progress lookup, RAG, the Gemini call and progress saving are
 * added in Milestones 4–7.
 */
@Injectable()
export class TutorOrchestratorService {
  constructor(private readonly whiteboard: WhiteboardService) {}

  startSession(): { sessionId: string } {
    return { sessionId: randomUUID() };
  }

  async handleMessage(_request: TutorMessageDto): Promise<TutorResponse> {
    const llmActions: unknown = [
      { type: 'clear' },
      { type: 'draw_circle', id: 'pizza', x: 400, y: 200, radius: 120 },
      { type: 'divide_circle', targetId: 'pizza', parts: 4 },
    ];

    return {
      message: {
        text: "That's okay. Let me show you. If we take one of these four pieces, what fraction do we have?",
      },
      voice: { enabled: true },
      character: { state: 'talking' },
      teaching: { strategy: 'VISUALIZE', state: 'ASKING' },
      whiteboard: { actions: this.whiteboard.sanitize(llmActions) },
      assessment: { required: true },
    };
  }
}
