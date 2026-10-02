import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min,
  MinLength, ValidateIf,
} from 'class-validator';
import { ChannelRole, ChannelType, TaskLinkSource } from '../../generated/prisma/enums.js';
import { TaskRefDto } from '../../tasks/dto/task.dto.js';

const toBool = ({ value }: { value: unknown }) => value === 'true' || value === true;
const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

// ---------------------------------------------------------------- channels

export class CreateChannelDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsIn(['PUBLIC', 'PRIVATE']) type: 'PUBLIC' | 'PRIVATE';
  @IsOptional() @IsString() @MaxLength(250) topic?: string;
  /** Extra people to add (private channels). The creator is always a member and admin. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) memberIds?: string[];
}

export class UpdateChannelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(250) topic?: string | null;
  /** Archived channels are read-only. */
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class DirectChannelDto {
  /** The other participants (1 to 7). The same set of people always shares one conversation. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsString({ each: true }) userIds: string[];
}

export class ListChannelsQueryDto {
  @IsOptional() @Transform(toBool) @IsBoolean() includeArchived?: boolean;
}

export class ChannelMemberInputDto {
  @IsString() userId: string;
}

export class ParticipantDto {
  userId: string;
  name: string;
}

export class ChannelDto {
  id: string;
  type: ChannelType;
  /** Null for direct messages; use `participants`. */
  name: string | null;
  topic: string | null;
  /** Set for a project's own channel. */
  projectId: string | null;
  archived: boolean;
  memberCount: number;
  isMember: boolean;
  /** May rename, archive and manage members. */
  isAdmin: boolean;
  canPost: boolean;
  /** Top-level messages from others since the caller last read the channel. */
  unreadCount: number;
  /** Messages mentioning the caller since they last read the channel. */
  mentionCount: number;
  lastSeq: number;
  lastReadSeq: number;
  lastMessageAt: Date | null;
  /** The people in a direct conversation (other than the caller when there are several). */
  participants: ParticipantDto[];
}

export class ChannelMemberDto {
  userId: string;
  name: string;
  email: string;
  role: ChannelRole;
}

// ---------------------------------------------------------------- messages

export class PostMessageDto {
  /** Markdown. Mention a teammate with `[@Name](mention:<userId>)`; task keys like `SYN-12` become links. */
  @IsString() @MaxLength(10_000) body: string;
  /** Reply in the thread of this top-level message. */
  @IsOptional() @IsString() parentId?: string;
  /** Files uploaded earlier through the attachments endpoint. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) attachmentIds?: string[];
}

export class EditMessageDto {
  @IsString() @MinLength(1) @MaxLength(10_000) body: string;
}

export class ListMessagesQueryDto {
  /** Messages older than this sequence number (scrolling back). */
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) before?: number;
  /** Messages newer than this sequence number, oldest first (catching up after a disconnect). */
  @IsOptional() @Transform(toInt) @IsInt() @Min(0) after?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Include thread replies in the stream (needed to catch up completely). */
  @IsOptional() @Transform(toBool) @IsBoolean() threads?: boolean;
}

export class RepliesQueryDto {
  @IsOptional() @Transform(toInt) @IsInt() @Min(0) after?: number;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class MarkReadDto {
  /** Read up to this sequence number; defaults to the latest. */
  @IsOptional() @IsInt() @Min(0) seq?: number;
}

export class ReactionDto {
  emoji: string;
  count: number;
  userIds: string[];
  /** Whether the caller reacted. */
  reacted: boolean;
}

export class MessageAttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export class MessageAuthorDto {
  userId: string;
  name: string;
}

export class MessageDto {
  id: string;
  channelId: string;
  seq: number;
  parentId: string | null;
  author: MessageAuthorDto | null;
  /** Empty when deleted. */
  body: string;
  deleted: boolean;
  edited: boolean;
  createdAt: Date;
  editedAt: Date | null;
  replyCount: number;
  lastReplyAt: Date | null;
  reactions: ReactionDto[];
  attachments: MessageAttachmentDto[];
  /** Task keys written in the message. */
  taskKeys: string[];
  /** Cards for linked tasks the caller can see (written, linked by hand or created from the message). */
  tasks: TaskRefDto[];
}

export class MessageListDto {
  /** Oldest first. */
  messages: MessageDto[];
  /** Whether older (or, with `after`, newer) messages exist beyond this page. */
  hasMore: boolean;
}

export class LinkTaskDto {
  /** Key (`SYN-12`) or id. */
  @IsString() taskRef: string;
}

export class CreateTaskFromMessageDto {
  @IsString() projectId: string;
  /** Defaults to the first line of the message. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
}

export class TaskRefsQueryDto {
  /** Comma separated task keys, up to 50. */
  @IsString() @MaxLength(1000) keys: string;
}

export class DiscussionChannelDto {
  id: string;
  name: string | null;
  type: ChannelType;
}

export class DiscussionDto {
  message: MessageDto;
  channel: DiscussionChannelDto;
  source: TaskLinkSource;
}
