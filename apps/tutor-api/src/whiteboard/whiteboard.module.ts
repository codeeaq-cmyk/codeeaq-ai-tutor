import { Module } from '@nestjs/common';
import { WhiteboardService } from './whiteboard.service.js';

@Module({
  providers: [WhiteboardService],
  exports: [WhiteboardService],
})
export class WhiteboardModule {}
