import {
  CanActivate, createParamDecorator, ExecutionContext, ForbiddenException,
  Injectable, NotFoundException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../common/decorators.js';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { can, type Permission } from './permissions.js';

export const REQUIRED_PERMISSION = 'requiredPermission';

/** Declares the workspace permission a route needs. Enforced by `WorkspaceGuard`. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export type WorkspaceRequest = AuthedRequest & { membership: Membership };

/** The caller's membership in the workspace named by `:workspaceId`. */
export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Membership =>
    ctx.switchToHttp().getRequest<WorkspaceRequest>().membership,
);

/**
 * Resolves the caller's membership of `:workspaceId` and enforces `@RequirePermission`.
 * Non-members get 404 so workspace ids cannot be probed.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<WorkspaceRequest>();
    const workspaceId = req.params.workspaceId as string;

    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.user.id } },
    }).catch(() => null); // malformed ids
    if (!membership) throw new NotFoundException('Workspace not found');

    const needed = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (needed && !can(membership.role, needed)) {
      throw new ForbiddenException("You don't have permission to do that");
    }
    req.membership = membership;
    return true;
  }
}
