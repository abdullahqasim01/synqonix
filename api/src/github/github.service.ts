import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { LinkedRepository, Membership } from '../generated/prisma/client.js';
import { isWorkspaceAdmin } from '../permissions/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { ActivityService } from '../tasks/activity.service.js';
import { TaskAccessService } from '../tasks/task-access.service.js';
import { taskKey } from '../tasks/task-ref.js';
import type {
  AvailableRepoDto, ContributorDto, CreateBranchDto, GithubInstallUrlDto, GithubStatusDto, LinkedRepoDto, TaskGithubDto,
  UpdateLinkedRepoDto,
} from './dto/github.dto.js';
import { GithubClient } from './github.client.js';
import { branchNameFor, ciState, isValidBranchName } from './github-links.js';
import { effectiveStatuses } from './github-status.js';

const STATE_TTL_MS = 15 * 60_000;

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: GithubClient,
    private readonly projects: ProjectAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---------------------------------------------------------------- installing

  private sign(payload: string) {
    return createHmac('sha256', `github-install:${this.config.get('JWT_ACCESS_SECRET')}`).update(payload).digest('base64url');
  }

  /** A signed, short-lived token carried through GitHub's install redirect so we know who started it. */
  private makeState(workspaceId: string, userId: string) {
    const body = Buffer.from(JSON.stringify({ w: workspaceId, u: userId, e: Date.now() + STATE_TTL_MS })).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  private readState(state: string): { workspaceId: string; userId: string } | null {
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { w: string; u: string; e: number };
      return p.e > Date.now() ? { workspaceId: p.w, userId: p.u } : null;
    } catch {
      return null;
    }
  }

  private requireAdmin(m: Membership) {
    if (!isWorkspaceAdmin(m.role)) throw new ForbiddenException("You don't have permission to do that");
  }

  async status(m: Membership): Promise<GithubStatusDto> {
    const rows = await this.prisma.githubInstallation.findMany({
      where: { workspaceId: m.workspaceId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { repositories: true } } },
    });
    return {
      configured: this.client.isConfigured(),
      installations: rows.map((r) => ({
        id: r.id, accountLogin: r.accountLogin, accountType: r.accountType, suspended: r.suspendedAt !== null,
        repositoryCount: r._count.repositories, createdAt: r.createdAt,
      })),
    };
  }

  installUrl(m: Membership): GithubInstallUrlDto {
    this.requireAdmin(m);
    const url = this.client.isConfigured() ? this.client.installUrl(this.makeState(m.workspaceId, m.userId)) : null;
    if (!url) throw new BadRequestException('The GitHub integration is not configured on this server');
    return { url };
  }

  /** Where the browser lands after GitHub's install page; returns the web URL to redirect to. */
  async completeInstall(state: string | undefined, installationId: string | undefined): Promise<string> {
    const web = this.config.get('WEB_URL');
    const parsed = state ? this.readState(state) : null;
    if (!parsed) return `${web}/dashboard?github=error`;
    const back = (result: string) => `${web}/w/${parsed.workspaceId}/settings?github=${result}`;
    if (!installationId || !/^\d+$/.test(installationId)) return back('error');

    const m = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: parsed.workspaceId, userId: parsed.userId } } });
    if (!m || !isWorkspaceAdmin(m.role)) return back('error');
    const existing = await this.prisma.githubInstallation.findUnique({ where: { githubId: installationId } });
    if (existing && existing.workspaceId !== parsed.workspaceId) return back('taken');
    if (existing) return back('connected');
    const info = await this.client.getInstallation(installationId).catch(() => null);
    if (!info) return back('error');
    await this.prisma.githubInstallation.create({
      data: { workspaceId: parsed.workspaceId, githubId: info.githubId, accountLogin: info.accountLogin, accountType: info.accountType, installedById: parsed.userId },
    });
    return back('connected');
  }

  async removeInstallation(m: Membership, id: string) {
    this.requireAdmin(m);
    const res = await this.prisma.githubInstallation.deleteMany({ where: { id, workspaceId: m.workspaceId } });
    if (res.count === 0) throw new NotFoundException('Installation not found');
  }

  // ---------------------------------------------------------------- linking repositories

  private async toLinkedDto(link: LinkedRepository): Promise<LinkedRepoDto> {
    const { opened, merged } = await effectiveStatuses(this.prisma, link);
    return {
      id: link.id, projectId: link.projectId, installationId: link.installationId, githubRepoId: link.githubRepoId,
      fullName: link.fullName, htmlUrl: link.htmlUrl, defaultBranch: link.defaultBranch, autoTransition: link.autoTransition,
      prOpenedStatusId: link.prOpenedStatusId, prMergedStatusId: link.prMergedStatusId,
      effectiveOpenedStatusId: opened?.id ?? null, effectiveMergedStatusId: merged?.id ?? null,
      importIssues: link.importIssues, syncIssues: link.syncIssues, createdAt: link.createdAt,
    };
  }

  async listLinked(m: Membership, projectId: string): Promise<LinkedRepoDto[]> {
    await this.projects.load(m, projectId);
    const rows = await this.prisma.linkedRepository.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map((r) => this.toLinkedDto(r)));
  }

  async available(m: Membership, projectId: string): Promise<AvailableRepoDto[]> {
    await this.projects.load(m, projectId, { manage: true });
    const installations = await this.prisma.githubInstallation.findMany({ where: { workspaceId: m.workspaceId, suspendedAt: null } });
    const linked = new Set((await this.prisma.linkedRepository.findMany({ where: { projectId } })).map((l) => l.githubRepoId));
    const out: AvailableRepoDto[] = [];
    for (const inst of installations) {
      const repos = await this.client.listRepositories(inst.githubId).catch(() => []);
      out.push(...repos.map((r) => ({ ...r, installationId: inst.id, linked: linked.has(r.githubRepoId) })));
    }
    return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async link(m: Membership, projectId: string, installationId: string, githubRepoId: string): Promise<LinkedRepoDto> {
    await this.projects.load(m, projectId, { manage: true });
    const inst = await this.prisma.githubInstallation.findFirst({ where: { id: installationId, workspaceId: m.workspaceId, suspendedAt: null } });
    if (!inst) throw new NotFoundException('GitHub installation not found');
    // Only repositories the installation really has access to can be linked.
    const repo = (await this.client.listRepositories(inst.githubId)).find((r) => r.githubRepoId === githubRepoId);
    if (!repo) throw new BadRequestException('That repository is not available to this GitHub installation');
    if (await this.prisma.linkedRepository.findUnique({ where: { projectId_githubRepoId: { projectId, githubRepoId } } })) {
      throw new ConflictException('This repository is already linked to the project');
    }
    const created = await this.prisma.linkedRepository.create({
      data: {
        workspaceId: m.workspaceId, installationId: inst.id, projectId, githubRepoId, fullName: repo.fullName,
        htmlUrl: repo.htmlUrl, defaultBranch: repo.defaultBranch, linkedById: m.userId,
      },
    });
    return this.toLinkedDto(created);
  }

  private async loadLink(m: Membership, projectId: string, linkId: string) {
    await this.projects.load(m, projectId, { manage: true });
    const link = await this.prisma.linkedRepository.findFirst({ where: { id: linkId, projectId } });
    if (!link) throw new NotFoundException('Repository link not found');
    return link;
  }

  async update(m: Membership, projectId: string, linkId: string, dto: UpdateLinkedRepoDto): Promise<LinkedRepoDto> {
    const link = await this.loadLink(m, projectId, linkId);
    for (const id of [dto.prOpenedStatusId, dto.prMergedStatusId]) {
      if (id && !(await this.prisma.projectStatus.findFirst({ where: { id, projectId } }))) throw new BadRequestException('Unknown status for this project');
    }
    const updated = await this.prisma.linkedRepository.update({
      where: { id: link.id },
      data: {
        ...(dto.autoTransition !== undefined && { autoTransition: dto.autoTransition }),
        ...(dto.prOpenedStatusId !== undefined && { prOpenedStatusId: dto.prOpenedStatusId }),
        ...(dto.prMergedStatusId !== undefined && { prMergedStatusId: dto.prMergedStatusId }),
        ...(dto.importIssues !== undefined && { importIssues: dto.importIssues }),
        ...(dto.syncIssues !== undefined && { syncIssues: dto.syncIssues }),
      },
    });
    return this.toLinkedDto(updated);
  }

  async unlink(m: Membership, projectId: string, linkId: string) {
    const link = await this.loadLink(m, projectId, linkId);
    await this.prisma.linkedRepository.delete({ where: { id: link.id } });
  }

  // ---------------------------------------------------------------- contributors

  async contributors(m: Membership): Promise<ContributorDto[]> {
    const rows = await this.prisma.githubContributor.findMany({ where: { workspaceId: m.workspaceId }, orderBy: { login: 'asc' } });
    return rows.map((r) => ({ login: r.login, userId: r.userId }));
  }

  async setContributor(m: Membership, login: string, userId: string | null): Promise<ContributorDto> {
    if (userId && !(await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: m.workspaceId, userId } } }))) {
      throw new BadRequestException('That person is not a member of this workspace');
    }
    const row = await this.prisma.githubContributor.upsert({
      where: { workspaceId_login: { workspaceId: m.workspaceId, login } }, create: { workspaceId: m.workspaceId, login, userId }, update: { userId },
    });
    return { login: row.login, userId: row.userId };
  }

  // ---------------------------------------------------------------- tasks

  async forTask(m: Membership, ref: string): Promise<TaskGithubDto> {
    const { task, project } = await this.taskAccess.load(m, ref);
    const [links, repos] = await Promise.all([
      this.prisma.taskGithubLink.findMany({
        where: { taskId: task.id },
        include: { branch: { include: { repo: true } }, commit: { include: { repo: true } }, pullRequest: { include: { repo: true } }, issue: { include: { repo: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.linkedRepository.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } }),
    ]);

    const logins = [...new Set(links.flatMap((l) => [l.commit?.authorLogin, l.pullRequest?.authorLogin]).filter((x): x is string => !!x))];
    const mapped = logins.length
      ? await this.prisma.githubContributor.findMany({ where: { workspaceId: m.workspaceId, login: { in: logins }, userId: { not: null } } })
      : [];
    const users = mapped.length ? await this.prisma.user.findMany({ where: { id: { in: mapped.map((c) => c.userId!) } }, select: { id: true, name: true } }) : [];
    const nameFor = (login: string | null | undefined) => {
      const userId = mapped.find((c) => c.login === login)?.userId;
      return users.find((u) => u.id === userId)?.name ?? null;
    };

    const prs = links.map((l) => l.pullRequest).filter((p): p is NonNullable<typeof p> => !!p);
    const checks = prs.length
      ? await this.prisma.githubCheck.findMany({ where: { OR: prs.map((p) => ({ repoId: p.repoId, headSha: p.headSha })) } })
      : [];

    return {
      repos: repos.map((r) => ({ id: r.id, fullName: r.fullName, defaultBranch: r.defaultBranch })),
      suggestedBranch: branchNameFor(taskKey(project.key, task.number), task.title),
      branches: links.flatMap((l) => (l.branch ? [{
        id: l.branch.id, repo: l.branch.repo.fullName, name: l.branch.name, url: `${l.branch.repo.htmlUrl}/tree/${l.branch.name}`, deleted: l.branch.deletedAt !== null,
      }] : [])),
      commits: links.flatMap((l) => (l.commit ? [{
        sha: l.commit.sha, repo: l.commit.repo.fullName, message: l.commit.message.split('\n')[0], url: l.commit.url,
        authorLogin: l.commit.authorLogin, authorName: nameFor(l.commit.authorLogin), committedAt: l.commit.committedAt,
      }] : [])).sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime()),
      pullRequests: prs.map((p) => ({
        id: p.id, repo: p.repo.fullName, number: p.number, title: p.title, state: p.state, draft: p.draft, url: p.url, authorLogin: p.authorLogin,
        authorName: nameFor(p.authorLogin), headBranch: p.headBranch, baseBranch: p.baseBranch,
        reviewState: p.reviewState as TaskGithubDto['pullRequests'][number]['reviewState'],
        ci: ciState(checks.filter((c) => c.repoId === p.repoId && c.headSha === p.headSha)), updatedAt: p.updatedAt,
      })).sort((a, b) => b.number - a.number),
      issues: links.flatMap((l) => (l.issue ? [{
        id: l.issue.id, repo: l.issue.repo.fullName, number: l.issue.number, title: l.issue.title, state: l.issue.state, url: l.issue.url,
      }] : [])),
    };
  }

  async createBranch(m: Membership, ref: string, dto: CreateBranchDto): Promise<TaskGithubDto> {
    const { task, project } = await this.taskAccess.load(m, ref, { write: true });
    const repo = await this.prisma.linkedRepository.findFirst({ where: { id: dto.repoId, projectId: project.id }, include: { installation: true } });
    if (!repo) throw new NotFoundException('Repository not linked to this project');
    if (repo.installation.suspendedAt) throw new BadRequestException('The GitHub installation is suspended');
    const name = dto.name?.trim() || branchNameFor(taskKey(project.key, task.number), task.title);
    if (!isValidBranchName(name)) throw new BadRequestException('That is not a valid branch name');
    const result = await this.client.createBranch(repo.installation.githubId, repo.fullName, name, dto.from?.trim() || repo.defaultBranch);
    await this.prisma.$transaction(async (tx) => {
      const branch = await tx.githubBranch.upsert({
        where: { repoId_name: { repoId: repo.id, name } }, create: { repoId: repo.id, name, headSha: result.sha }, update: { headSha: result.sha, deletedAt: null },
      });
      const created = await tx.taskGithubLink.createMany({ data: [{ taskId: task.id, branchId: branch.id }], skipDuplicates: true });
      if (created.count > 0) await this.activity.record(tx, task.id, m.userId, [{ type: 'github_branch', to: `${repo.fullName}:${name}` }]);
    });
    return this.forTask(m, ref);
  }
}
