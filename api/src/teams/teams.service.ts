import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTeamDto, TeamDto, UpdateTeamDto } from './dto/team.dto.js';

const include = { members: { include: { user: true }, orderBy: { createdAt: 'asc' } } } as const;
type TeamRow = Prisma.TeamGetPayload<{ include: typeof include }>;

const toDto = (t: TeamRow): TeamDto => ({
  id: t.id, name: t.name, description: t.description, createdAt: t.createdAt,
  members: t.members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email })),
});

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string): Promise<TeamDto[]> {
    const rows = await this.prisma.team.findMany({ where: { workspaceId }, include, orderBy: { name: 'asc' } });
    return rows.map(toDto);
  }

  private async find(workspaceId: string, id: string) {
    const team = await this.prisma.team.findFirst({ where: { id, workspaceId }, include });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  get(workspaceId: string, id: string) {
    return this.find(workspaceId, id).then(toDto);
  }

  private async guardUnique<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('A team with this name already exists');
      throw e;
    }
  }

  async create(workspaceId: string, actorId: string, dto: CreateTeamDto): Promise<TeamDto> {
    const team = await this.guardUnique(() =>
      this.prisma.team.create({
        data: { workspaceId, name: dto.name.trim(), description: dto.description?.trim() || null },
        include,
      }),
    );
    await this.audit.log({
      workspaceId, actorId, action: 'team.created', entityType: 'team', entityId: team.id, metadata: { name: team.name },
    });
    return toDto(team);
  }

  async update(workspaceId: string, actorId: string, id: string, dto: UpdateTeamDto): Promise<TeamDto> {
    await this.find(workspaceId, id);
    const team = await this.guardUnique(() =>
      this.prisma.team.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        },
        include,
      }),
    );
    await this.audit.log({ workspaceId, actorId, action: 'team.updated', entityType: 'team', entityId: id });
    return toDto(team);
  }

  async remove(workspaceId: string, actorId: string, id: string) {
    await this.find(workspaceId, id);
    await this.prisma.team.delete({ where: { id } });
    await this.audit.log({ workspaceId, actorId, action: 'team.deleted', entityType: 'team', entityId: id });
  }

  async addMember(workspaceId: string, actorId: string, id: string, userId: string): Promise<TeamDto> {
    await this.find(workspaceId, id);
    const isMember = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!isMember) throw new BadRequestException('User is not a member of this workspace');
    await this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: id, userId } },
      create: { teamId: id, userId },
      update: {},
    });
    return this.get(workspaceId, id);
  }

  async removeMember(workspaceId: string, id: string, userId: string) {
    await this.find(workspaceId, id);
    const res = await this.prisma.teamMember.deleteMany({ where: { teamId: id, userId } });
    if (res.count === 0) throw new NotFoundException('Team member not found');
  }
}
