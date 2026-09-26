import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { TutorResponse } from '@codeeaq/shared-types';
import { TutorOrchestratorService } from './tutor-orchestrator.service.js';
import { StartSessionDto, TutorMessageDto } from './tutor.dto.js';

@Controller('tutor')
export class TutorController {
  constructor(private readonly orchestrator: TutorOrchestratorService) {}

  @Post('session')
  startSession(@Body() _body: StartSessionDto) {
    return this.orchestrator.startSession();
  }

  @Post('message')
  @HttpCode(200)
  message(@Body() body: TutorMessageDto): Promise<TutorResponse> {
    return this.orchestrator.handleMessage(body);
  }
}
