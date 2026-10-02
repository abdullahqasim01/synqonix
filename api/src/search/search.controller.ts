import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { SearchQueryDto, SearchResultDto } from './dto/search.dto.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Tasks, comments, projects, channels, messages and people the caller may see. */
  @Get() @RequirePermission('workspace.read')
  @ApiOkResponse({ type: SearchResultDto })
  run(@CurrentMembership() m: Membership, @Query() q: SearchQueryDto) {
    return this.search.search(m, q.q, q.types, q.limit);
  }
}
