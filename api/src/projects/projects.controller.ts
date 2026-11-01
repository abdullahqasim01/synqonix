import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import {
  CreateLabelDto, CreateProjectDto, DeleteStatusQueryDto, CreateStatusDto, LabelDto, ListProjectsQueryDto, ProjectDetailDto,
  ProjectDto, ProjectMemberDto, ReorderStatusesDto, SetProjectMemberDto, StatusDto, UpdateLabelDto,
  UpdateProjectDto, UpdateStatusDto,
} from './dto/project.dto.js';
import { ProjectsService } from './projects.service.js';

/**
 * Workspace-level permissions gate entry; fine-grained project rules (lead, project admin,
 * private visibility) are enforced in `ProjectsService`.
 */
@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get() @RequirePermission('project.read')
  @ApiOkResponse({ type: [ProjectDto] })
  list(@CurrentMembership() m: Membership, @Query() q: ListProjectsQueryDto) {
    return this.projects.list(m, q.includeArchived);
  }

  @Post() @RequirePermission('project.create')
  @ApiCreatedResponse({ type: ProjectDetailDto })
  create(@CurrentMembership() m: Membership, @Body() dto: CreateProjectDto) {
    return this.projects.create(m, dto);
  }

  @Get(':projectId') @RequirePermission('project.read')
  @ApiOkResponse({ type: ProjectDetailDto })
  get(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.projects.get(m, id);
  }

  @Patch(':projectId') @RequirePermission('project.read')
  @ApiOkResponse({ type: ProjectDto })
  update(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(m, id, dto);
  }

  @Post(':projectId/archive') @HttpCode(200) @RequirePermission('project.read')
  @ApiOkResponse({ type: ProjectDto })
  archive(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.projects.setArchived(m, id, true);
  }

  @Post(':projectId/restore') @HttpCode(200) @RequirePermission('project.read')
  @ApiOkResponse({ type: ProjectDto })
  restore(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.projects.setArchived(m, id, false);
  }

  @Delete(':projectId') @HttpCode(204) @RequirePermission('project.delete')
  remove(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.projects.remove(m, id);
  }

  // ----- members -----

  @Get(':projectId/members') @RequirePermission('project.read')
  @ApiOkResponse({ type: [ProjectMemberDto] })
  members(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.projects.listMembers(m, id);
  }

  @Put(':projectId/members') @RequirePermission('project.read')
  @ApiOkResponse({ type: [ProjectMemberDto] })
  setMember(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: SetProjectMemberDto) {
    return this.projects.setMember(m, id, dto);
  }

  @Delete(':projectId/members/:userId') @HttpCode(204) @RequirePermission('project.read')
  removeMember(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('userId') userId: string) {
    return this.projects.removeMember(m, id, userId);
  }

  // ----- workflow statuses -----

  @Get(':projectId/statuses') @RequirePermission('project.read')
  @ApiOkResponse({ type: [StatusDto] })
  statuses(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.projects.statuses(m, id);
  }

  @Post(':projectId/statuses') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: StatusDto })
  createStatus(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateStatusDto) {
    return this.projects.createStatus(m, id, dto);
  }

  @Put(':projectId/statuses/order') @RequirePermission('project.read')
  @ApiOkResponse({ type: [StatusDto] })
  reorderStatuses(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: ReorderStatusesDto) {
    return this.projects.reorderStatuses(m, id, dto.ids);
  }

  @Patch(':projectId/statuses/:statusId') @RequirePermission('project.read')
  @ApiOkResponse({ type: StatusDto })
  updateStatus(
    @CurrentMembership() m: Membership, @Param('projectId') id: string,
    @Param('statusId') statusId: string, @Body() dto: UpdateStatusDto,
  ) {
    return this.projects.updateStatus(m, id, statusId, dto);
  }

  @Delete(':projectId/statuses/:statusId') @HttpCode(204) @RequirePermission('project.read')
  removeStatus(
    @CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('statusId') statusId: string,
    @Query() q: DeleteStatusQueryDto,
  ) {
    return this.projects.removeStatus(m, id, statusId, q.moveTo);
  }

  // ----- labels -----

  @Get(':projectId/labels') @RequirePermission('project.read')
  @ApiOkResponse({ type: [LabelDto] })
  labels(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.projects.labels(m, id);
  }

  @Post(':projectId/labels') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: LabelDto })
  createLabel(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateLabelDto) {
    return this.projects.createLabel(m, id, dto);
  }

  @Patch(':projectId/labels/:labelId') @RequirePermission('project.read')
  @ApiOkResponse({ type: LabelDto })
  updateLabel(
    @CurrentMembership() m: Membership, @Param('projectId') id: string,
    @Param('labelId') labelId: string, @Body() dto: UpdateLabelDto,
  ) {
    return this.projects.updateLabel(m, id, labelId, dto);
  }

  @Delete(':projectId/labels/:labelId') @HttpCode(204) @RequirePermission('project.read')
  removeLabel(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('labelId') labelId: string) {
    return this.projects.removeLabel(m, id, labelId);
  }
}
