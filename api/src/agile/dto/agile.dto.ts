import { OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional,
  IsString, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { ReleaseStatus, SnapshotReason, SprintState, TaskType } from '../../generated/prisma/enums.js';
import { ListTasksQueryDto, TaskDto, TaskRefDto } from '../../tasks/dto/task.dto.js';

// ---------------------------------------------------------------- sprints

export class CreateSprintDto {
  /** Defaults to "Sprint <number>". */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) goal?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  /** Planned capacity in the project's estimation unit. */
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) capacity?: number;
}

export class UpdateSprintDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) goal?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() startDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() endDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) @Max(100_000) capacity?: number | null;
}

export class StartSprintDto {
  /** Defaults to the planned start, or now. */
  @IsOptional() @IsDateString() startDate?: string;
  /** Defaults to the planned end, or start + the project's sprint length. */
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) capacity?: number;
}

export class CompleteSprintDto {
  /** What happens to unfinished tasks. */
  @IsIn(['BACKLOG', 'NEXT_SPRINT', 'SPRINT']) carryOver: 'BACKLOG' | 'NEXT_SPRINT' | 'SPRINT';
  /** Required when `carryOver` is `SPRINT`: a planned sprint of the project. */
  @IsOptional() @IsString() targetSprintId?: string;
}

export class SprintTasksDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) taskIds: string[];
}

export class ListSprintsQueryDto {
  @IsOptional() @IsEnum(SprintState) state?: SprintState;
}

export class SprintStatsDto {
  taskCount: number;
  doneCount: number;
  /** Sum of estimates (unit-agnostic). */
  points: number;
  donePoints: number;
}

export class SprintSummaryDto {
  committedPoints: number;
  committedTasks: number;
  /** Scope added after the sprint started. */
  addedPoints: number;
  /** Scope removed after the sprint started. */
  removedPoints: number;
  completedPoints: number;
  completedTasks: number;
  carriedOverPoints: number;
  carriedOverTasks: number;
}

export class SprintDto {
  id: string;
  number: number;
  name: string;
  goal: string | null;
  state: SprintState;
  startDate: Date | null;
  endDate: Date | null;
  capacity: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Committed scope once started; full results once completed. */
  summary: SprintSummaryDto | null;
  stats: SprintStatsDto;
  createdAt: Date;
}

export class CompleteSprintResultDto {
  sprint: SprintDto;
  /** The sprint unfinished tasks were moved to, if any. */
  nextSprint: SprintDto | null;
  carriedOverCount: number;
}

// ---------------------------------------------------------------- backlog

export class BacklogQueryDto extends OmitType(ListTasksQueryDto, [
  'projectId', 'statusId', 'statusCategory', 'sprintId', 'sort', 'order', 'offset', 'excludeSubtasks', 'includeArchived',
] as const) {
  /** Also list finished tasks that are not in a sprint. */
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeDone?: boolean;
}

export class BacklogSprintDto {
  sprint: SprintDto;
  tasks: TaskDto[];
}

export class BacklogSectionDto {
  tasks: TaskDto[];
  total: number;
  points: number;
}

export class BacklogDto {
  /** Planned and active sprints, active first, then by number. */
  sprints: BacklogSprintDto[];
  backlog: BacklogSectionDto;
  epics: TaskRefDto[];
}

export class BacklogRankDto {
  /** Sprint to drop the task into, or `null` for the backlog. */
  @ValidateIf((_, v) => v !== null) @IsString() sprintId: string | null;
  /** Place the task above this one (which must be in the same list). */
  @IsOptional() @IsString() beforeId?: string;
  @IsOptional() @IsString() afterId?: string;
}

// ---------------------------------------------------------------- reports

export class SnapshotDto {
  at: Date;
  reason: SnapshotReason;
  scopePoints: number;
  donePoints: number;
  remainingPoints: number;
  scopeTasks: number;
  doneTasks: number;
  remainingTasks: number;
}

