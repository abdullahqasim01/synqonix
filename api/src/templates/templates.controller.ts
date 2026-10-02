import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { TaskDetailDto } from '../tasks/dto/task.dto.js';
import {
  CreateFromTemplateDto, CreateRecurringDto, CreateTemplateDto, RecurringDto, SaveAsTemplateDto, TemplateDto, UpdateRecurringDto, UpdateTemplateDto,
} from './dto/templates.dto.js';
import { RecurringService } from './recurring.service.js';
import { TemplatesService } from './templates.service.js';

@ApiTags('templates')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'projectId', type: String })
@Controller('workspaces/:workspaceId/projects/:projectId')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly recurring: RecurringService,
  ) {}

  // ----- task templates -----

  @Get('templates') @RequirePermission('project.read')
  @ApiOkResponse({ type: [TemplateDto] })
  list(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.templates.list(m, id);
  }

  @Post('templates') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: TemplateDto })
  create(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateTemplateDto) {
    return this.templates.create(m, id, dto);
  }

  @Post('templates/from-task/:taskRef') @RequirePermission('project.read')
  @ApiParam({ name: 'taskRef', type: String })
  @ApiCreatedResponse({ type: TemplateDto })
  fromTask(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('taskRef') ref: string, @Body() dto: SaveAsTemplateDto) {
    return this.templates.fromTask(m, id, ref, dto.name);
  }

  @Patch('templates/:templateId') @RequirePermission('project.read')
  @ApiParam({ name: 'templateId', type: String })
  @ApiOkResponse({ type: TemplateDto })
  update(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('templateId') tid: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(m, id, tid, dto);
  }

  @Delete('templates/:templateId') @HttpCode(204) @RequirePermission('project.read')
  @ApiParam({ name: 'templateId', type: String })
  remove(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('templateId') tid: string) {
    return this.templates.remove(m, id, tid);
  }

  @Post('templates/:templateId/create-task') @RequirePermission('task.write')
  @ApiParam({ name: 'templateId', type: String })
  @ApiCreatedResponse({ type: TaskDetailDto })
  createTask(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('templateId') tid: string, @Body() dto: CreateFromTemplateDto) {
    return this.templates.createTask(m, id, tid, dto);
  }

  // ----- recurring tasks -----

  @Get('recurring') @RequirePermission('project.read')
  @ApiOkResponse({ type: [RecurringDto] })
  listRecurring(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.recurring.list(m, id);
  }

  @Post('recurring') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: RecurringDto })
  createRecurring(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateRecurringDto) {
    return this.recurring.create(m, id, dto);
  }

  @Patch('recurring/:recurringId') @RequirePermission('project.read')
  @ApiParam({ name: 'recurringId', type: String })
  @ApiOkResponse({ type: RecurringDto })
  updateRecurring(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('recurringId') rid: string, @Body() dto: UpdateRecurringDto) {
    return this.recurring.update(m, id, rid, dto);
  }

  @Delete('recurring/:recurringId') @HttpCode(204) @RequirePermission('project.read')
  @ApiParam({ name: 'recurringId', type: String })
  removeRecurring(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('recurringId') rid: string) {
    return this.recurring.remove(m, id, rid);
  }
}
