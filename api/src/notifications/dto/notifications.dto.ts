import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { EmailMode, NotificationType } from '../../generated/prisma/enums.js';

const toBool = ({ value }: { value: unknown }) => value === 'true' || value === true;
const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

export class ListNotificationsQueryDto {
  @IsOptional() @IsString() workspaceId?: string;
  /** Only unread ones. */
  @IsOptional() @Transform(toBool) @IsBoolean() unread?: boolean;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Cursor: `surfacedAt` of the last item of the previous page. */
  @IsOptional() @IsISO8601() before?: string;
}

export class NotificationDto {
  id: string;
  type: NotificationType;
  workspaceId: string;
  projectId: string | null;
  actorId: string | null;
  title: string;
  body: string | null;
  taskKey: string | null;
  channelId: string | null;
  /** App path to open. */
  url: string;
  read: boolean;
  /** When it (re)appeared in the inbox. */
  surfacedAt: Date;
}

export class NotificationListDto {
  items: NotificationDto[];
  hasMore: boolean;
}

export class WorkspaceUnreadDto {
  workspaceId: string;
  count: number;
}

export class UnreadCountDto {
  count: number;
  workspaces: WorkspaceUnreadDto[];
}

export class ReadAllDto {
  @IsOptional() @IsString() workspaceId?: string;
}

export class SnoozeDto {
  /** When it should come back, at most 30 days away. */
  @IsISO8601() until: string;
}

export class TypePreferenceDto {
  @IsEnum(NotificationType) type: NotificationType;
  @IsBoolean() inApp: boolean;
  @IsBoolean() email: boolean;
}

export class QuietHoursDto {
  @IsBoolean() enabled: boolean;
  /** `HH:MM` in `timezone`. */
  @IsString() @MaxLength(5) start: string;
  @IsString() @MaxLength(5) end: string;
  /** IANA name such as `Europe/Berlin`. */
  @IsString() @MaxLength(64) timezone: string;
}

export class PreferencesDto {
  emailMode: EmailMode;
  quietHours: QuietHoursDto;
  types: TypePreferenceDto[];
  mutedProjectIds: string[];
}

export class UpdatePreferencesDto {
  @IsOptional() @IsIn(['INSTANT', 'DIGEST', 'OFF']) emailMode?: EmailMode;
  @IsOptional() @ValidateNested() @Type(() => QuietHoursDto) quietHours?: QuietHoursDto;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TypePreferenceDto) types?: TypePreferenceDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) mutedProjectIds?: string[];
}
