import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { RecurrenceFrequency, TaskPriority, TaskType } from '../../generated/prisma/enums.js';

export class TemplateChecklistDto {
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(300, { each: true }) items: string[];
}

export class CreateTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(50_000) description?: string;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) labelIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => TemplateChecklistDto) checklists?: TemplateChecklistDto[];
  @IsOptional() @IsNumber() @Min(0) @Max(1000) estimate?: number;
  @IsOptional() @IsInt() @Min(0) @Max(600_000) timeEstimateMinutes?: number;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(50_000) description?: string | null;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) labelIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => TemplateChecklistDto) checklists?: TemplateChecklistDto[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(1000) estimate?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(600_000) timeEstimateMinutes?: number | null;
}

export class TemplateDto {
  id: string;
  name: string;
  title: string;
  description: string | null;
  type: TaskType;
  priority: TaskPriority;
  labelIds: string[];
  checklists: TemplateChecklistDto[];
  estimate: number | null;
  timeEstimateMinutes: number | null;
}

export class SaveAsTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
}

export class CreateFromTemplateDto {
  /** Replaces the template's title. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(50_000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) assigneeIds?: string[];
  @IsOptional() @IsString() statusId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

// ---------------------------------------------------------------- recurring

export class CreateRecurringDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  /** May contain `{date}`, replaced by the day the task is created. */
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(50_000) description?: string;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) assigneeIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) labelIds?: string[];
  @IsEnum(RecurrenceFrequency) frequency: RecurrenceFrequency;
  /** Every N days, weeks or months. */
  @IsInt() @Min(1) @Max(52) interval: number;
  /** First run; later runs follow from it. */
  @IsDateString() startsAt: string;
}

export class UpdateRecurringDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(50_000) description?: string | null;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) assigneeIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) labelIds?: string[];
  @IsOptional() @IsEnum(RecurrenceFrequency) frequency?: RecurrenceFrequency;
  @IsOptional() @IsInt() @Min(1) @Max(52) interval?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class RecurringDto {
  id: string;
  name: string;
  title: string;
  description: string | null;
  type: TaskType;
  priority: TaskPriority;
  assigneeIds: string[];
  labelIds: string[];
  frequency: RecurrenceFrequency;
  interval: number;
  startsAt: Date;
  nextRunAt: Date;
  lastRunAt: Date | null;
  /** Key of the task created by the last run. */
  lastTaskKey: string | null;
  active: boolean;
}