export class IdealPointDto {
  /** `YYYY-MM-DD` (UTC). */
  date: string;
  remaining: number;
}

export class BurndownDto {
  sprint: SprintDto;
  /** Every recorded point: at start, daily, on scope changes and at completion. */
  points: SnapshotDto[];
  /** Straight line from the committed scope to zero at the sprint end. */
  ideal: IdealPointDto[];
}

export class VelocityEntryDto {
  sprintId: string;
  number: number;
  name: string;
  completedAt: Date;
  committedPoints: number;
  completedPoints: number;
  addedPoints: number;
  carriedOverPoints: number;
  completedTasks: number;
}

export class VelocityDto {
  unit: string;
  /** Oldest first. */
  sprints: VelocityEntryDto[];
  /** Average completed points over the returned sprints. */
  average: number;
  /** Average over the three most recent sprints. */
  recentAverage: number;
}

export class FlowQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

export class FlowTaskDto {
  key: string;
  title: string;
  type: TaskType;
  completedAt: Date;
  /** From creation to completion. */
  leadTimeDays: number;
  /** From the first move into progress to completion. */
  cycleTimeDays: number | null;
}

export class FlowStatsDto {
  count: number;
  avgLeadDays: number | null;
  medianLeadDays: number | null;
  p85LeadDays: number | null;
  avgCycleDays: number | null;
  medianCycleDays: number | null;
  p85CycleDays: number | null;
}

export class ThroughputDto {
  /** Monday of the week, `YYYY-MM-DD`. */
  weekStart: string;
  count: number;
}

export class FlowDto {
  days: number;
  stats: FlowStatsDto;
  throughput: ThroughputDto[];
  /** Tasks currently in progress. */
  wip: number;
  tasks: FlowTaskDto[];
}

export class EpicProgressDto {
  id: string;
  key: string;
  title: string;
  status: string;
  startDate: Date | null;
  dueDate: Date | null;
  childCount: number;
  doneCount: number;
  points: number;
  donePoints: number;
  /** 0-100, by estimate when the children have estimates, otherwise by count. */
  progress: number;
}

// ---------------------------------------------------------------- releases & milestones

export class CreateReleaseDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string;
  @IsOptional() @IsDateString() startDate?: string;
  /** Planned release date. */
  @IsOptional() @IsDateString() releaseDate?: string;
}

export class UpdateReleaseDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20_000) description?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() startDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() releaseDate?: string | null;
  /** Use `POST …/ship` to release; this only toggles archiving. */
  @IsOptional() @IsIn(['UNRELEASED', 'ARCHIVED']) status?: 'UNRELEASED' | 'ARCHIVED';
}

export class ShipReleaseDto {
  /** Move unfinished tasks to this (unreleased) release instead of leaving them on the shipped one. */
  @IsOptional() @IsString() moveUnfinishedTo?: string;
}

export class CountsDto {
  total: number;
  done: number;
}

export class ReleaseDto {
  id: string;
  name: string;
  description: string | null;
  status: ReleaseStatus;
  startDate: Date | null;
  releaseDate: Date | null;
  releasedAt: Date | null;
  counts: CountsDto;
  createdAt: Date;
}

export class ReleaseNoteSectionDto {
  title: string;
  tasks: { key: string; title: string }[];
}

export class ReleaseNotesDto {
  markdown: string;
  sections: ReleaseNoteSectionDto[];
  /** Tasks on the release that are not done yet (not listed in the notes). */
  unfinished: number;
}

export class CreateMilestoneDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(5_000) description?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateMilestoneDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5_000) description?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() dueDate?: string | null;
  /** Close or reopen. */
  @IsOptional() @IsBoolean() closed?: boolean;
}

export class MilestoneDto {
  id: string;
  name: string;
  description: string | null;
  dueDate: Date | null;
  closedAt: Date | null;
  counts: CountsDto;
  createdAt: Date;
}
