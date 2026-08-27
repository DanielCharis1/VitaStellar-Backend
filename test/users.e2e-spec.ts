import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let usersService: UsersService;
  let jwtService: JwtService;

  const mockId = randomUUID();
  const userPayload = {
    id: mockId,
    email: `mock-${Date.now()}@example.com`,
    firstName: 'Mock',
    lastName: 'User',
    fullName: 'Mock User',
    country: 'US',
    password: 'ignored',
  } as any;

  const signToken = (sub: string) =>
    jwtService.sign({ sub, email: userPayload.email, role: 'USER' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    usersService = moduleFixture.get<UsersService>(UsersService);
    jwtService = new JwtService({ secret: process.env.JWT_SECRET || 'testsecret' });

    // ensure a user exists for the authenticated requests
    await usersService.create(userPayload);
  });

  afterAll(async () => {
    // cleanup the mock user
    try {
      const repo = (usersService as any).userRepository;
      if (repo) {
        await repo.delete({ id: mockId });
      }
    } catch (e) {
      // ignore
    }
    await app.close();
  });

  it('GET /users/me without a bearer token returns 401', async () => {
    await request(server).get('/users/me').expect(401);
  });

  it('GET /users/me with a malformed bearer token returns 401', async () => {
    await request(server).get('/users/me').set('Authorization', 'Bearer not-a-real-token').expect(401);
  });

  it('GET /users/me with a valid token returns the profile', async () => {
    const res = await request(server)
      .get('/users/me')
      .set('Authorization', `Bearer ${signToken(mockId)}`)
      .expect(200);

    expect(res.body).toHaveProperty('email', userPayload.email);
    expect(res.body).toHaveProperty('fullName', 'Mock User');
    // The response must not leak the password
    expect(res.body).not.toHaveProperty('password');
  });
});
