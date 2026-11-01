import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Channel, ChannelMember, Membership, Prisma, Project } from '../generated/prisma/client.js';
import { isWorkspaceAdmin } from '../permissions/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';

export interface ChannelAccess {
  channel: Channel & { project: Project | null };
  member: ChannelMember | null;
  /** May rename, archive and manage members of the channel. */
  isAdmin: boolean;
  canPost: boolean;
}

/** Who can see, post in and moderate a channel. */
@Injectable()
export class ChannelAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  /**
   * Channels the caller can see: public channels, project channels of projects they can see, and
   * private channels / direct messages they belong to. Workspace admins get no special view into
   * private channels or DMs.
   */
  visibleWhere(m: Membership): Prisma.ChannelWhereInput {
    return {
      workspaceId: m.workspaceId,
      OR: [
        { projectId: null, type: 'PUBLIC' },
        { projectId: null, members: { some: { userId: m.userId } } },
        { projectId: { not: null }, project: { is: this.projects.visibleProjects(m) } },
      ],
    };
  }

  async load(m: Membership, channelId: string): Promise<ChannelAccess> {
    const channel = await this.prisma.channel.findFirst({
      where: { AND: [this.visibleWhere(m), { id: channelId }] },
      include: { project: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    return this.describe(m, channel);
  }

  async describe(m: Membership, channel: Channel & { project: Project | null }): Promise<ChannelAccess> {
    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: m.userId } },
    });

    let isAdmin = member?.role === 'ADMIN';
    let canPost = !channel.archivedAt;
    if (channel.project) {
      const pm = await this.projects.projectRole(channel.project.id, m.userId);
      isAdmin ||= this.projects.canManage(m, channel.project, pm);
      canPost &&= this.projects.canWrite(m, pm);
    } else if (channel.type === 'PUBLIC') {
      isAdmin ||= isWorkspaceAdmin(m.role);
      canPost &&= m.role !== 'VIEWER';
    } else if (channel.type === 'PRIVATE') {
      canPost &&= m.role !== 'VIEWER';
    }
    return { channel, member, isAdmin, canPost };
  }

  /** Loads the channel and requires the right to post (403 otherwise; archived channels are read-only). */
  async loadForPosting(m: Membership, channelId: string): Promise<ChannelAccess> {
    const access = await this.load(m, channelId);
    if (!access.canPost) {
      throw new ForbiddenException(access.channel.archivedAt ? 'This channel is archived' : "You can't post in this channel");
    }
    return access;
  }

  async loadForAdmin(m: Membership, channelId: string): Promise<ChannelAccess> {
    const access = await this.load(m, channelId);
    if (!access.isAdmin) throw new ForbiddenException("You don't have permission to do that");
    return access;
  }

  /** The subset of `userIds` who may see the channel (for mentions and notifications). */
  async viewerIds(channel: Channel & { project?: Project | null }, userIds: string[]): Promise<string[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    if (channel.projectId) {
      const project = channel.project ?? (await this.prisma.project.findUnique({ where: { id: channel.projectId } }));
      if (!project) return [];
      const members = await this.prisma.membership.findMany({ where: { workspaceId: channel.workspaceId, userId: { in: ids } } });
      const pms = await this.prisma.projectMember.findMany({ where: { projectId: project.id, userId: { in: ids } } });
      return members
        .filter((mm) => this.projects.canView(mm, project, pms.find((p) => p.userId === mm.userId) ?? null))
        .map((mm) => mm.userId);
    }
    if (channel.type === 'PUBLIC') {
      const members = await this.prisma.membership.findMany({ where: { workspaceId: channel.workspaceId, userId: { in: ids } } });
      return members.map((mm) => mm.userId);
    }
    const members = await this.prisma.channelMember.findMany({ where: { channelId: channel.id, userId: { in: ids } } });
    return members.map((mm) => mm.userId);
  }
}
