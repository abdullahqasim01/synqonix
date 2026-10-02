import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import {
  AuditLogDto, AuditLogQueryDto, CreateWorkspaceDto, MemberDto, UpdateMemberRoleDto,
  UpdateWorkspaceDto, WorkspaceDto,
} from './dto/workspace.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  @ApiCreatedResponse({ type: WorkspaceDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.id, dto.name);
  }

  @Get()
  @ApiOkResponse({ type: [WorkspaceDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.listMine(user.id);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceGuard) @RequirePermission('workspace.read')
  @ApiOkResponse({ type: WorkspaceDto })
  get(@CurrentMembership() m: Membership) {
    return this.workspaces.get(m);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceGuard) @RequirePermission('workspace.update')
  @ApiOkResponse({ type: WorkspaceDto })
  update(@CurrentMembership() m: Membership, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(m, dto.name);
  }

  @Delete(':workspaceId') @HttpCode(204)
  @UseGuards(WorkspaceGuard) @RequirePermission('workspace.delete')
  remove(@Param('workspaceId') id: string) {
    return this.workspaces.remove(id);
  }

  @Get(':workspaceId/members')
  @UseGuards(WorkspaceGuard) @RequirePermission('member.read')
  @ApiOkResponse({ type: [MemberDto] })
  members(@Param('workspaceId') id: string) {
    return this.workspaces.listMembers(id);
  }

  @Patch(':workspaceId/members/:userId')
  @UseGuards(WorkspaceGuard) @RequirePermission('member.manage')
  @ApiOkResponse({ type: MemberDto })
  changeRole(
    @CurrentMembership() m: Membership,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.workspaces.changeRole(m, userId, dto.role);
  }

  /** Remove a member, or leave the workspace by passing your own user id. */
  @Delete(':workspaceId/members/:userId') @HttpCode(204)
  @UseGuards(WorkspaceGuard) @RequirePermission('member.read')
  removeMember(@CurrentMembership() m: Membership, @Param('userId') userId: string) {
    return this.workspaces.removeMember(m, userId);
  }

  @Get(':workspaceId/audit-log')
  @UseGuards(WorkspaceGuard) @RequirePermission('audit.read')
  @ApiOkResponse({ type: [AuditLogDto] })
  auditLog(@Param('workspaceId') id: string, @Query() q: AuditLogQueryDto) {
    return this.workspaces.auditLog(id, q.limit, q.before);
  }
}
