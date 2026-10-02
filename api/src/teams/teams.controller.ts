import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { AddTeamMemberDto, CreateTeamDto, TeamDto, UpdateTeamDto } from './dto/team.dto.js';
import { TeamsService } from './teams.service.js';

@ApiTags('teams')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@Controller('workspaces/:workspaceId/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get() @RequirePermission('team.read')
  @ApiOkResponse({ type: [TeamDto] })
  list(@Param('workspaceId') ws: string) {
    return this.teams.list(ws);
  }

  @Get(':teamId') @RequirePermission('team.read')
  @ApiOkResponse({ type: TeamDto })
  get(@Param('workspaceId') ws: string, @Param('teamId') id: string) {
    return this.teams.get(ws, id);
  }

  @Post() @RequirePermission('team.manage')
  @ApiCreatedResponse({ type: TeamDto })
  create(@Param('workspaceId') ws: string, @CurrentUser() u: AuthUser, @Body() dto: CreateTeamDto) {
    return this.teams.create(ws, u.id, dto);
  }

  @Patch(':teamId') @RequirePermission('team.manage')
  @ApiOkResponse({ type: TeamDto })
  update(
    @Param('workspaceId') ws: string, @CurrentUser() u: AuthUser,
    @Param('teamId') id: string, @Body() dto: UpdateTeamDto,
  ) {
    return this.teams.update(ws, u.id, id, dto);
  }

  @Delete(':teamId') @HttpCode(204) @RequirePermission('team.manage')
  remove(@Param('workspaceId') ws: string, @CurrentUser() u: AuthUser, @Param('teamId') id: string) {
    return this.teams.remove(ws, u.id, id);
  }

  @Post(':teamId/members') @RequirePermission('team.manage')
  @ApiCreatedResponse({ type: TeamDto })
  addMember(@Param('workspaceId') ws: string, @CurrentUser() u: AuthUser, @Param('teamId') id: string, @Body() dto: AddTeamMemberDto) {
    return this.teams.addMember(ws, u.id, id, dto.userId);
  }

  @Delete(':teamId/members/:userId') @HttpCode(204) @RequirePermission('team.manage')
  removeMember(@Param('workspaceId') ws: string, @Param('teamId') id: string, @Param('userId') userId: string) {
    return this.teams.removeMember(ws, id, userId);
  }
}
