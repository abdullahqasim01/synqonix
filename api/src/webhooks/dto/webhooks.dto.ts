import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export const WEBHOOK_EVENTS = ['task.created', 'task.updated', 'task.status_changed', 'task.commented', 'task.deleted'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export class CreateWebhookDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  /** Public https URL that accepts POSTs of JSON. */
  @IsString() @MaxLength(2000) url: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(WEBHOOK_EVENTS.length) @IsIn(WEBHOOK_EVENTS, { each: true }) events: WebhookEvent[];
  /** Only events of this project; every project when omitted. */
  @IsOptional() @IsString() projectId?: string;
}

export class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(WEBHOOK_EVENTS.length) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: WebhookEvent[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() projectId?: string | null;
  /** Turning it back on also clears the failure counter. */
  @IsOptional() @IsBoolean() active?: boolean;
}

export class WebhookDto {
  id: string;
  name: string;
  url: string;
  events: string[];
  projectId: string | null;
  active: boolean;
  failureCount: number;
  disabledReason: string | null;
  lastSuccessAt: Date | null;
  createdAt: Date;
}

export class CreatedWebhookDto extends WebhookDto {
  /** The signing secret. Shown only now; store it. */
  secret: string;
}

export class DeliveryDto {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
  nextAttemptAt: Date;
}

export class TestResultDto {
  ok: boolean;
  responseStatus: number | null;
  error: string | null;
}
