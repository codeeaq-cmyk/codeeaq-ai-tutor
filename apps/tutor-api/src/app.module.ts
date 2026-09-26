import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller.js';
import { TutorModule } from './tutor/tutor.module.js';
import { WhiteboardModule } from './whiteboard/whiteboard.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    WhiteboardModule,
    TutorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
