import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ChannelType, TaskType } from '../../generated/prisma/enums.js';
import { TaskStatusDto } from '../../tasks/dto/task.dto.js';

const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class SearchQueryDto {
  /**
   * Words to find, plus optional filters for tasks: `assignee:me`, `reporter:me`, `status:open|done|<name>`,
   * `label:<name>`, `type:bug`, `priority:high`, `project:<KEY>`, `is:open|done|overdue|archived`.
   */
  @IsString() @MaxLength(200) q: string;
  /** Comma separated: tasks, comments, projects, channels, messages, people. Everything by default. */
  @IsOptional() @IsString() @MaxLength(100) types?: string;
  /** Results per kind (default 8). */
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class ParsedFiltersDto {
  text: string;
  /** Filters understood in the query, e.g. `{ "assignee": ["me"] }`. */
  filters: Record<string, string[]>;
}

export class TaskHitDto {
  id: string;
  key: string;
  title: string;
  type: TaskType;
  status: TaskStatusDto;
  projectId: string;
  /** Excerpt of the description when the match is there. */
  snippet: string | null;
}

export class CommentHitDto {
  id: string;
  taskKey: string;
  taskTitle: string;
  authorName: string | null;
  snippet: string;
  createdAt: Date;
}

export class ProjectHitDto {
  id: string;
  key: string;
  name: string;
}

export class ChannelHitDto {
  id: string;
  type: ChannelType;
  /** Names of the other people for a direct message. */
  name: string;
  projectId: string | null;
}

export class MessageHitDto {
  id: string;
  channelId: string;
  channelName: string;
  authorName: string | null;
  snippet: string;
  createdAt: Date;
}

export class PersonHitDto {
  userId: string;
  name: string;
  email: string;
}

export class SearchResultDto {
  query: ParsedFiltersDto;
  tasks: TaskHitDto[];
  comments: CommentHitDto[];
  projects: ProjectHitDto[];
  channels: ChannelHitDto[];
  messages: MessageHitDto[];
  people: PersonHitDto[];
}
