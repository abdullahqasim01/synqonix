import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { CreateViewDto, ListViewsQueryDto, UpdateViewDto, ViewDto } from './dto/view.dto.js';
import { ViewsService } from './views.service.js';

/** Saved layouts, filters and display options, personal or shared with the project. */
@ApiTags('views')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId/views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get() @RequirePermission('task.read')
  @ApiOkResponse({ type: [ViewDto] })
  list(@CurrentMembership() m: Membership, @Query() q: ListViewsQueryDto) {
    return this.views.list(m, q.projectId);
  }

  @Post() @RequirePermission('task.read')
  @ApiCreatedResponse({ type: ViewDto })
  create(@CurrentMembership() m: Membership, @Body() dto: CreateViewDto) {
    return this.views.create(m, dto);
  }

  @Get(':viewId') @RequirePermission('task.read')
  @ApiOkResponse({ type: ViewDto })
  get(@CurrentMembership() m: Membership, @Param('viewId') id: string) {
    return this.views.get(m, id);
  }

  @Patch(':viewId') @RequirePermission('task.read')
  @ApiOkResponse({ type: ViewDto })
  update(@CurrentMembership() m: Membership, @Param('viewId') id: string, @Body() dto: UpdateViewDto) {
    return this.views.update(m, id, dto);
  }

  @Delete(':viewId') @HttpCode(204) @RequirePermission('task.read')
  remove(@CurrentMembership() m: Membership, @Param('viewId') id: string) {
    return this.views.remove(m, id);
  }
}
