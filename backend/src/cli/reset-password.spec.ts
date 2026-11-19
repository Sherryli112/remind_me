import * as bcrypt from 'bcryptjs';
import { Readable } from 'stream';
import { validateNewPassword } from '../auth/password-policy';
import { readFirstLine, resetPassword } from './reset-password';

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
}
interface TokenRow {
  userId: string;
  revokedAt: Date | null;
}

function makePrisma(users: UserRow[], tokens: TokenRow[]) {
  return {
    user: {
      findUnique: jest.fn(({ where }: { where: { email: string } }) =>
        Promise.resolve(users.find((u) => u.email === where.email) ?? null),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { passwordHash: string };
        }) => {
          const u = users.find((x) => x.id === where.id)!;
          u.passwordHash = data.passwordHash;
          return Promise.resolve(u);
        },
      ),
    },
    refreshToken: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { userId: string; revokedAt: null };
          data: { revokedAt: Date };
        }) => {
          let count = 0;
          for (const t of tokens) {
            if (t.userId === where.userId && t.revokedAt === null) {
              t.revokedAt = data.revokedAt;
              count++;
            }
          }
          return Promise.resolve({ count });
        },
      ),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

// bcrypt cost 12 用純 JS 跑比較慢
jest.setTimeout(30_000);

describe('resetPassword（管理員 CLI）', () => {
  it('找到帳號 → 換新密碼並撤銷這個帳號所有登入中的 refresh token', async () => {
    const users = [
      { id: 'u1', email: 'alice@example.com', passwordHash: 'old' },
      { id: 'u2', email: 'bob@example.com', passwordHash: 'bob' },
    ];
    const tokens: TokenRow[] = [
      { userId: 'u1', revokedAt: null },
      { userId: 'u1', revokedAt: null },
      { userId: 'u1', revokedAt: new Date(0) },
      { userId: 'u2', revokedAt: null },
    ];
    const prisma = makePrisma(users, tokens);

    const result = await resetPassword(
      prisma as never,
      '  Alice@Example.COM ',
      'brand-new-pass',
    );

    expect(result).toEqual({
      status: 'ok',
      email: 'alice@example.com',
      revokedSessions: 2,
    });
    expect(await bcrypt.compare('brand-new-pass', users[0].passwordHash)).toBe(
      true,
    );
    expect(users[1].passwordHash).toBe('bob');
    expect(tokens[3].revokedAt).toBeNull();
  });

  it('找不到帳號 → not_found，不會寫入', async () => {
    const prisma = makePrisma([], []);
    const result = await resetPassword(
      prisma as never,
      'nobody@example.com',
      'brand-new-pass',
    );
    expect(result).toEqual({ status: 'not_found' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('密碼不符規則 → invalid_password，不查資料庫', async () => {
    const prisma = makePrisma([], []);
    const result = await resetPassword(
      prisma as never,
      'alice@example.com',
      'short',
    );
    expect(result).toEqual({
      status: 'invalid_password',
      message: '密碼需為 8–72 個字元',
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('validateNewPassword', () => {
  it('8–72 個字元、UTF-8 不超過 72 bytes 才通過', () => {
    expect(validateNewPassword('12345678')).toBeNull();
    expect(validateNewPassword('1234567')).toBe('密碼需為 8–72 個字元');
    expect(validateNewPassword('a'.repeat(72))).toBeNull();
    expect(validateNewPassword('a'.repeat(73))).toBe('密碼需為 8–72 個字元');
    // 中文一個字 3 bytes：25 個字 = 75 bytes，字元數合格但 bytes 超過
    expect(validateNewPassword('密'.repeat(25))).toBe(
      '密碼以 UTF-8 計算不可超過 72 bytes',
    );
  });
});

describe('readFirstLine', () => {
  it('只取第一行，去掉換行（含 Windows 的 \\r\\n）', async () => {
    expect(await readFirstLine(Readable.from(['pass word\nsecond\n']))).toBe(
      'pass word',
    );
    expect(await readFirstLine(Readable.from(['abc', 'def\r\nxyz']))).toBe(
      'abcdef',
    );
    expect(await readFirstLine(Readable.from(['no-newline']))).toBe(
      'no-newline',
    );
  });
});
