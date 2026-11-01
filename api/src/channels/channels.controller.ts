import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { ChannelsService } from './channels.service.js';
import {
  ChannelDto, ChannelMemberDto, ChannelMemberInputDto, CreateChannelDto, DirectChannelDto, ListChannelsQueryDto, UpdateChannelDto,
} from './dto/channels.dto.js';

/** Access rules (private channels, DMs, project channels) live in `ChannelAccessService`. */
@ApiTags('channels')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get() @RequirePermission('workspace.read')
  @ApiOkResponse({ type: [ChannelDto] })
  list(@CurrentMembership() m: Membership, @Query() q: ListChannelsQueryDto) {
    return this.channels.list(m, q.includeArchived);
  }

  @Post() @RequirePermission('workspace.read')
  @ApiCreatedResponse({ type: ChannelDto })
  create(@CurrentMembership() m: Membership, @Body() dto: CreateChannelDto) {
    return this.channels.create(m, dto);
  }

  /** Finds or starts the direct conversation with these people. */
  @Post('direct') @HttpCode(200) @RequirePermission('workspace.read')
  @ApiOkResponse({ type: ChannelDto })
  direct(@CurrentMembership() m: Membership, @Body() dto: DirectChannelDto) {
    return this.channels.direct(m, dto.userIds);
  }

  @Get(':channelId') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: ChannelDto })
  get(@CurrentMembership() m: Membership, @Param('channelId') id: string) {
    return this.channels.get(m, id);
  }

  @Patch(':channelId') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: ChannelDto })
  update(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Body() dto: UpdateChannelDto) {
    return this.channels.update(m, id, dto);
  }

  @Post(':channelId/join') @HttpCode(200) @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: ChannelDto })
  join(@CurrentMembership() m: Membership, @Param('channelId') id: string) {
    return this.channels.join(m, id);
  }

  @Post(':channelId/leave') @HttpCode(204) @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  leave(@CurrentMembership() m: Membership, @Param('channelId') id: string) {
    return this.channels.leave(m, id);
  }

  @Get(':channelId/members') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiOkResponse({ type: [ChannelMemberDto] })
  members(@CurrentMembership() m: Membership, @Param('channelId') id: string) {
    return this.channels.members(m, id);
  }

  @Post(':channelId/members') @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiCreatedResponse({ type: [ChannelMemberDto] })
  addMember(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Body() dto: ChannelMemberInputDto) {
    return this.channels.addMember(m, id, dto.userId);
  }

  @Delete(':channelId/members/:userId') @HttpCode(204) @RequirePermission('workspace.read')
  @ApiParam({ name: 'channelId', type: String })
  @ApiParam({ name: 'userId', type: String })
  removeMember(@CurrentMembership() m: Membership, @Param('channelId') id: string, @Param('userId') userId: string) {
    return this.channels.removeMember(m, id, userId);
  }
}
