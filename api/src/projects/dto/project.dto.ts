import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsHexColor, IsOptional, IsString, IsUUID,
  Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { ProjectRole, ProjectTemplate, ProjectVisibility, StatusCategory } from '../../generated/prisma/enums.js';

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  /** 2-10 uppercase letters/digits starting with a letter, e.g. `SYN`. Cannot be changed later. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(PROJECT_KEY_PATTERN, { message: 'key must be 2-10 uppercase letters or digits, starting with a letter' })
  key: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  @IsOptional()
  @IsEnum(ProjectTemplate)
  template?: ProjectTemplate;

  @IsOptional()
  @IsString()
  leadId?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  /** Pass `null` to clear the lead. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  leadId?: string | null;
}

export class ListProjectsQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;
}

export class SetProjectMemberDto {
  @IsString()
  userId: string;

  @IsEnum(ProjectRole)
  role: ProjectRole;
}

export class CreateStatusDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @IsEnum(StatusCategory)
  category: StatusCategory;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateStatusDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsEnum(StatusCategory)
  category?: StatusCategory;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class ReorderStatusesDto {
  /** Every status id of the project, in the desired order. */
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  ids: string[];
}

export class CreateLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateLabelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class StatusDto {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
}

export class LabelDto {
  id: string;
  name: string;
  color: string;
}

export class ProjectMemberDto {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
}

export class ProjectDto {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  visibility: ProjectVisibility;
  template: ProjectTemplate;
  archived: boolean;
  createdAt: Date;
  /** Whether the caller can change this project's settings. */
  canManage: boolean;
}

export class ProjectDetailDto extends ProjectDto {
  statuses: StatusDto[];
  labels: LabelDto[];
}
