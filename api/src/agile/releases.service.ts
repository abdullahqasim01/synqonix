import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, Milestone, Release } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import { taskKey } from '../tasks/task-ref.js';
import type {
  CountsDto, CreateMilestoneDto, CreateReleaseDto, MilestoneDto, ReleaseDto, ReleaseNotesDto,
  ShipReleaseDto, UpdateMilestoneDto, UpdateReleaseDto,
} from './dto/agile.dto.js';

const isUnique = (e: unknown) => (e as { code?: string }).code === 'P2002';

/** Fix versions (releases) and milestones: named groupings of tasks with progress counts. */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  private async counts(field: 'releaseId' | 'milestoneId', ids: string[]): Promise<Map<string, CountsDto>> {
    const out = new Map<string, CountsDto>(ids.map((id) => [id, { total: 0, done: 0 }]));
    if (ids.length === 0) return out;
    const rows = await this.prisma.task.findMany({
      where: { [field]: { in: ids }, archivedAt: null },
      select: { releaseId: true, milestoneId: true, status: { select: { category: true } } },
    });
    for (const r of rows) {
      const c = out.get((field === 'releaseId' ? r.releaseId : r.milestoneId)!)!;
      c.total++;
      if (r.status.category === 'DONE') c.done++;
    }
    return out;
  }

  // ---------------------------------------------------------------- releases

  private releaseDto(r: Release, counts: CountsDto): ReleaseDto {
    return {
      id: r.id, name: r.name, description: r.description, status: r.status, startDate: r.startDate,
      releaseDate: r.releaseDate, releasedAt: r.releasedAt, counts, createdAt: r.createdAt,
    };
  }

  private async loadRelease(projectId: string, id: string) {
    const r = await this.prisma.release.findFirst({ where: { id, projectId } });
    if (!r) throw new NotFoundException('Release not found');
    return r;
  }

  async listReleases(m: Membership, projectId: string): Promise<ReleaseDto[]> {
    await this.projects.load(m, projectId);
    const rows = await this.prisma.release.findMany({ where: { projectId }, orderBy: [{ releaseDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] });
    const counts = await this.counts('releaseId', rows.map((r) => r.id));
    const order = { UNRELEASED: 0, RELEASED: 1, ARCHIVED: 2 } as const;
    return rows.sort((a, b) => order[a.status] - order[b.status]).map((r) => this.releaseDto(r, counts.get(r.id)!));
  }

  async createRelease(m: Membership, projectId: string, dto: CreateReleaseDto): Promise<ReleaseDto> {
    await this.projects.load(m, projectId, { manage: true });
    try {
      const r = await this.prisma.release.create({
        data: {
          projectId, name: dto.name.trim(), description: dto.description?.trim() || null,
          startDate: dto.startDate ? new Date(dto.startDate) : null, releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null,
        },
      });
      return this.releaseDto(r, { total: 0, done: 0 });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A release with this name already exists');
      throw e;
    }
  }

  async updateRelease(m: Membership, projectId: string, id: string, dto: UpdateReleaseDto): Promise<ReleaseDto> {
    await this.projects.load(m, projectId, { manage: true });
    const existing = await this.loadRelease(projectId, id);
    if (existing.status === 'RELEASED' && dto.status === 'UNRELEASED') throw new BadRequestException('A shipped release cannot be reopened');
    try {
      const r = await this.prisma.release.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
          ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
          ...(dto.releaseDate !== undefined && { releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null }),
          ...(dto.status !== undefined && existing.status !== 'RELEASED' && { status: dto.status }),
        },
      });
      return this.releaseDto(r, (await this.counts('releaseId', [id])).get(id)!);
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A release with this name already exists');
      throw e;
    }
  }

  async removeRelease(m: Membership, projectId: string, id: string) {
    await this.projects.load(m, projectId, { manage: true });
    await this.loadRelease(projectId, id);
    await this.prisma.release.delete({ where: { id } }); // tasks keep existing, just lose the fix version
  }

  /** Marks a release as shipped; unfinished tasks can be moved on to another release. */
  async ship(m: Membership, projectId: string, id: string, dto: ShipReleaseDto): Promise<ReleaseDto> {
    await this.projects.load(m, projectId, { manage: true });
    const release = await this.loadRelease(projectId, id);
    if (release.status !== 'UNRELEASED') throw new BadRequestException('Only an unreleased release can be shipped');
    if (dto.moveUnfinishedTo) {
      const target = await this.prisma.release.findFirst({ where: { id: dto.moveUnfinishedTo, projectId } });
      if (!target || target.status !== 'UNRELEASED' || target.id === id) {
        throw new BadRequestException('Unfinished tasks can only move to another unreleased release');
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.moveUnfinishedTo) {
        await tx.task.updateMany({
          where: { releaseId: id, archivedAt: null, status: { category: { not: 'DONE' } } },
          data: { releaseId: dto.moveUnfinishedTo },
        });
      }
      return tx.release.update({ where: { id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    });
    return this.releaseDto(updated, (await this.counts('releaseId', [id])).get(id)!);
  }

  /** Release notes (markdown) from the finished tasks on the release, grouped by kind. */
  async notes(m: Membership, projectId: string, id: string): Promise<ReleaseNotesDto> {
    const { project } = await this.projects.load(m, projectId);
    const release = await this.loadRelease(projectId, id);
    const tasks = await this.prisma.task.findMany({
      where: { releaseId: id, archivedAt: null }, orderBy: { number: 'asc' },
      select: { number: true, title: true, type: true, status: { select: { category: true } } },
    });
    const done = tasks.filter((t) => t.status.category === 'DONE');
    const groups: { title: string; types: string[] }[] = [
      { title: 'Features', types: ['STORY'] }, { title: 'Bug fixes', types: ['BUG'] },
      { title: 'Tasks', types: ['TASK', 'SUBTASK'] }, { title: 'Epics', types: ['EPIC'] },
    ];
    const sections = groups
      .map((g) => ({ title: g.title, tasks: done.filter((t) => g.types.includes(t.type)).map((t) => ({ key: taskKey(project.key, t.number), title: t.title })) }))
      .filter((s) => s.tasks.length > 0);

    const lines = [`# ${release.name}`];
    if (release.releasedAt) lines.push('', `Released ${release.releasedAt.toISOString().slice(0, 10)}`);
    if (release.description) lines.push('', release.description);
    for (const s of sections) {
      lines.push('', `## ${s.title}`, ...s.tasks.map((t) => `- ${t.key} ${t.title}`));
    }
    if (sections.length === 0) lines.push('', '_No finished work yet._');
    return { markdown: lines.join('\n') + '\n', sections, unfinished: tasks.length - done.length };
  }

  // ---------------------------------------------------------------- milestones

  private milestoneDto(x: Milestone, counts: CountsDto): MilestoneDto {
    return { id: x.id, name: x.name, description: x.description, dueDate: x.dueDate, closedAt: x.closedAt, counts, createdAt: x.createdAt };
  }

  private async loadMilestone(projectId: string, id: string) {
    const x = await this.prisma.milestone.findFirst({ where: { id, projectId } });
    if (!x) throw new NotFoundException('Milestone not found');
    return x;
  }

  async listMilestones(m: Membership, projectId: string): Promise<MilestoneDto[]> {
    await this.projects.load(m, projectId);
    const rows = await this.prisma.milestone.findMany({ where: { projectId }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] });
    const counts = await this.counts('milestoneId', rows.map((r) => r.id));
    return rows.sort((a, b) => Number(a.closedAt !== null) - Number(b.closedAt !== null)).map((r) => this.milestoneDto(r, counts.get(r.id)!));
  }

  async createMilestone(m: Membership, projectId: string, dto: CreateMilestoneDto): Promise<MilestoneDto> {
    await this.projects.load(m, projectId, { manage: true });
    try {
      const x = await this.prisma.milestone.create({
        data: { projectId, name: dto.name.trim(), description: dto.description?.trim() || null, dueDate: dto.dueDate ? new Date(dto.dueDate) : null },
      });
      return this.milestoneDto(x, { total: 0, done: 0 });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A milestone with this name already exists');
      throw e;
    }
  }

  async updateMilestone(m: Membership, projectId: string, id: string, dto: UpdateMilestoneDto): Promise<MilestoneDto> {
    await this.projects.load(m, projectId, { manage: true });
    const existing = await this.loadMilestone(projectId, id);
    try {
      const x = await this.prisma.milestone.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
          ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
          ...(dto.closed !== undefined && { closedAt: dto.closed ? existing.closedAt ?? new Date() : null }),
        },
      });
      return this.milestoneDto(x, (await this.counts('milestoneId', [id])).get(id)!);
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A milestone with this name already exists');
      throw e;
    }
  }

  async removeMilestone(m: Membership, projectId: string, id: string) {
    await this.projects.load(m, projectId, { manage: true });
    await this.loadMilestone(projectId, id);
    await this.prisma.milestone.delete({ where: { id } });
  }
}
