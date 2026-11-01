import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { WorkspaceDto } from '../workspaces/dto/workspace.dto.js';
import { CreateInvitationDto, InvitationDto, InvitationPreviewDto } from './dto/invitation.dto.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @ApiParam({ name: 'workspaceId', type: String })
  @Post('workspaces/:workspaceId/invitations')
  @UseGuards(WorkspaceGuard) @RequirePermission('invitation.manage')
  @ApiCreatedResponse({ type: InvitationDto })
  create(@CurrentMembership() m: Membership, @Body() dto: CreateInvitationDto) {
    return this.invitations.create(m, dto.email, dto.role);
  }

  @Get('workspaces/:workspaceId/invitations')
  @UseGuards(WorkspaceGuard) @RequirePermission('invitation.manage')
  @ApiOkResponse({ type: [InvitationDto] })
  list(@Param('workspaceId') id: string) {
    return this.invitations.listPending(id);
  }

  @ApiParam({ name: 'workspaceId', type: String })
  @Post('workspaces/:workspaceId/invitations/:invitationId/resend')
  @UseGuards(WorkspaceGuard) @RequirePermission('invitation.manage')
  @ApiCreatedResponse({ type: InvitationDto })
  resend(@CurrentMembership() m: Membership, @Param('invitationId') id: string) {
    return this.invitations.resend(m, id);
  }

  @ApiParam({ name: 'workspaceId', type: String })
  @Delete('workspaces/:workspaceId/invitations/:invitationId') @HttpCode(204)
  @UseGuards(WorkspaceGuard) @RequirePermission('invitation.manage')
  revoke(@CurrentMembership() m: Membership, @Param('invitationId') id: string) {
    return this.invitations.revoke(m.workspaceId, id, m.userId);
  }

  /** Public: lets the invite page show what the recipient is joining. */
  @Public()
  @Get('invitations/:token')
  @ApiOkResponse({ type: InvitationPreviewDto })
  preview(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  @Post('invitations/:token/accept')
  @ApiCreatedResponse({ type: WorkspaceDto })
  accept(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.invitations.accept(token, user);
  }

  @Post('invitations/:token/decline') @HttpCode(204)
  decline(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.invitations.decline(token, user);
  }
}
