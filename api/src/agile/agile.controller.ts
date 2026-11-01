import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { BulkResultDto, TaskDetailDto } from '../tasks/dto/task.dto.js';
import {
  BacklogDto, BacklogQueryDto, BurndownDto, CompleteSprintDto, CompleteSprintResultDto, CreateMilestoneDto,
  CreateReleaseDto, CreateSprintDto, EpicProgressDto, FlowDto, FlowQueryDto, ListSprintsQueryDto, MilestoneDto,
  ReleaseDto, ReleaseNotesDto, ShipReleaseDto, SprintDto, SprintTasksDto, StartSprintDto, UpdateMilestoneDto,
  UpdateReleaseDto, UpdateSprintDto, VelocityDto,
} from './dto/agile.dto.js';
import { ReleasesService } from './releases.service.js';
import { ReportsService } from './reports.service.js';
import { SprintsService } from './sprints.service.js';

/**
 * Scrum and Kanban tooling of a project. Access to the project is checked in the services:
 * planning needs write access, sprint lifecycle / releases / milestones need project management rights.
 */
@ApiTags('agile')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'projectId', type: String })
@Controller('workspaces/:workspaceId/projects/:projectId')
export class AgileController {
  constructor(
    private readonly sprints: SprintsService,
    private readonly reports: ReportsService,
    private readonly releases: ReleasesService,
  ) {}

  // ----- sprints -----

  @Get('sprints') @RequirePermission('project.read')
  @ApiOkResponse({ type: [SprintDto] })
  listSprints(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query() q: ListSprintsQueryDto) {
    return this.sprints.list(m, id, q.state);
  }

  @Post('sprints') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: SprintDto })
  createSprint(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateSprintDto) {
    return this.sprints.create(m, id, dto);
  }

  @Get('sprints/:sprintId') @RequirePermission('project.read')
  @ApiOkResponse({ type: SprintDto })
  getSprint(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string) {
    return this.sprints.get(m, id, sprintId);
  }

  @Patch('sprints/:sprintId') @RequirePermission('project.read')
  @ApiOkResponse({ type: SprintDto })
  updateSprint(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string, @Body() dto: UpdateSprintDto) {
    return this.sprints.update(m, id, sprintId, dto);
  }

  @Delete('sprints/:sprintId') @HttpCode(204) @RequirePermission('project.read')
  deleteSprint(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string) {
    return this.sprints.remove(m, id, sprintId);
  }

  @Post('sprints/:sprintId/start') @HttpCode(200) @RequirePermission('project.read')
  @ApiOkResponse({ type: SprintDto })
  startSprint(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string, @Body() dto: StartSprintDto) {
    return this.sprints.start(m, id, sprintId, dto);
  }

  @Post('sprints/:sprintId/complete') @HttpCode(200) @RequirePermission('project.read')
  @ApiOkResponse({ type: CompleteSprintResultDto })
  completeSprint(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string, @Body() dto: CompleteSprintDto) {
    return this.sprints.complete(m, id, sprintId, dto);
  }

  @Post('sprints/:sprintId/tasks') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: BulkResultDto })
  addTasks(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string, @Body() dto: SprintTasksDto) {
    return this.sprints.addTasks(m, id, sprintId, dto.taskIds);
  }

  @Delete('sprints/:sprintId/tasks/:taskRef') @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskDetailDto })
  removeTask(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string, @Param('taskRef') ref: string) {
    return this.sprints.removeTask(m, id, sprintId, ref);
  }

  @Get('sprints/:sprintId/burndown') @RequirePermission('project.read')
  @ApiOkResponse({ type: BurndownDto })
  burndown(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('sprintId') sprintId: string) {
    return this.reports.burndown(m, id, sprintId);
  }

  // ----- backlog & reports -----

  @Get('backlog') @RequirePermission('task.read')
  @ApiOkResponse({ type: BacklogDto })
  backlog(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query() q: BacklogQueryDto) {
    return this.sprints.backlog(m, id, q);
  }

  @Get('velocity') @RequirePermission('project.read')
  @ApiOkResponse({ type: VelocityDto })
  velocity(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query('limit') limit?: string) {
    return this.reports.velocity(m, id, Math.min(Math.max(Number(limit) || 10, 1), 50));
  }

  @Get('flow') @RequirePermission('project.read')
  @ApiOkResponse({ type: FlowDto })
  flow(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query() q: FlowQueryDto) {
    return this.reports.flow(m, id, q.days);
  }

  @Get('epics') @RequirePermission('project.read')
  @ApiOkResponse({ type: [EpicProgressDto] })
  epics(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.reports.epics(m, id);
  }

  // ----- releases -----

  @Get('releases') @RequirePermission('project.read')
  @ApiOkResponse({ type: [ReleaseDto] })
  listReleases(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.releases.listReleases(m, id);
  }

  @Post('releases') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: ReleaseDto })
  createRelease(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateReleaseDto) {
    return this.releases.createRelease(m, id, dto);
  }

  @Patch('releases/:releaseId') @RequirePermission('project.read')
  @ApiOkResponse({ type: ReleaseDto })
  updateRelease(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('releaseId') rid: string, @Body() dto: UpdateReleaseDto) {
    return this.releases.updateRelease(m, id, rid, dto);
  }

  @Delete('releases/:releaseId') @HttpCode(204) @RequirePermission('project.read')
  deleteRelease(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('releaseId') rid: string) {
    return this.releases.removeRelease(m, id, rid);
  }

  @Post('releases/:releaseId/ship') @HttpCode(200) @RequirePermission('project.read')
  @ApiOkResponse({ type: ReleaseDto })
  ship(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('releaseId') rid: string, @Body() dto: ShipReleaseDto) {
    return this.releases.ship(m, id, rid, dto);
  }

  @Get('releases/:releaseId/notes') @RequirePermission('project.read')
  @ApiOkResponse({ type: ReleaseNotesDto })
  notes(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('releaseId') rid: string) {
    return this.releases.notes(m, id, rid);
  }

  // ----- milestones -----

  @Get('milestones') @RequirePermission('project.read')
  @ApiOkResponse({ type: [MilestoneDto] })
  listMilestones(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.releases.listMilestones(m, id);
  }

  @Post('milestones') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: MilestoneDto })
  createMilestone(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateMilestoneDto) {
    return this.releases.createMilestone(m, id, dto);
  }

  @Patch('milestones/:milestoneId') @RequirePermission('project.read')
  @ApiOkResponse({ type: MilestoneDto })
  updateMilestone(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('milestoneId') mid: string, @Body() dto: UpdateMilestoneDto) {
    return this.releases.updateMilestone(m, id, mid, dto);
  }

  @Delete('milestones/:milestoneId') @HttpCode(204) @RequirePermission('project.read')
  deleteMilestone(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('milestoneId') mid: string) {
    return this.releases.removeMilestone(m, id, mid);
  }
}
