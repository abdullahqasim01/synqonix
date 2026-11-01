import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthedRequest, IS_PUBLIC, REQUIRES_SESSION } from '../common/decorators.js';
import { AuthTokenService } from './auth-token.service.js';

export { API_TOKEN_PREFIX } from './auth-token.service.js';

/** Global guard: accepts a session JWT or a personal API token as `Authorization: Bearer`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AuthTokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WebSocket connections authenticate in the gateway's handshake middleware instead.
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new UnauthorizedException();

    req.user = await this.tokens.authenticate(token);

    if (
      req.user.via === 'api-token' &&
      this.reflector.getAllAndOverride<boolean>(REQUIRES_SESSION, targets)
    ) {
      throw new ForbiddenException('This action requires a signed-in session');
    }
    return true;
  }
}
