import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { AutomationDto, CreateAutomationDto, UpdateAutomationDto } from './dto/automation.dto.js';
import { AutomationService } from './automation.service.js';

@ApiTags('automation')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'projectId', type: String })
@Controller('workspaces/:workspaceId/projects/:projectId/automations')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get() @RequirePermission('project.read')
  @ApiOkResponse({ type: [AutomationDto] })
  list(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.automation.list(m, id);
  }

  @Post() @RequirePermission('project.read')
  @ApiCreatedResponse({ type: AutomationDto })
  create(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateAutomationDto) {
    return this.automation.create(m, id, dto);
  }

  @Patch(':ruleId') @RequirePermission('project.read')
  @ApiParam({ name: 'ruleId', type: String })
  @ApiOkResponse({ type: AutomationDto })
  update(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('ruleId') rid: string, @Body() dto: UpdateAutomationDto) {
    return this.automation.update(m, id, rid, dto);
  }

  @Delete(':ruleId') @HttpCode(204) @RequirePermission('project.read')
  @ApiParam({ name: 'ruleId', type: String })
  remove(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('ruleId') rid: string) {
    return this.automation.remove(m, id, rid);
  }
}
