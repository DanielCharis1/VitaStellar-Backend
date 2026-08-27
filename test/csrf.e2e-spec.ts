import { Controller, Get, Post, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { CsrfMiddleware } from '../src/common/middleware/csrf.middleware';

@Controller('test')
class TestController {
  @Get()
  get() {
    return { ok: true };
  }

  @Post()
  post() {
    return { ok: true };
  }
}

/**
 * Boots a minimal app with the same CSRF-relevant wiring that `src/main.ts`
 * uses (via `configureApp`): cookie parsing first, then the CSRF middleware.
 * This proves the production wiring end-to-end without depending on the rest
 * of the application module graph.
 */
async function createCsrfApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TestController],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  const csrfMiddleware = new CsrfMiddleware();
  app.use((req, res, next) => csrfMiddleware.use(req, res, next));
  await app.init();
  return app;
}

describe('CSRF protection (e2e)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    app = await createCsrfApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET passes the middleware and returns the expected response instead of 500', async () => {
    const res = await request(server).get('/test').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET sets a CSRF cookie', async () => {
    const res = await request(server).get('/test').expect(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie).toBeDefined();
    expect(setCookie.some((c) => c.startsWith('csrf-token='))).toBe(true);
  });

  it('POST without a CSRF token returns 403 (not a 500 TypeError)', async () => {
    const res = await request(server).post('/test').send({}).expect(403);
    expect(res.body.message).toBe('CSRF token missing');
  });

  it('POST with a matching CSRF cookie + header passes through the middleware', async () => {
    // Obtain the CSRF cookie from a safe GET request
    const getRes = await request(server).get('/test').expect(200);
    const setCookie = getRes.headers['set-cookie'] as unknown as string[];
    const csrfCookie = setCookie.find((c) => c.startsWith('csrf-token='));
    const csrfToken = csrfCookie.split(';')[0].split('=')[1];

    const res = await request(server)
      .post('/test')
      .set('Cookie', `csrf-token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({})
      .expect(201); // Nest default status for POST

    expect(res.body).toEqual({ ok: true });
  });

  it('POST with a mismatched CSRF token returns 403', async () => {
    const res = await request(server)
      .post('/test')
      .set('Cookie', 'csrf-token=real-token')
      .set('x-csrf-token', 'wrong-token')
      .send({})
      .expect(403);

    expect(res.body.message).toBe('Invalid CSRF token');
  });
});
