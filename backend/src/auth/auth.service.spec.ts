import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { AuthService, hashRefreshToken } from './auth.service';

const SECRET = 'test-secret-test-secret-test-secret-0000';

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  timezone: string;
}
interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

function makePrisma() {
  const users: UserRow[] = [];
  const tokens: TokenRow[] = [];
  const prisma = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; email?: string } }) =>
          users.find((u) =>
            where.id ? u.id === where.id : u.email === where.email,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Omit<UserRow, 'id'> }) => {
        if (users.some((u) => u.email === data.email)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: randomUUID(), ...data };
        users.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<UserRow>;
        }) => {
          const u = users.find((x) => x.id === where.id)!;
          Object.assign(u, data);
          return u;
        },
      ),
    },
    refreshToken: {
      create: jest.fn(
        async ({ data }: { data: Omit<TokenRow, 'id' | 'revokedAt'> }) => {
          const row = { id: randomUUID(), revokedAt: null, ...data };
          tokens.push(row);
          return row;
        },
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { tokenHash: string; revokedAt: null };
          data: { revokedAt: Date };
        }) => {
          let count = 0;
          for (const t of tokens) {
            if (t.tokenHash === where.tokenHash && t.revokedAt === null) {
              t.revokedAt = data.revokedAt;
              count++;
            }
          }
          return { count };
        },
      ),
    },
  };
  return { prisma, users, tokens };
}

function makeService(env: Record<string, string> = {}) {
  const { prisma, users, tokens } = makePrisma();
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '15m', algorithm: 'HS256' },
  });
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const svc = new AuthService(prisma as any, jwt, config);
  return { svc, prisma, users, tokens, jwt };
}

