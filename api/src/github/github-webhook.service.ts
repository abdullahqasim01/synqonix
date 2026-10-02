import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { GithubIssue, GithubPullRequest, LinkedRepository } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService } from '../tasks/activity.service.js';
import { TaskEvents, type TaskStatusChangedEvent } from '../tasks/events.js';
import { taskKey } from '../tasks/task-ref.js';
import { TasksService } from '../tasks/tasks.service.js';
import { GithubEvents, type GithubCiFailedEvent, type GithubPullRequestEvent } from './events.js';
import { GithubClient } from './github.client.js';
import { keysFromBranch, keysFromPullRequest, keysFromText } from './github-links.js';
import { effectiveStatuses } from './github-status.js';

// The parts of GitHub's payloads that we read.
interface Repo { id: number }
interface Installation { id: number }
interface User { login: string }
interface PullRequestPayload {
  number: number; title: string; body: string | null; state: 'open' | 'closed'; draft?: boolean; merged?: boolean; html_url: string;
  merged_at: string | null; closed_at: string | null; user: User; head: { ref: string; sha: string }; base: { ref: string };
}
interface Payload {
  action?: string;
  repository?: Repo;
  installation?: Installation & { account?: { login: string; type: string } };
  repositories_removed?: Repo[];
  ref?: string; deleted?: boolean; after?: string;
  commits?: { id: string; message: string; url: string; timestamp: string; author?: { name?: string; username?: string } }[];
  pull_request?: PullRequestPayload;
  review?: { state: string };
  check_run?: { name: string; head_sha: string; status: string; conclusion: string | null; html_url?: string };
  issue?: { number: number; title: string; body?: string | null; state: 'open' | 'closed'; html_url: string; user?: User; pull_request?: unknown };
}

type LinkedRow = LinkedRepository & { project: { id: string; key: string; workspaceId: string } };
type Target = { branchId: string } | { commitId: string } | { pullRequestId: string } | { issueId: string };

