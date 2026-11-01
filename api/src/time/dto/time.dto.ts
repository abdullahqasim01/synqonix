import { IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class LogTimeDto {
  /** Minutes spent (1 to 24 hours per entry). */
  @IsInt() @Min(1) @Max(1440) minutes: number;
  /** When the work started; defaults to `minutes` ago. */
  @IsOptional() @IsISO8601() startedAt?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateTimeEntryDto {
  @IsOptional() @IsInt() @Min(1) @Max(1440) minutes?: number;
  @IsOptional() @IsISO8601() startedAt?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) note?: string | null;
}

export class StartTimerDto {
  /** Task key (`SYN-12`) or id. */
  @IsString() taskRef: string;
}

export class TimeEntryDto {
  id: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  userId: string;
  userName: string;
  startedAt: Date;
  endedAt: Date | null;
  /** For a running timer, the minutes so far. */
  minutes: number;
  running: boolean;
  note: string | null;
}

export class TaskTimeDto {
  estimateMinutes: number | null;
  spentMinutes: number;
  entries: TimeEntryDto[];
}

export class TimerDto {
  /** The caller's running timer in this workspace, if any. */
  entry: TimeEntryDto | null;
}

export class TimesheetQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}
