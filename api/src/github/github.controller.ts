import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, Redirect, ServiceUnavailableException,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../common/decorators.js';
import type { Env } from '../config/env.js';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import {
  AvailableRepoDto, ContributorDto, CreateBranchDto, GithubInstallUrlDto, GithubStatusDto, LinkedRepoDto, LinkRepoDto, SetContributorDto,
  TaskGithubDto, UpdateLinkedRepoDto,
} from './dto/github.dto.js';
import { GithubWebhookService } from './github-webhook.service.js';
import { GithubService } from './github.service.js';

/** Installation and contributor mapping for a workspace. */
@ApiTags('github')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId/github')
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get() @RequirePermission('workspace.read')
  @ApiOkResponse({ type: GithubStatusDto })
  status(@CurrentMembership() m: Membership) {
    return this.github.status(m);
  }

  /** Where to send the browser to install the GitHub App on an account. Workspace admins only. */
  @Get('install-url') @RequirePermission('workspace.read')
  @ApiOkResponse({ type: GithubInstallUrlDto })
  installUrl(@CurrentMembership() m: Membership) {
    return this.github.installUrl(m);
  }

  @Delete('installations/:installationId') @HttpCode(204) @RequirePermission('workspace.read')
  @ApiParam({ name: 'installationId', type: String })
  removeInstallation(@CurrentMembership() m: Membership, @Param('installationId') id: string) {
    return this.github.removeInstallation(m, id);
  }

  @Get('contributors') @RequirePermission('member.read')
  @ApiOkResponse({ type: [ContributorDto] })
  contributors(@CurrentMembership() m: Membership) {
    return this.github.contributors(m);
  }

  @Put('contributors/:login') @RequirePermission('member.manage')
  @ApiParam({ name: 'login', type: String })
  @ApiOkResponse({ type: ContributorDto })
  setContributor(@CurrentMembership() m: Membership, @Param('login') login: string, @Body() dto: SetContributorDto) {
    return this.github.setContributor(m, login, dto.userId);
  }
}

/** Repositories linked to a project. */
@ApiTags('github')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'projectId', type: String })
@Controller('workspaces/:workspaceId/projects/:projectId/github')
export class GithubProjectController {
  constructor(private readonly github: GithubService) {}

  @Get('repos') @RequirePermission('project.read')
  @ApiOkResponse({ type: [LinkedRepoDto] })
  list(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.github.listLinked(m, id);
  }

  @Get('available') @RequirePermission('project.read')
  @ApiOkResponse({ type: [AvailableRepoDto] })
  available(@CurrentMembership() m: Membership, @Param('projectId') id: string) {
    return this.github.available(m, id);
  }

  @Post('repos') @RequirePermission('project.read')
  @ApiCreatedResponse({ type: LinkedRepoDto })
  link(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Body() dto: LinkRepoDto) {
    return this.github.link(m, id, dto.installationId, dto.githubRepoId);
  }

  @Patch('repos/:linkId') @RequirePermission('project.read')
  @ApiParam({ name: 'linkId', type: String })
  @ApiOkResponse({ type: LinkedRepoDto })
  update(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('linkId') linkId: string, @Body() dto: UpdateLinkedRepoDto) {
    return this.github.update(m, id, linkId, dto);
  }

  @Delete('repos/:linkId') @HttpCode(204) @RequirePermission('project.read')
  @ApiParam({ name: 'linkId', type: String })
  unlink(@CurrentMembership() m: Membership, @Param('projectId') id: string, @Param('linkId') linkId: string) {
    return this.github.unlink(m, id, linkId);
  }
}

/** Branches, commits, pull requests and issues connected to one task. */
@ApiTags('github')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@ApiParam({ name: 'taskId', type: String })
@Controller('workspaces/:workspaceId/tasks/:taskId/github')
export class GithubTaskController {
  constructor(private readonly github: GithubService) {}

  @Get() @RequirePermission('task.read')
  @ApiOkResponse({ type: TaskGithubDto })
  get(@CurrentMembership() m: Membership, @Param('taskId') ref: string) {
    return this.github.forTask(m, ref);
  }

  @Post('branches') @HttpCode(200) @RequirePermission('task.write')
  @ApiOkResponse({ type: TaskGithubDto })
  createBranch(@CurrentMembership() m: Membership, @Param('taskId') ref: string, @Body() dto: CreateBranchDto) {
    return this.github.createBranch(m, ref, dto);
  }
}

/** Endpoints GitHub itself calls: the install redirect and the webhook. Authenticated by signatures, not tokens. */
@ApiTags('github')
@Controller('github')
export class GithubPublicController {
  constructor(
    private readonly github: GithubService,
    private readonly webhooks: GithubWebhookService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public() @SkipThrottle() @Get('setup') @Redirect()
  @ApiExcludeEndpoint()
  async setup(@Query('state') state?: string, @Query('installation_id') installationId?: string) {
    return { url: await this.github.completeInstall(state, installationId), statusCode: 302 };
  }

  @Public() @SkipThrottle() @Post('webhooks') @HttpCode(202)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') delivery: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ) {
    const secret = this.config.get('GITHUB_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException('GitHub webhooks are not configured');
    const raw = req.rawBody;
    if (!raw || !signature || !delivery || !event) throw new UnauthorizedException('Missing webhook headers');
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new UnauthorizedException('Invalid signature');
    const processed = await this.webhooks.receive(delivery, event, req.body as never);
    return { status: processed ? 'processed' : 'duplicate' };
  }
}
