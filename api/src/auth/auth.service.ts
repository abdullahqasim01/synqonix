import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../common/crypto.js';
import type { Env } from '../config/env.js';
import type { User } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthResponseDto, SessionDto, UserDto } from './dto/auth.dto.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  jti: string;
}

export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  emailVerified: u.emailVerifiedAt !== null,
  createdAt: u.createdAt,
});

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.accessSecret = config.get('JWT_ACCESS_SECRET');
    this.refreshSecret = config.get('JWT_REFRESH_SECRET');
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS');
    this.refreshTtlDays = config.get('REFRESH_TTL_DAYS');
  }

  get refreshMaxAgeMs() {
    return this.refreshTtlDays * DAY_MS;
  }

  // ---------- registration & login ----------

  async register(
    input: { email: string; name: string; password: string },
    client: ClientInfo,
  ): Promise<AuthResponseDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name.trim(),
        passwordHash: await argon2.hash(input.password),
      },
    });
    await this.sendVerification(user);
    return this.startSession(user, client);
  }

  async login(
    input: { email: string; password: string },
    client: ClientInfo,
  ): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Always run a hash verification so timing does not reveal whether the account exists.
    const ok = await argon2
      .verify(user?.passwordHash ?? (await getDummyHash()), input.password)
      .catch(() => false);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.startSession(user, client);
  }

  // ---------- sessions & tokens ----------

  private async startSession(user: User, client: ClientInfo): Promise<AuthResponseDto> {
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        userAgent: client.userAgent?.slice(0, 300),
        ip: client.ip,
      },
    });
    return this.issueTokens(user, session.id);
  }

  private async issueTokens(
    user: User,
    sessionId: string,
  ): Promise<AuthResponseDto> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, sid: sessionId },
      { secret: this.accessSecret, expiresIn: this.accessTtl },
    );
    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, sid: sessionId, jti } satisfies RefreshPayload,
      { secret: this.refreshSecret, expiresIn: Math.floor(this.refreshMaxAgeMs / 1000) },
    );
    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        sessionId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshMaxAgeMs),
      },
    });
    return { user: toUserDto(user), accessToken, expiresIn: this.accessTtl, refreshToken };
  }

  /** Rotates the refresh token. Presenting an already-used token revokes the whole session. */
  async refresh(token: string | undefined): Promise<AuthResponseDto> {
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const payload = await this.jwt
      .verifyAsync<RefreshPayload>(token, { secret: this.refreshSecret })
      .catch(() => null);
    if (!payload) throw new UnauthorizedException('Invalid refresh token');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { session: { include: { user: true } } },
    });
    if (!stored || stored.session.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      // Reuse of a rotated token: assume theft and kill the session.
      await this.revokeSession(stored.sessionId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    await this.prisma.session.update({
      where: { id: stored.sessionId },
      data: { lastUsedAt: new Date() },
    });
    return this.issueTokens(stored.session.user, stored.sessionId);
  }

  async logout(refreshToken: string | undefined, sessionId?: string) {
    let sid = sessionId;
    if (!sid && refreshToken) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(refreshToken) },
      });
      sid = stored?.sessionId;
    }
    if (sid) await this.revokeSession(sid);
  }

  revokeSession(sessionId: string) {
    return this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(userId: string, currentSessionId?: string): Promise<SessionDto[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === currentSessionId,
    }));
  }

  async revokeUserSession(userId: string, sessionId: string) {
    const res = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new BadRequestException('Session not found');
  }

  // ---------- email verification ----------

  private async createEmailToken(userId: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD', ttlMs: number) {
    // Only the newest token of each type is valid.
    await this.prisma.emailToken.deleteMany({ where: { userId, type, usedAt: null } });
    const token = randomToken();
    await this.prisma.emailToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  private async consumeEmailToken(token: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('This link is invalid or has expired');
    }
    const claimed = await this.prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw new BadRequestException('This link is invalid or has expired');
    return row.userId;
  }

  async sendVerification(user: User) {
    if (user.emailVerifiedAt) return;
    const token = await this.createEmailToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    await this.mail.sendVerificationEmail(user, token);
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) throw new BadRequestException('Email is already verified');
    await this.sendVerification(user);
  }

  async verifyEmail(token: string) {
    const userId = await this.consumeEmailToken(token, 'VERIFY_EMAIL');
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  // ---------- password ----------

  /** Always resolves, so callers cannot probe which emails are registered. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = await this.createEmailToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
    await this.mail.sendPasswordResetEmail(user, token);
  }

  async resetPassword(token: string, password: string) {
    const userId = await this.consumeEmailToken(token, 'RESET_PASSWORD');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(password) },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async changePassword(
    userId: string,
    currentSessionId: string | undefined,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(newPassword) },
      }),
      // Sign out every other device.
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, id: { not: currentSessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}

/** Real argon2id hash of a random string, used to equalise login timing for unknown emails. */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= argon2.hash(randomToken()));
