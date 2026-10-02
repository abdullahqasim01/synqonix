import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString,
  MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { StatusCategory, TaskPriority, TaskType, ViewLayout, ViewScope } from '../../generated/prisma/enums.js';

export const SORT_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'startDate', 'priority', 'number', 'position', 'title'] as const;
export const SWIMLANES = ['none', 'assignee', 'priority', 'epic'] as const;

/** Task filters a view can store. `assignee` accepts `me`, `none` or a user id. */
export class ViewFiltersDto {
  @IsOptional() @IsString() statusId?: string;
  @IsOptional() @IsEnum(StatusCategory) statusCategory?: StatusCategory;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsString() reporter?: string;
  @IsOptional() @IsString() labelId?: string;
  @IsOptional() @IsString() parent?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsDateString() dueBefore?: string;
  @IsOptional() @IsDateString() dueAfter?: string;
  @IsOptional() @IsBoolean() includeArchived?: boolean;
  @IsOptional() @IsBoolean() excludeSubtasks?: boolean;
}

export class ViewDisplayDto {
  /** Board columns the user chose to hide. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) hiddenStatusIds?: string[];
  /** List columns to hide, e.g. `priority`, `assignees`, `due`, `labels`. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) hiddenColumns?: string[];
  /** Fields shown on board cards: `key`, `priority`, `assignees`, `labels`, `due`, `estimate`. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) cardFields?: string[];
}

export class ViewQueryDto {
  @IsOptional() @ValidateNested() @Type(() => ViewFiltersDto) filters?: ViewFiltersDto;
  @IsOptional() @IsIn(SORT_FIELDS) sort?: (typeof SORT_FIELDS)[number];
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @IsIn(SWIMLANES) swimlane?: (typeof SWIMLANES)[number];
  @IsOptional() @ValidateNested() @Type(() => ViewDisplayDto) display?: ViewDisplayDto;
}

export class CreateViewDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsEnum(ViewLayout) layout?: ViewLayout;
  @IsOptional() @IsEnum(ViewScope) scope?: ViewScope;
  /** Omit for a workspace-wide view that spans every project. */
  @IsOptional() @IsString() projectId?: string;
  @ValidateNested() @Type(() => ViewQueryDto) query: ViewQueryDto;
}

export class UpdateViewDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsEnum(ViewLayout) layout?: ViewLayout;
  @IsOptional() @IsEnum(ViewScope) scope?: ViewScope;
  @IsOptional() @ValidateNested() @Type(() => ViewQueryDto) query?: ViewQueryDto;
}

export class ListViewsQueryDto {
  /** Views of this project; omit for workspace-wide views. */
  @IsOptional() @IsString() projectId?: string;
}

export class ViewDto {
  id: string;
  name: string;
  scope: ViewScope;
  layout: ViewLayout;
  projectId: string | null;
  ownerId: string;
  query: ViewQueryDto;
  /** Whether the caller may rename, change or delete it. */
  canEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
}
