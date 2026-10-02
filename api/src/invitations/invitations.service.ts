import {
  ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import type { Invitation, Membership } from '../generated/prisma/client.js';
import type { WorkspaceRole } from '../generated/prisma/enums.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { WorkspaceDto } from '../workspaces/dto/workspace.dto.js';
import type { InvitationDto, InvitationPreviewDto } from './dto/invitation.dto.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const toDto = (i: Invitation): InvitationDto => ({
  id: i.id, email: i.email, role: i.role, invitedById: i.invitedById,
  createdAt: i.createdAt, expiresAt: i.expiresAt,
});

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ---------- managing invitations (workspace admins) ----------

  async create(actor: Membership, email: string, role: WorkspaceRole): Promise<InvitationDto> {
    if (role === 'OWNER' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only an owner can invite another owner');
    }
    const existing = await this.prisma.membership.findFirst({
      where: { workspaceId: actor.workspaceId, user: { email } },
    });
    if (existing) throw new ConflictException('This person is already a member');

    // A new invite replaces any pending one for the same address.
    await this.prisma.invitation.updateMany({
      where: { workspaceId: actor.workspaceId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const { invitation, token } = await this.issue(actor.workspaceId, email, role, actor.userId);
    await this.sendMail(invitation, token);
    await this.audit.log({
      workspaceId: actor.workspaceId, actorId: actor.userId, action: 'invitation.created',
      entityType: 'invitation', entityId: invitation.id, metadata: { email, role },
    });
    return toDto(invitation);
  }

  private async issue(workspaceId: string, email: string, role: WorkspaceRole, invitedById: string) {
    const token = randomToken();
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId, email, role, invitedById,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    return { invitation, token };
  }

  private async sendMail(invitation: Invitation, token: string) {
    const [workspace, inviter] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: invitation.workspaceId } }),
      this.prisma.user.findUnique({ where: { id: invitation.invitedById } }),
    ]);
    await this.mail.sendInvitationEmail(invitation.email, inviter?.name ?? 'A teammate', workspace.name, token);
  }

  async listPending(workspaceId: string): Promise<InvitationDto[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async revoke(workspaceId: string, id: string, actorId: string) {
    const res = await this.prisma.invitation.updateMany({
      where: { id, workspaceId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('Invitation not found');
    await this.audit.log({
      workspaceId, actorId, action: 'invitation.revoked', entityType: 'invitation', entityId: id,
    });
  }

  /** Sends the invitation again with a fresh link and expiry; the old link stops working. */
  async resend(actor: Membership, id: string): Promise<InvitationDto> {
    const old = await this.prisma.invitation.findFirst({
      where: { id, workspaceId: actor.workspaceId, acceptedAt: null, revokedAt: null },
    });
    if (!old) throw new NotFoundException('Invitation not found');
    await this.prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    const { invitation, token } = await this.issue(actor.workspaceId, old.email, old.role, actor.userId);
    await this.sendMail(invitation, token);
    return toDto(invitation);
  }

  // ---------- recipient side ----------

  private async findUsable(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: true },
    });
    if (!invitation || invitation.revokedAt) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new GoneException('This invitation was already used');
    if (invitation.expiresAt < new Date()) throw new GoneException('This invitation has expired');
    return invitation;
  }

  async preview(token: string): Promise<InvitationPreviewDto> {
    const inv = await this.findUsable(token);
    const inviter = await this.prisma.user.findUnique({ where: { id: inv.invitedById } });
    return {
      workspaceName: inv.workspace.name, inviterName: inviter?.name ?? 'A teammate',
      email: inv.email, role: inv.role,
    };
  }

  private assertRecipient(inv: Invitation, userEmail: string) {
    if (inv.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException('This invitation was sent to a different email address');
    }
  }

  async accept(token: string, user: { id: string; email: string }): Promise<WorkspaceDto> {
    const inv = await this.findUsable(token);
    this.assertRecipient(inv, user.email);

    const claimed = await this.prisma.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count === 0) throw new GoneException('This invitation was already used');

    // Following the emailed link proves ownership of the address.
    await this.prisma.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    const membership = await this.prisma.membership.upsert({
      where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } },
      create: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role },
      update: {}, // already a member (joined another way): keep their current role
    });
    await this.audit.log({
      workspaceId: inv.workspaceId, actorId: user.id, action: 'member.joined',
      entityType: 'user', entityId: user.id, metadata: { role: membership.role, invitationId: inv.id },
    });
    const w = inv.workspace;
    return { id: w.id, name: w.name, slug: w.slug, createdAt: w.createdAt, role: membership.role };
  }

  async decline(token: string, user: { id: string; email: string }) {
    const inv = await this.findUsable(token);
    this.assertRecipient(inv, user.email);
    await this.prisma.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await this.audit.log({
      workspaceId: inv.workspaceId, actorId: user.id, action: 'invitation.declined',
      entityType: 'invitation', entityId: inv.id,
    });
  }
}
