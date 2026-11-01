import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class RangeQueryDto {
  /** How many days back to look (default 30). */
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(180) days?: number;
  /** Group by day or by week (Monday start). */
  @IsOptional() @IsIn(['day', 'week']) bucket?: 'day' | 'week';
}

export class TimeReportQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class CreatedResolvedPointDto {
  /** Start of the day, or of the week for weekly buckets (UTC, `YYYY-MM-DD`). */
  date: string;
  created: number;
  resolved: number;
}

export class CreatedResolvedDto {
  bucket: 'day' | 'week';
  points: CreatedResolvedPointDto[];
  totalCreated: number;
  totalResolved: number;
  /** Tasks open right now. */
  openNow: number;
}

export class StatusCountDto {
  name: string;
  count: number;
}

export class FlowPointDto {
  date: string;
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  byStatus: StatusCountDto[];
}

export class CumulativeFlowDto {
  /** Status names, workflow order. */
  statuses: string[];
  points: FlowPointDto[];
}

export class WorkloadRowDto {
  /** Null for work nobody is assigned to. */
  userId: string | null;
  name: string;
  openTasks: number;
  openPoints: number;
  overdueTasks: number;
  doneLast30Days: number;
}

export class WorkloadDto {
  rows: WorkloadRowDto[];
}

export class OverdueTaskDto {
  id: string;
  key: string;
  title: string;
  dueDate: Date;
  daysOverdue: number;
  assignees: string[];
  statusName: string;
}

export class TimeByUserDto {
  userId: string;
  name: string;
  minutes: number;
}

export class TimeByTaskDto {
  key: string;
  title: string;
  estimateMinutes: number | null;
  spentMinutes: number;
}

export class TimeReportDto {
  from: Date;
  to: Date;
  totalMinutes: number;
  byUser: TimeByUserDto[];
  /** Tasks with the most time logged in the period. */
  byTask: TimeByTaskDto[];
  /** Over every task that has an estimate: planned vs logged (all time). */
  estimatedMinutes: number;
  actualMinutesOnEstimated: number;
}

export class ProjectOverviewDto {
  projectId: string;
  key: string;
  name: string;
  open: number;
  done: number;
  overdue: number;
  createdLast14Days: number;
  resolvedLast14Days: number;
}

export class WorkspaceOverviewDto {
  projects: ProjectOverviewDto[];
  workload: WorkloadRowDto[];
  totalOpen: number;
  totalOverdue: number;
}