async function expectHttpError(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const err = e as HttpException;
    expect(err.getStatus()).toBe(status);
    expect((err.getResponse() as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`預期丟出 ${status} ${code}`);
}

// bcrypt cost 12 用純 JS 跑比較慢
jest.setTimeout(30_000);

describe('AuthService', () => {
  describe('register', () => {
    it('建立使用者並回傳 tokens 與 { id, email, timezone }', async () => {
      const { svc, users, tokens, jwt } = makeService();
      const res = await svc.register({
        email: '  Alice@Example.COM ',
        password: 'password123',
      });

      expect(Object.keys(res.user).sort()).toEqual(['email', 'id', 'timezone']);
      expect(res.user.email).toBe('alice@example.com');
      expect(res.user.timezone).toBe('Asia/Taipei');
      expect(users[0].passwordHash).not.toBe('password123');
      expect(await bcrypt.compare('password123', users[0].passwordHash)).toBe(
        true,
      );
      expect(bcrypt.getRounds(users[0].passwordHash)).toBe(12);

      const payload = await jwt.verifyAsync<{ sub: string }>(res.accessToken);
      expect(payload.sub).toBe(res.user.id);

      // refresh token 只存 sha256，不落地原文
      expect(tokens).toHaveLength(1);
      expect(tokens[0].tokenHash).toBe(hashRefreshToken(res.refreshToken));
      expect(tokens[0].tokenHash).not.toBe(res.refreshToken);
      expect(res.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    });

    it('有帶 timezone 時使用該時區', async () => {
      const { svc } = makeService();
      const res = await svc.register({
        email: 'b@example.com',
        password: 'password123',
        timezone: 'UTC',
      });
      expect(res.user.timezone).toBe('UTC');
    });

    it('refresh token 預設 30 天到期，可用 REFRESH_TOKEN_TTL_DAYS 調整', async () => {
      const { svc, tokens } = makeService({ REFRESH_TOKEN_TTL_DAYS: '7' });
      const before = Date.now();
      await svc.register({ email: 'c@example.com', password: 'password123' });
      const days = (tokens[0].expiresAt.getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
    });

    it('email 已存在 → 409 EMAIL_TAKEN（大小寫不同也算重複）', async () => {
      const { svc } = makeService();
      await svc.register({ email: 'dup@example.com', password: 'password123' });
      await expectHttpError(
        svc.register({ email: 'DUP@example.com', password: 'password456' }),
        409,
        'EMAIL_TAKEN',
      );
    });

    it('同時註冊撞到 unique constraint（P2002）→ 409 EMAIL_TAKEN', async () => {
      const { svc, prisma } = makeService();
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      await expectHttpError(
        svc.register({ email: 'race@example.com', password: 'password123' }),
        409,
        'EMAIL_TAKEN',
      );
    });
  });

  describe('login', () => {
    it('帳密正確 → 回傳新的 tokens', async () => {
      const { svc, tokens } = makeService();
      const reg = await svc.register({
        email: 'login@example.com',
        password: 'password123',
      });
      const res = await svc.login({
        email: 'LOGIN@example.com ',
        password: 'password123',
      });
      expect(res.user).toEqual(reg.user);
      expect(res.refreshToken).not.toBe(reg.refreshToken);
      expect(tokens).toHaveLength(2);
    });

    it('密碼錯誤 → 401 INVALID_CREDENTIALS', async () => {
      const { svc } = makeService();
      await svc.register({
        email: 'login@example.com',
        password: 'password123',
      });
      await expectHttpError(
        svc.login({ email: 'login@example.com', password: 'wrong-password' }),
        401,
        'INVALID_CREDENTIALS',
      );
    });

    it('帳號不存在 → 同樣是 401 INVALID_CREDENTIALS', async () => {
      const { svc } = makeService();
      await expectHttpError(
        svc.login({ email: 'nobody@example.com', password: 'password123' }),
        401,
        'INVALID_CREDENTIALS',
      );
    });
  });

  describe('refresh / logout', () => {
    it('有效的 refresh token → 新的 access token；refresh token 不輪替、可重複使用', async () => {
      const { svc, jwt } = makeService();
      const reg = await svc.register({
        email: 'r@example.com',
        password: 'password123',
      });
      const a = await svc.refresh(reg.refreshToken);
      const b = await svc.refresh(reg.refreshToken);
      expect(Object.keys(a)).toEqual(['accessToken']);
      expect((await jwt.verifyAsync<{ sub: string }>(a.accessToken)).sub).toBe(
        reg.user.id,
      );
      expect((await jwt.verifyAsync<{ sub: string }>(b.accessToken)).sub).toBe(
        reg.user.id,
      );
    });

    it('不存在的 refresh token → 401 INVALID_REFRESH_TOKEN', async () => {
      const { svc } = makeService();
      await expectHttpError(
        svc.refresh('not-a-real-token'),
        401,
        'INVALID_REFRESH_TOKEN',
      );
    });

    it('過期的 refresh token → 401 INVALID_REFRESH_TOKEN', async () => {
      const { svc, tokens } = makeService();
      const reg = await svc.register({
        email: 'exp@example.com',
        password: 'password123',
      });
      tokens[0].expiresAt = new Date(Date.now() - 1000);
      await expectHttpError(
        svc.refresh(reg.refreshToken),
        401,
        'INVALID_REFRESH_TOKEN',
      );
    });

    it('logout 之後 refresh → 401 INVALID_REFRESH_TOKEN；其他裝置的 token 不受影響', async () => {
      const { svc } = makeService();
      const reg = await svc.register({
        email: 'out@example.com',
        password: 'password123',
      });
      const other = await svc.login({
        email: 'out@example.com',
        password: 'password123',
      });
      await svc.logout(reg.refreshToken);
      await expectHttpError(
        svc.refresh(reg.refreshToken),
        401,
        'INVALID_REFRESH_TOKEN',
      );
      await expect(svc.refresh(other.refreshToken)).resolves.toHaveProperty(
        'accessToken',
      );
    });

    it('logout 不存在的 token 不會丟錯', async () => {
      const { svc } = makeService();
      await expect(svc.logout('whatever')).resolves.toBeUndefined();
    });
  });

  describe('me', () => {
    it('getMe / updateMe 只回傳 { id, email, timezone }，時區會正規化', async () => {
      const { svc } = makeService();
      const reg = await svc.register({
        email: 'me@example.com',
        password: 'password123',
      });
      expect(await svc.getMe(reg.user.id)).toEqual(reg.user);
      const updated = await svc.updateMe(reg.user.id, {
        timezone: 'america/new_york',
      });
      expect(updated).toEqual({ ...reg.user, timezone: 'America/New_York' });
    });

    it('使用者不存在（例如 token 對應的帳號已刪除）→ 401', async () => {
      const { svc } = makeService();
      await expectHttpError(svc.getMe('missing'), 401, 'UNAUTHORIZED');
    });
  });
});
