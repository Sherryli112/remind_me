import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { DEFAULT_TIMEZONE, normalizeTimeZone } from '../common/timezone';
import { PrismaService } from '../prisma/prisma.service';
import {
  emailTaken,
  invalidCredentials,
  invalidCurrentPassword,
  invalidRefreshToken,
  unauthorized,
} from './auth-errors';
import { BCRYPT_COST } from './password-policy';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  UpdateMeDto,
} from './dto/auth.dto';

export { BCRYPT_COST };
const DEFAULT_REFRESH_TTL_DAYS = 30;

export interface PublicUser {
  id: string;
  email: string;
  timezone: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toPublicUser(user: {
  id: string;
  email: string;
  timezone: string;
}): PublicUser {
  return { id: user.id, email: user.email, timezone: user.timezone };
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

@Injectable()
export class AuthService {
  // 帳號不存在時仍跑一次 bcrypt.compare，避免用回應時間推測 email 是否已註冊
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const email = dto.email.trim().toLowerCase();
    const timezone =
      dto.timezone !== undefined
        ? (normalizeTimeZone(dto.timezone) ?? DEFAULT_TIMEZONE)
        : DEFAULT_TIMEZONE;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw emailTaken();

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    let user;
    try {
      user = await this.prisma.user.create({
        data: { email, passwordHash, timezone },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw emailTaken();
      throw e;
    }
    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await bcrypt.compare(dto.password, await this.getDummyHash());
      throw invalidCredentials();
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw invalidCredentials();
    return this.issueTokens(user);
  }

  /** 不輪替：只發新的 access token，refresh token 本身在到期或登出前持續有效。 */
  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
    });
    if (
      !record ||
      record.revokedAt ||
      record.expiresAt.getTime() <= Date.now()
    ) {
      throw invalidRefreshToken();
    }
    return { accessToken: await this.signAccessToken(record.userId) };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized();
    return toPublicUser(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<PublicUser> {
    const timezone = normalizeTimeZone(dto.timezone);
    const exists = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!exists) throw unauthorized();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { timezone: timezone ?? exists.timezone },
    });
    return toPublicUser(user);
  }

  /**
   * 修改密碼：驗證目前密碼 → 換新密碼並撤銷這個帳號所有 refresh token（其他裝置的登入失效）
   * → 發一組新 token 給目前這台裝置，讓它維持登入。
   * 其他裝置手上的 access token 是無狀態 JWT，最多還能用到過期（JWT_ACCESS_TTL，預設 15 分鐘）。
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized();
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw invalidCurrentPassword();

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return this.issueTokens(user);
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    timezone: string;
  }): Promise<AuthTokens> {
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays() * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      },
    });
    return {
      accessToken: await this.signAccessToken(user.id),
      refreshToken,
      user: toPublicUser(user),
    };
  }

  private signAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }

  private refreshTtlDays(): number {
    const raw = this.config.get<string>('REFRESH_TOKEN_TTL_DAYS');
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_REFRESH_TTL_DAYS;
  }

  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await bcrypt.hash(
        'remindme-dummy-password',
        BCRYPT_COST,
      );
    }
    return this.dummyHash;
  }
}
