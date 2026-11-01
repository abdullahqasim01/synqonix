import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import {
  BoardDto, BoardQueryDto, BulkResultDto, BulkUpdateTasksDto, CreateTaskDto, ListTasksQueryDto, MoveTaskDto,
  RankTaskDto, RecentTasksQueryDto, TaskDetailDto, TaskDto, TaskListDto, UpdateTaskDto,
} from './dto/task.dto.js';
import { BacklogRankDto } from '../agile/dto/agile.dto.js';
import { TaskMoveService } from './task-move.service.js';
import { RecentTasksService } from './recent-tasks.service.js';
import { TaskRankService } from './task-rank.service.js';
import { TasksService } from './tasks.service.js';

/**
 * Tasks are addressed by uuid or by key (`SYN-12`) so editors and links can use the readable form.
 * Project visibility and write rights are enforced in the services.
 */
@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly moves: TaskMoveService,
    private readonly ranks: TaskRankService,
    private readonly recent: RecentTasksService,
  ) {}

  @Post('projects/:projectId/tasks') @RequirePermission('task.write')
  @ApiCreatedResponse({ type: TaskDetailDto })
  create(@CurrentMembership() m: Membership, @Param('projectId') projectId: string, @Body() dto: CreateTaskDto) {
    return this.tasks.create(m, projectId, dto);
  }

  /** Lists tasks across the projects the caller can see; filter with `projectId`, `assignee=me`, etc. */
  @Get('tasks') @RequirePermission('task.read')
  @ApiOkResponse({ type: TaskListDto })
  list(@CurrentMembership() m: Membership, @Query() q: ListTasksQueryDto) {
    return this.tasks.list(m, q);
  }

  /** Kanban board of a project: columns in workflow order, cards in rank order. */
  @Get('projects/:projectId/board') @RequirePermission('task.read')
  @ApiOkResponse({ type: BoardDto })
  board(@CurrentMembership() m: Membership, @Param('projectId') projectId: string, @Query() q: BoardQueryDto) {
    return this.tasks.board(m, projectId, q);
  }

  /** Tasks the caller opened recently, newest first. */
  @Get('recent-tasks') @RequirePermission('task.read')
  @ApiOkResponse({ type: TaskListDto })
  recentTasks(@CurrentMembership() m: Membership, @Query() q: RecentTasksQueryDto) {
    return this.recent.list(m, q.limit);
  }

  // Must be declared before `tasks/:taskId`.
  @Patch('tasks/bulk') @RequirePermission('task.write')
  @ApiOkResponse({ type: BulkResultDto })
  bulk(@CurrentMembership() m: Membership, @Body() dto: BulkUpdateTasksDto) {
    return this.tasks.bulkUpdate(m, dto.taskIds, dto.changes);
  }

  @Get('tasks/:taskId') @RequirePermission('task.read')
  @ApiOkResponse({ type: TaskDetailDto })
  get(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.tasks.get(m, ref);
  }

  @Patch('tasks/:taskId') @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskDetailDto })
  update(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(m, ref, dto);
  }

  @Delete('tasks/:taskId') @HttpCode(204) @RequirePermission('task.write')
  remove(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.tasks.remove(m, ref);
  }

  @Post('tasks/:taskId/archive') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskDetailDto })
  archive(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.tasks.setArchived(m, ref, true);
  }

  @Post('tasks/:taskId/restore') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskDetailDto })
  restore(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.tasks.setArchived(m, ref, false);
  }

  /** Drop a card into a column at a position (above/below another card, or at the bottom). */
  @Post('tasks/:taskId/rank') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskDto })
  rank(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: RankTaskDto) {
    return this.ranks.rank(m, ref, dto);
  }

  /** Backlog planning: drop a task into a sprint (or the backlog) above/below another task of that list. */
  @Post('tasks/:taskId/backlog-rank') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskDto })
  backlogRank(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: BacklogRankDto) {
    return this.ranks.rankInBacklog(m, ref, dto);
  }

  @Post('tasks/:taskId/viewed') @HttpCode(204) @RequirePermission('task.read')
  viewed(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.recent.markViewed(m, ref);
  }

  @Post('tasks/:taskId/duplicate') @RequirePermission('task.write')
  @ApiCreatedResponse({ type: TaskDetailDto })
  duplicate(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.moves.duplicate(m, ref);
  }

  @Post('tasks/:taskId/move') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskDetailDto })
  move(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: MoveTaskDto) {
    return this.moves.move(m, ref, dto.projectId);
  }
}
