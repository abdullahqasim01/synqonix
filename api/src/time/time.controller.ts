import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { LogTimeDto, StartTimerDto, TaskTimeDto, TimeEntryDto, TimerDto, TimesheetQueryDto, UpdateTimeEntryDto } from './dto/time.dto.js';
import { TimeService } from './time.service.js';

@ApiTags('time')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId')
export class TimeController {
  constructor(private readonly time: TimeService) {}

  @Get('tasks/:taskId/time') @RequirePermission('task.read')
  @ApiParam({ name: 'taskId', type: String })
  @ApiOkResponse({ type: TaskTimeDto })
  forTask(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.time.forTask(m, ref);
  }

  @Post('tasks/:taskId/time') @RequirePermission('task.write')
  @ApiParam({ name: 'taskId', type: String })
  @ApiCreatedResponse({ type: TimeEntryDto })
  log(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: LogTimeDto) {
    return this.time.log(m, ref, dto);
  }

  @Patch('tasks/:taskId/time/:entryId') @RequirePermission('task.write')
  @ApiParam({ name: 'taskId', type: String })
  @ApiOkResponse({ type: TimeEntryDto })
  update(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('entryId') id: string, @Body() dto: UpdateTimeEntryDto) {
    return this.time.update(m, ref, id, dto);
  }

  @Delete('tasks/:taskId/time/:entryId') @HttpCode(204) @RequirePermission('task.write')
  @ApiParam({ name: 'taskId', type: String })
  remove(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Param('entryId') id: string) {
    return this.time.remove(m, ref, id);
  }

  @Get('time/timer') @RequirePermission('task.read')
  @ApiOkResponse({ type: TimerDto })
  timer(@CurrentMembership() m: Membership) {
    return this.time.timer(m);
  }

  @Post('time/timer/start') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: TimerDto })
  start(@CurrentMembership() m: Membership, @Body() dto: StartTimerDto) {
    return this.time.start(m, dto.taskRef);
  }

  /** Stops the running timer; `entry` is the finished entry, or null when there was none (or it ran under a minute). */
  @Post('time/timer/stop') @HttpCode(200) @RequirePermission('task.read')
  @ApiOkResponse({ type: TimerDto })
  async stop(@CurrentMembership() m: Membership) {
    return { entry: await this.time.stop(m) };
  }

  @Get('time/mine') @RequirePermission('task.read')
  @ApiOkResponse({ type: [TimeEntryDto] })
  mine(@CurrentMembership() m: Membership, @Query() q: TimesheetQueryDto) {
    return this.time.mine(m, q.from, q.to);
  }
}
