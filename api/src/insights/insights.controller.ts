import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import {
  CreatedResolvedDto, CumulativeFlowDto, OverdueTaskDto, RangeQueryDto, TimeReportDto, TimeReportQueryDto, WorkloadDto, WorkspaceOverviewDto,
} from './dto/insights.dto.js';
import { InsightsService } from './insights.service.js';

@ApiTags('insights')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Dashboard numbers across every project the caller can see. */
  @Get('insights/overview') @RequirePermission('project.read')
  @ApiOkResponse({ type: WorkspaceOverviewDto })
  overview(@CurrentMembership() m: Membership) {
    return this.insights.overview(m);
  }

  @Get('projects/:projectId/insights/created-resolved') @RequirePermission('project.read')
  @ApiParam({ name: 'projectId', type: String })
  @ApiOkResponse({ type: CreatedResolvedDto })
  createdResolved(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query() q: RangeQueryDto) {
    return this.insights.createdResolved(m, id, q.days, q.bucket);
  }

  @Get('projects/:projectId/insights/cumulative-flow') @RequirePermission('project.read')
  @ApiParam({ name: 'projectId', type: String })
  @ApiOkResponse({ type: CumulativeFlowDto })
  cumulativeFlow(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query() q: RangeQueryDto) {
    return this.insights.cumulativeFlow(m, id, q.days);
  }

  @Get('projects/:projectId/insights/workload') @RequirePermission('project.read')
  @ApiParam({ name: 'projectId', type: String })
  @ApiOkResponse({ type: WorkloadDto })
  async workload(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return { rows: await this.insights.workload(m, id) };
  }

  @Get('projects/:projectId/insights/overdue') @RequirePermission('project.read')
  @ApiParam({ name: 'projectId', type: String })
  @ApiOkResponse({ type: [OverdueTaskDto] })
  overdue(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.insights.overdue(m, id);
  }

  @Get('projects/:projectId/insights/time') @RequirePermission('project.read')
  @ApiParam({ name: 'projectId', type: String })
  @ApiOkResponse({ type: TimeReportDto })
  time(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Query() q: TimeReportQueryDto) {
    return this.insights.timeReport(m, id, q.from, q.to);
  }
}
