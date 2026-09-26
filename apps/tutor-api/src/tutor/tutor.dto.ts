import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { TutorMessageRequest } from '@codeeaq/shared-types';

export class StartSessionDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  lessonId: string;
}

export class TutorMessageDto implements TutorMessageRequest {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @IsString()
  @IsNotEmpty()
  lessonId: string;
}
