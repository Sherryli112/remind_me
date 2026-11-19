// 管理員重設密碼（在主機上透過 deploy/reset-password.sh 執行，不經過 HTTP API）：
//
//   printf '%s\n' "$NEW_PASSWORD" | node dist/cli/reset-password.js user@example.com
//
// 新密碼從 stdin 讀第一行，不放在指令參數裡（避免出現在 ps 與 shell 歷史）。
// 成功後撤銷這個帳號所有 refresh token，所有裝置都要用新密碼重新登入。
//
// 結束代碼：0 成功、1 輸入錯誤或其他錯誤、2 找不到帳號
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BCRYPT_COST, validateNewPassword } from '../auth/password-policy';

type PrismaLike = Pick<PrismaClient, 'user' | 'refreshToken' | '$transaction'>;

export type ResetPasswordResult =
  | { status: 'ok'; email: string; revokedSessions: number }
  | { status: 'invalid_password'; message: string }
  | { status: 'not_found' };

export async function resetPassword(
  prisma: PrismaLike,
  rawEmail: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  const email = rawEmail.trim().toLowerCase();
  const passwordError = validateNewPassword(newPassword);
  if (passwordError)
    return { status: 'invalid_password', message: passwordError };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { status: 'not_found' };

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const [, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { status: 'ok', email, revokedSessions: revoked.count };
}

/** 讀 stdin 的第一行（去掉結尾換行）。 */
export async function readFirstLine(
  stream: NodeJS.ReadableStream,
): Promise<string> {
  let data = '';
  for await (const chunk of stream) {
    data += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (data.includes('\n')) break;
  }
  return data.split(/\r?\n/)[0];
}

async function main(): Promise<number> {
  const email = process.argv[2];
  if (!email) {
    console.error(
      '用法：printf "%s\\n" "<新密碼>" | node dist/cli/reset-password.js <email>',
    );
    return 1;
  }
  const newPassword = await readFirstLine(process.stdin);
  const prisma = new PrismaClient();
  try {
    const result = await resetPassword(prisma, email, newPassword);
    switch (result.status) {
      case 'ok':
        console.log(
          `已重設 ${result.email} 的密碼，並登出 ${result.revokedSessions} 個登入中的裝置。`,
        );
        return 0;
      case 'invalid_password':
        console.error(result.message);
        return 1;
      case 'not_found':
        console.error(`找不到帳號：${email.trim().toLowerCase()}`);
        return 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
