import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { WorkspaceRole } from '../../generated/prisma/enums.js';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;
}

export class UpdateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;
}

export class UpdateMemberRoleDto {
  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}

export class AuditLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Return entries older than this ISO timestamp (for pagination). */
  @IsOptional()
  @IsString()
  before?: string;
}

export class WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  /** The caller's role in this workspace. */
  role: WorkspaceRole;
}

export class MemberDto {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

export class AuditLogDto {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
