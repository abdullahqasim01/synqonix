import { OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject,
  IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { StatusCategory, TaskPriority, TaskType } from '../../generated/prisma/enums.js';

const toBool = ({ value }: { value: unknown }) => value === 'true' || value === true;

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title: string;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  /** Markdown, up to 50,000 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  description?: string;

  /** Defaults to the project's first "to do" status. */
  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  labelIds?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  estimate?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  /** Map of custom field id to value. */
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  /** Pass `null` to clear. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(50_000)
  description?: string | null;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  /** Replaces the assignee list. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  assigneeIds?: string[];

  /** Replaces the label list. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  labelIds?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(1000)
  estimate?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  /** Pass `null` to detach from the parent. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  parentId?: string | null;

  /** Map of custom field id to value; `null` clears a value. */
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class BulkChangesDto {
  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  /** Replaces the assignee list of every selected task. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addLabelIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeLabelIds?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class BulkUpdateTasksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  taskIds: string[];

  @ValidateNested()
  @Type(() => BulkChangesDto)
  changes: BulkChangesDto;
}

export class MoveTaskDto {
  /** Destination project in the same workspace. */
  @IsString()
  projectId: string;
}

export class ListTasksQueryDto {
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() statusId?: string;
  @IsOptional() @IsEnum(StatusCategory) statusCategory?: StatusCategory;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  /** `me`, `none` (unassigned) or a user id. */
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsString() reporter?: string;
  @IsOptional() @IsString() labelId?: string;
  /** `none` for top-level tasks, or a parent task id. */
  @IsOptional() @IsString() parent?: string;
  /** Matches the title, or the key / number (`SYN-12`, `12`). */
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsDateString() dueBefore?: string;
  @IsOptional() @IsDateString() dueAfter?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() includeArchived?: boolean;
  /** Hide sub-tasks (boards do this by default). */
  @IsOptional() @Transform(toBool) @IsBoolean() excludeSubtasks?: boolean;
  /** Apply a saved view; explicit parameters override its filters. */
  @IsOptional() @IsString() view?: string;
  @IsOptional() @IsEnum(['createdAt', 'updatedAt', 'dueDate', 'startDate', 'priority', 'number', 'position', 'title'])
  sort?: 'createdAt' | 'updatedAt' | 'dueDate' | 'startDate' | 'priority' | 'number' | 'position' | 'title';
  @IsOptional() @IsEnum(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class RankTaskDto {
  /** Column to drop the card into. Defaults to the card's current status. */
  @IsOptional()
  @IsString()
  statusId?: string;

  /** Place the card directly above this card (which must be in the target column). */
  @IsOptional()
  @IsString()
  beforeId?: string;

  /** Place the card directly below this card (which must be in the target column). */
  @IsOptional()
  @IsString()
  afterId?: string;
}

export class RecentTasksQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class BoardQueryDto extends OmitType(ListTasksQueryDto, ['statusId', 'statusCategory', 'sort', 'order', 'offset'] as const) {}

export class BoardStatusDto {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
  /** Soft limit: the board warns when a column holds more tasks than this. */
  wipLimit: number | null;
}

export class BoardColumnDto {
  status: BoardStatusDto;
  /** Matching tasks in this column, ignoring the per-column limit. */
  total: number;
  /** Ordered by rank; at most `limit` tasks. */
  tasks: TaskDto[];
  hasMore: boolean;
}

export class BoardDto {
  projectId: string;
  columns: BoardColumnDto[];
  /** Epics of the project, for epic swimlanes. */
  epics: TaskRefDto[];
}

export class TaskUserDto {
  userId: string;
  name: string;
}

export class TaskStatusDto {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
}

export class TaskLabelDto {
  id: string;
  name: string;
  color: string;
}

export class TaskDto {
  id: string;
  /** Human key, e.g. `SYN-12`. */
  key: string;
  number: number;
  projectId: string;
  projectKey: string;
  title: string;
  type: TaskType;
  status: TaskStatusDto;
  priority: TaskPriority;
  assignees: TaskUserDto[];
  labels: TaskLabelDto[];
  reporterId: string | null;
  estimate: number | null;
  startDate: Date | null;
  dueDate: Date | null;
  parentId: string | null;
  position: number;
  archived: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
}

export class TaskListDto {
  items: TaskDto[];
  total: number;
}

export class TaskRefDto {
  id: string;
  key: string;
  title: string;
  type: TaskType;
  status: TaskStatusDto;
}

export class TaskRelationDto {
  id: string;
  /** `blocks`, `blocked_by`, `relates_to`, `duplicates` or `duplicated_by`. */
  kind: string;
  task: TaskRefDto;
}

export class ChecklistItemDto {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export class ChecklistDto {
  id: string;
  title: string;
  position: number;
  items: ChecklistItemDto[];
}

export class AttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploaderId: string | null;
  createdAt: Date;
}

export class TaskCustomValueDto {
  fieldId: string;
  name: string;
  type: string;
  value: string | number | boolean | null;
}

export class TaskDetailDto extends TaskDto {
  description: string | null;
  parent: TaskRefDto | null;
  subtasks: TaskDto[];
  relations: TaskRelationDto[];
  checklists: ChecklistDto[];
  attachments: AttachmentDto[];
  customFields: TaskCustomValueDto[];
  watchers: TaskUserDto[];
  isWatching: boolean;
  /** Whether the caller may edit this task. */
  canEdit: boolean;
}

export class BulkResultDto {
  updated: number;
}

export class ActivityDto {
  id: string;
  actorId: string | null;
  type: string;
  field: string | null;
  from: unknown;
  to: unknown;
  createdAt: Date;
}
