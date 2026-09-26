import { Injectable, Logger } from '@nestjs/common';
import { WHITEBOARD_ACTION_TYPES, type WhiteboardAction } from '@codeeaq/shared-types';

const ALLOWED = new Set<string>(WHITEBOARD_ACTION_TYPES);

@Injectable()
export class WhiteboardService {
  private readonly logger = new Logger(WhiteboardService.name);

  /**
   * Drops anything the LLM returns that is not a known, predefined action.
   * LLM output is untrusted: only whitelisted action types reach the frontend.
   */
  sanitize(actions: unknown): WhiteboardAction[] {
    if (!Array.isArray(actions)) return [];
    return actions.filter((action): action is WhiteboardAction => {
      const ok =
        typeof action === 'object' &&
        action !== null &&
        typeof (action as { type?: unknown }).type === 'string' &&
        ALLOWED.has((action as { type: string }).type);
      if (!ok) this.logger.warn(`Rejected whiteboard action: ${JSON.stringify(action)}`);
      return ok;
    });
  }
}
