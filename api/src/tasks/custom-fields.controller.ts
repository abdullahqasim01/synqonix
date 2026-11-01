import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { CreateCustomFieldDto, CustomFieldDto, UpdateCustomFieldDto } from './dto/details.dto.js';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'projectId', type: String })
@Controller('workspaces/:workspaceId/projects/:projectId/custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get() @RequirePermission('project.read')
  @ApiOkResponse({ type: [CustomFieldDto] })
  list(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.fields.list(m, id);
  }

  @Post() @RequirePermission('project.read')
  @ApiCreatedResponse({ type: CustomFieldDto })
  create(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: CreateCustomFieldDto) {
    return this.fields.create(m, id, dto);
  }

  @Patch(':fieldId') @RequirePermission('project.read')
  @ApiOkResponse({ type: CustomFieldDto })
  update(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('fieldId') fieldId: string, @Body() dto: UpdateCustomFieldDto) {
    return this.fields.update(m, id, fieldId, dto);
  }

  @Delete(':fieldId') @HttpCode(204) @RequirePermission('project.read')
  remove(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('fieldId') fieldId: string) {
    return this.fields.remove(m, id, fieldId);
  }
}
