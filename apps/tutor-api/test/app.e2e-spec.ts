import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('tutor-api (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  it('GET /api/health', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200).expect({ status: 'ok' });
  });

  it('POST /api/tutor/message returns a tutor response', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tutor/message')
      .send({
        sessionId: 'session_123',
        studentId: 'student_001',
        message: "I don't understand fractions",
        lessonId: 'fractions_01',
      })
      .expect(200);

    expect(res.body.teaching.strategy).toBe('VISUALIZE');
    expect(res.body.whiteboard.actions.length).toBeGreaterThan(0);
  });

  it('POST /api/tutor/message rejects an invalid body', () => {
    return request(app.getHttpServer()).post('/api/tutor/message').send({ message: 'hi' }).expect(400);
  });

  afterEach(async () => {
    await app.close();
  });
});
