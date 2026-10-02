import { Transform } from 'class-transformer';
import { IsEmail, IsEnum } from 'class-validator';
import { WorkspaceRole } from '../../generated/prisma/enums.js';

export class CreateInvitationDto {
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}

export class InvitationDto {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedById: string;
  createdAt: Date;
  expiresAt: Date;
}

export class InvitationPreviewDto {
  workspaceName: string;
  inviterName: string;
  /** The address the invitation was sent to; you must be signed in with it to accept. */
  email: string;
  role: WorkspaceRole;
}