/** Turns GitHub webhook deliveries into branches, commits, pull requests, links and status changes. */
@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityService,
    private readonly events: EventEmitter2,
    private readonly client: GithubClient,
  ) {}

  /** Returns false when the delivery was already processed (GitHub retries and manual redeliveries). */
  async receive(deliveryId: string, event: string, payload: Payload): Promise<boolean> {
    try {
      await this.prisma.webhookDelivery.create({ data: { id: deliveryId, event } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false;
      throw e;
    }
    try {
      await this.dispatch(event, payload);
    } catch (e) {
      // Let GitHub's retry run it again instead of losing the delivery.
      await this.prisma.webhookDelivery.delete({ where: { id: deliveryId } }).catch(() => undefined);
      throw e;
    }
    return true;
  }

  private async dispatch(event: string, p: Payload) {
    switch (event) {
      case 'installation': return this.onInstallation(p);
      case 'installation_repositories': return this.onInstallationRepositories(p);
      case 'push': return this.eachRepo(p, (r) => this.onPush(r, p));
      case 'pull_request': return this.eachRepo(p, (r) => this.onPullRequest(r, p));
      case 'pull_request_review': return this.eachRepo(p, (r) => this.onReview(r, p));
      case 'check_run': return this.eachRepo(p, (r) => this.onCheckRun(r, p));
      case 'issues': return this.eachRepo(p, (r) => this.onIssue(r, p));
      default: return; // ping and anything we do not use
    }
  }

  private async eachRepo(p: Payload, fn: (repo: LinkedRow) => Promise<void>) {
    if (!p.repository) return;
    const repos = await this.prisma.linkedRepository.findMany({
      where: { githubRepoId: String(p.repository.id), ...(p.installation ? { installation: { githubId: String(p.installation.id), suspendedAt: null } } : {}) },
      include: { project: { select: { id: true, key: true, workspaceId: true } } },
    });
    for (const repo of repos) await fn(repo);
  }

  // ---------------------------------------------------------------- installations

  private async onInstallation(p: Payload) {
    if (!p.installation) return;
    const githubId = String(p.installation.id);
    if (p.action === 'deleted') await this.prisma.githubInstallation.deleteMany({ where: { githubId } });
    else if (p.action === 'suspend') await this.prisma.githubInstallation.updateMany({ where: { githubId }, data: { suspendedAt: new Date() } });
    else if (p.action === 'unsuspend') await this.prisma.githubInstallation.updateMany({ where: { githubId }, data: { suspendedAt: null } });
  }

  private async onInstallationRepositories(p: Payload) {
    if (!p.installation || p.action !== 'removed' || !p.repositories_removed?.length) return;
    await this.prisma.linkedRepository.deleteMany({
      where: { githubRepoId: { in: p.repositories_removed.map((r) => String(r.id)) }, installation: { githubId: String(p.installation.id) } },
    });
  }

  // ---------------------------------------------------------------- helpers

  /** Tasks in the repository's workspace that these keys point to (lookalikes that are no task are dropped). */
  private async tasksForKeys(workspaceId: string, keys: string[]) {
    if (keys.length === 0) return [];
    const parsed = keys.map((k) => /^([A-Z][A-Z0-9]+)-(\d+)$/.exec(k)).filter((m): m is RegExpExecArray => !!m);
    if (parsed.length === 0) return [];
    return this.prisma.task.findMany({
      where: { OR: parsed.map((m) => ({ number: Number(m[2]), project: { key: m[1], workspaceId } })) },
      include: { status: true, project: { select: { key: true } } },
    });
  }

  private async rememberLogin(workspaceId: string, login: string | null | undefined) {
    if (!login) return;
    await this.prisma.githubContributor.createMany({ data: [{ workspaceId, login }], skipDuplicates: true });
  }

  private async actorFor(repo: LinkedRow, login: string | null | undefined): Promise<{ person: string | null; event: string }> {
    const mapped = login
      ? await this.prisma.githubContributor.findUnique({ where: { workspaceId_login: { workspaceId: repo.workspaceId, login } } })
      : null;
    const person = mapped?.userId ?? null;
    return { person, event: person ?? repo.linkedById ?? '' };
  }

  /** Links tasks to a GitHub object, writing history and refreshing open task views for new links. */
  private async link(repo: LinkedRow, keys: string[], target: Target, describe: string, actor: string | null) {
    const found = await this.tasksForKeys(repo.workspaceId, keys);
    const linked: typeof found = [];
    for (const t of found) {
      const created = await this.prisma.$transaction(async (tx) => {
        const res = await tx.taskGithubLink.createMany({ data: [{ taskId: t.id, ...target }], skipDuplicates: true });
        if (res.count > 0) await this.activity.record(tx, t.id, actor, [{ type: 'github_linked', to: describe }]);
        return res.count > 0;
      });
      if (created) linked.push(t);
    }
    return { all: found, newlyLinked: linked };
  }

  private refresh(repo: LinkedRow, tasks: { id: string; number: number; projectId: string; project: { key: string } }[], actorEvent: string) {
    for (const t of tasks) {
      this.events.emit(TaskEvents.updated, {
        workspaceId: repo.workspaceId, projectId: t.projectId, taskId: t.id, taskKey: taskKey(t.project.key, t.number), actorId: actorEvent, fields: ['github'],
      });
    }
  }

  private async transition(
    repo: LinkedRow, tasks: { id: string; status: { category: string; id: string } }[], to: { id: string } | null, actor: { person: string | null; event: string },
    only?: (category: string) => boolean,
  ) {
    if (!repo.autoTransition || !to) return;
    for (const t of tasks) {
      if (t.status.id === to.id) continue;
      if (t.status.category === 'DONE') continue; // never reopen finished work from a PR event
      if (only && !only(t.status.category)) continue;
      await this.tasks.setStatusFromIntegration(t.id, to.id, actor.person, actor.event);
    }
  }

  // ---------------------------------------------------------------- push

  private async onPush(repo: LinkedRow, p: Payload) {
    if (!p.ref?.startsWith('refs/heads/')) return;
    const name = p.ref.slice('refs/heads/'.length);
    const actor = await this.actorFor(repo, null);
    if (p.deleted) {
      await this.prisma.githubBranch.updateMany({ where: { repoId: repo.id, name }, data: { deletedAt: new Date() } });
      return;
    }
    const branch = await this.prisma.githubBranch.upsert({
      where: { repoId_name: { repoId: repo.id, name } },
      create: { repoId: repo.id, name, headSha: p.after ?? null }, update: { headSha: p.after ?? null, deletedAt: null },
    });
    const touched = (await this.link(repo, keysFromBranch(name), { branchId: branch.id }, `branch ${name}`, actor.person)).newlyLinked;

    for (const c of p.commits ?? []) {
      const row = await this.prisma.githubCommit.upsert({
        where: { repoId_sha: { repoId: repo.id, sha: c.id } },
        create: {
          repoId: repo.id, sha: c.id, message: c.message, url: c.url, authorLogin: c.author?.username ?? null,
          authorName: c.author?.name ?? null, committedAt: new Date(c.timestamp),
        },
        update: {},
      });
      await this.rememberLogin(repo.workspaceId, c.author?.username);
      const who = await this.actorFor(repo, c.author?.username);
      touched.push(...(await this.link(repo, keysFromText(c.message), { commitId: row.id }, `commit ${c.id.slice(0, 7)}`, who.person)).newlyLinked);
    }
    this.refresh(repo, touched, actor.event);
  }

  // ---------------------------------------------------------------- pull requests

  private async onPullRequest(repo: LinkedRow, p: Payload) {
    const pr = p.pull_request;
    if (!pr) return;
    const state = pr.merged || pr.merged_at ? 'MERGED' : pr.state === 'closed' ? 'CLOSED' : 'OPEN';
    const data = {
      title: pr.title, body: pr.body, state, draft: !!pr.draft, authorLogin: pr.user.login, headBranch: pr.head.ref, headSha: pr.head.sha,
      baseBranch: pr.base.ref, url: pr.html_url, mergedAt: pr.merged_at ? new Date(pr.merged_at) : null, closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    } as const;
    const row: GithubPullRequest = await this.prisma.githubPullRequest.upsert({
      where: { repoId_number: { repoId: repo.id, number: pr.number } }, create: { repoId: repo.id, number: pr.number, ...data }, update: data,
    });
    await this.rememberLogin(repo.workspaceId, pr.user.login);
    const actor = await this.actorFor(repo, pr.user.login);

    const { all } = await this.link(
      repo, keysFromPullRequest({ headBranch: pr.head.ref, title: pr.title, body: pr.body }), { pullRequestId: row.id }, `pull request #${pr.number}`, actor.person,
    );
    const { opened, merged } = await effectiveStatuses(this.prisma, repo);

    const notice = (action: GithubPullRequestEvent['action']) => {
      const e: GithubPullRequestEvent = {
        workspaceId: repo.workspaceId, prKey: `${repo.id}:${pr.number}`, action, number: pr.number, title: pr.title, url: pr.html_url,
        taskIds: all.map((t) => t.id), actorId: actor.person,
      };
      this.events.emit(GithubEvents.pullRequest, e);
    };
    if (p.action === 'closed' && state === 'MERGED') {
      await this.transition(repo, all, merged, actor);
      notice('merged');
    } else if (['opened', 'reopened', 'ready_for_review'].includes(p.action ?? '') && state === 'OPEN' && !pr.draft) {
      await this.transition(repo, all, opened, actor);
      notice('opened');
    }
    this.refresh(repo, all, actor.event);
  }

  private async onReview(repo: LinkedRow, p: Payload) {
    if (!p.pull_request || !p.review) return;
    const verdict = { approved: 'APPROVED', changes_requested: 'CHANGES_REQUESTED', commented: 'COMMENTED', dismissed: null }[p.review.state.toLowerCase()];
    if (verdict === undefined) return;
    const pr = await this.prisma.githubPullRequest.findUnique({ where: { repoId_number: { repoId: repo.id, number: p.pull_request.number } } });
    if (!pr) return;
    // A plain comment never overrides an approval or a change request.
    if (verdict === 'COMMENTED' && pr.reviewState && pr.reviewState !== 'COMMENTED') return;
    await this.prisma.githubPullRequest.update({ where: { id: pr.id }, data: { reviewState: verdict } });
    await this.refreshForPr(repo, pr.id);
  }

  private async refreshForPr(repo: LinkedRow, pullRequestId: string) {
    const links = await this.prisma.taskGithubLink.findMany({ where: { pullRequestId }, include: { task: { include: { project: { select: { key: true } } } } } });
    this.refresh(repo, links.map((l) => l.task), repo.linkedById ?? '');
  }

  private async onCheckRun(repo: LinkedRow, p: Payload) {
    const c = p.check_run;
    if (!c) return;
    await this.prisma.githubCheck.upsert({
      where: { repoId_headSha_name: { repoId: repo.id, headSha: c.head_sha, name: c.name } },
      create: { repoId: repo.id, headSha: c.head_sha, name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url ?? null },
      update: { status: c.status, conclusion: c.conclusion, url: c.html_url ?? null },
    });
    const prs = await this.prisma.githubPullRequest.findMany({ where: { repoId: repo.id, headSha: c.head_sha } });
    for (const pr of prs) {
      await this.refreshForPr(repo, pr.id);
      if (c.status === 'completed' && c.conclusion && ['failure', 'timed_out', 'startup_failure'].includes(c.conclusion) && pr.state === 'OPEN') {
        const links = await this.prisma.taskGithubLink.findMany({ where: { pullRequestId: pr.id }, select: { taskId: true } });
        const e: GithubCiFailedEvent = {
          workspaceId: repo.workspaceId, prKey: `${repo.id}:${pr.number}`, headSha: c.head_sha, checkName: c.name, number: pr.number, title: pr.title,
          url: pr.url, taskIds: links.map((l) => l.taskId),
        };
        this.events.emit(GithubEvents.ciFailed, e);
      }
    }
  }

  // ---------------------------------------------------------------- issues

  private async onIssue(repo: LinkedRow, p: Payload) {
    const issue = p.issue;
    if (!issue || issue.pull_request) return; // GitHub sends pull requests through the issues API too
    const state = issue.state === 'closed' ? 'CLOSED' : 'OPEN';
    const existing = await this.prisma.githubIssue.findUnique({ where: { repoId_number: { repoId: repo.id, number: issue.number } } });
    const row: GithubIssue = await this.prisma.githubIssue.upsert({
      where: { repoId_number: { repoId: repo.id, number: issue.number } },
      create: { repoId: repo.id, number: issue.number, title: issue.title, state, url: issue.html_url, authorLogin: issue.user?.login ?? null },
      update: { title: issue.title, state, url: issue.html_url },
    });
    await this.rememberLogin(repo.workspaceId, issue.user?.login);
    const actor = await this.actorFor(repo, issue.user?.login);

    if (!existing && repo.importIssues && p.action === 'opened') await this.importIssue(repo, row, issue.body ?? null);
    const { all } = await this.link(repo, keysFromText(`${issue.title}\n${issue.body ?? ''}`), { issueId: row.id }, `issue #${issue.number}`, actor.person);

    if (repo.syncIssues && existing && existing.state !== state) {
      const linked = await this.prisma.taskGithubLink.findMany({ where: { issueId: row.id }, include: { task: { include: { status: true, project: { select: { key: true } } } } } });
      const { merged, reopened } = await effectiveStatuses(this.prisma, repo);
      for (const l of linked) {
        if (state === 'CLOSED' && l.task.status.category !== 'DONE' && merged) await this.tasks.setStatusFromIntegration(l.task.id, merged.id, actor.person, actor.event);
        if (state === 'OPEN' && l.task.status.category === 'DONE' && reopened) await this.tasks.setStatusFromIntegration(l.task.id, reopened.id, actor.person, actor.event);
      }
    }
    this.refresh(repo, all, actor.event);
  }

  private async importIssue(repo: LinkedRow, issue: GithubIssue, body: string | null) {
    if (!repo.linkedById) return;
    const m = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: repo.workspaceId, userId: repo.linkedById } } });
    if (!m) return;
    const description = `${body?.trim() ?? ''}\n\n---\nImported from GitHub: [${repo.fullName}#${issue.number}](${issue.url})`.trim();
    const task = await this.tasks.create(m, repo.projectId, { title: issue.title.slice(0, 300), description, type: 'TASK' });
    await this.prisma.$transaction(async (tx) => {
      await tx.taskGithubLink.createMany({ data: [{ taskId: task.id, issueId: issue.id }], skipDuplicates: true });
      await this.activity.record(tx, task.id, null, [{ type: 'github_linked', to: `issue #${issue.number}` }]);
    });
  }

  /** Keeps GitHub issues in step when their task is finished or reopened here (only for repositories with syncing on). */
  @OnEvent(TaskEvents.statusChanged)
  async onTaskStatusChanged(e: TaskStatusChangedEvent) {
    try {
      const links = await this.prisma.taskGithubLink.findMany({
        where: { taskId: e.taskId, issueId: { not: null }, issue: { repo: { syncIssues: true } } },
        include: { issue: { include: { repo: { include: { installation: true } } } }, task: { include: { status: true } } },
      });
      for (const l of links) {
        const issue = l.issue!;
        const want = l.task.status.category === 'DONE' ? 'CLOSED' : 'OPEN';
        if (issue.state === want || issue.repo.installation.suspendedAt) continue;
        await this.client.setIssueState(issue.repo.installation.githubId, issue.repo.fullName, issue.number, want === 'CLOSED' ? 'closed' : 'open');
        await this.prisma.githubIssue.update({ where: { id: issue.id }, data: { state: want } });
      }
    } catch (err) {
      this.logger.warn(`Could not sync issue state for ${e.taskKey}: ${(err as Error).message}`);
    }
  }
}

