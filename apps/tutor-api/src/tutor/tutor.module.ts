import { Module } from '@nestjs/common';
import { WhiteboardModule } from '../whiteboard/whiteboard.module.js';
import { TutorController } from './tutor.controller.js';
import { TutorOrchestratorService } from './tutor-orchestrator.service.js';

@Module({
  imports: [WhiteboardModule],
  controllers: [TutorController],
  providers: [TutorOrchestratorService],
})
export class TutorModule {}
