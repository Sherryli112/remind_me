import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AppController } from '../app.controller';
import { configureApp } from '../app.setup';
import { SchedulerController } from '../scheduler/scheduler.controller';
import { SchedulerService } from '../scheduler/scheduler.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'test-secret-test-secret-test-secret-0000';

/**
 * HTTP 層測試（不需要資料庫）：全域 JWT guard、@Public、throttler + trust proxy、DTO 驗證。
 * 使用與 main.ts 相同的 configureApp()。
 */
describe('Auth HTTP 層', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const authService = {
    register: jest.fn(async (dto: { email: string; timezone?: string }) => ({
      accessToken: 'a',
      refreshToken: 'r',
      user: {
        id: 'u1',
        email: dto.email,
        timezone: dto.timezone ?? 'Asia/Taipei',
      },
    })),
    login: jest.fn(async () => ({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'u1', email: 'x', timezone: 'UTC' },
    })),
    refresh: jest.fn(async () => ({ accessToken: 'a' })),
    logout: jest.fn(async () => undefined),
    getMe: jest.fn(async (id: string) => ({
      id,
      email: 'me@example.com',
      timezone: 'Asia/Taipei',
    })),
    updateMe: jest.fn(),
  };
  const schedulerService = { consumeDue: jest.fn(() => []) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: SECRET,
          signOptions: { expiresIn: '15m', algorithm: 'HS256' },
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
      ],
      controllers: [AuthController, AppController, SchedulerController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SchedulerService, useValue: schedulerService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
    jwt = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('/health 公開', async () => {
    await request(server()).get('/health').expect(200, { status: 'ok' });
  });

  it('受保護端點沒帶 token → 401', async () => {
    await request(server()).get('/auth/me').expect(401);
    await request(server()).get('/scheduler/due').expect(401);
  });

  it('無效 / 錯誤簽章 / 過期的 token → 401', async () => {
    await request(server())
      .get('/auth/me')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
    const forged = new JwtService({
      secret: 'another-secret-another-secret-00000',
    }).sign({ sub: 'u1' });
    await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
    const expired = jwt.sign({ sub: 'u1' }, { expiresIn: -10 });
    await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });

  it('有效 token → @CurrentUser() 拿到 { id: sub }', async () => {
    const token = jwt.sign({ sub: 'user-123' });
    const res = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe('user-123');
    expect(authService.getMe).toHaveBeenCalledWith('user-123');
  });

  it('/scheduler/due 缺少 X-Device-Id → 400；有帶時以 (userId, deviceId) 取佇列', async () => {
    const token = jwt.sign({ sub: 'user-123' });
    await request(server())
      .get('/scheduler/due')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(server())
      .get('/scheduler/due')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-Id', '5b6f2c1e-9d7a-4f7e-8f55-0b0b6a1c2d3e')
      .expect(200, []);
    expect(schedulerService.consumeDue).toHaveBeenCalledWith(
      'user-123',
      '5b6f2c1e-9d7a-4f7e-8f55-0b0b6a1c2d3e',
    );
  });

  it('logout 回 204', async () => {
    await request(server())
      .post('/auth/logout')
      .send({ refreshToken: 'x' })
      .expect(204);
  });

  describe('register DTO 驗證', () => {
    it('email 轉小寫並 trim', async () => {
      await request(server())
        .post('/auth/register')
        .send({ email: '  Foo@Example.COM ', password: 'password123' })
        .expect(201);
      expect(authService.register.mock.calls[0][0].email).toBe(
        'foo@example.com',
      );
    });

    it.each([
      [{ email: 'not-an-email', password: 'password123' }],
      [{ email: 'a@example.com', password: 'short' }],
      [{ email: 'a@example.com', password: 'x'.repeat(73) }],
      [{ email: 'a@example.com', password: '密'.repeat(25) }], // 25 字但 75 bytes
      [
        {
          email: 'a@example.com',
          password: 'password123',
          timezone: 'Mars/Olympus',
        },
      ],
      [{ email: 'a@example.com', password: 'password123', timezone: '+08:00' }],
    ])('不合法輸入 → 400 (%j)', async (body) => {
      await request(server()).post('/auth/register').send(body).expect(400);
      expect(authService.register).not.toHaveBeenCalled();
    });

    it('合法的 IANA 時區可以通過', async () => {
      await request(server())
        .post('/auth/register')
        .send({
          email: 'a@example.com',
          password: 'password123',
          timezone: 'America/New_York',
        })
        .expect(201);
    });
  });

  describe('throttler + trust proxy', () => {
    it('同一個 IP 每分鐘第 11 次 /auth/login → 429；不同 X-Forwarded-For 各自計算', async () => {
      const login = (ip: string) =>
        request(server())
          .post('/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: 'a@example.com', password: 'password123' });

      for (let i = 0; i < 10; i++) await login('203.0.113.1').expect(200);
      await login('203.0.113.1').expect(429);
      // 另一個 client IP 不受影響
      await login('203.0.113.2').expect(200);
    });

    it('register / refresh 也有限制', async () => {
      for (let i = 0; i < 10; i++) {
        await request(server())
          .post('/auth/refresh')
          .set('X-Forwarded-For', '198.51.100.7')
          .send({ refreshToken: 'x' })
          .expect(200);
      }
      await request(server())
        .post('/auth/refresh')
        .set('X-Forwarded-For', '198.51.100.7')
        .send({ refreshToken: 'x' })
        .expect(429);
    });
  });
});
