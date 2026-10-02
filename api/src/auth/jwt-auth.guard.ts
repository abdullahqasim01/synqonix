import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { sha256 } from '../common/crypto.js';
import {
  AuthedRequest,
  IS_PUBLIC,
  REQUIRES_SESSION,
} from '../common/decorators.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const API_TOKEN_PREFIX = 'sqx_';

/** Global guard: accepts a session JWT or a personal API token as `Authorization: Bearer`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('JWT_ACCESS_SECRET');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new UnauthorizedException();

    req.user = token.startsWith(API_TOKEN_PREFIX)
      ? await this.fromApiToken(token)
      : await this.fromJwt(token);

    if (
      req.user.via === 'api-token' &&
      this.reflector.getAllAndOverride<boolean>(REQUIRES_SESSION, targets)
    ) {
      throw new ForbiddenException('This action requires a signed-in session');
    }
    return true;
  }

  private async fromJwt(token: string) {
    const payload = await this.jwt
      .verifyAsync<{ sub: string; sid: string }>(token, { secret: this.secret })
      .catch(() => null);
    if (!payload) throw new UnauthorizedException();

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.userId !== payload.sub) {
      throw new UnauthorizedException();
    }
    return {
      id: session.user.id,
      email: session.user.email,
      sessionId: session.id,
      via: 'jwt' as const,
    };
  }

  private async fromApiToken(token: string) {
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) {
      throw new UnauthorizedException();
    }
    // Best-effort usage tracking; not worth failing the request.
    void this.prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { id: row.user.id, email: row.user.email, via: 'api-token' as const };
  }
}
