import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'isPublic';
export const REQUIRES_SESSION = 'requiresSession';

/** Skips authentication for a route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route may only be called with a login session (JWT), not a personal API token. */
export const RequiresSession = () => SetMetadata(REQUIRES_SESSION, true);

export interface AuthUser {
  id: string;
  email: string;
  /** Present when authenticated with a login session JWT. */
  sessionId?: string;
  via: 'jwt' | 'api-token';
}

export type AuthedRequest = Request & { user: AuthUser };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
