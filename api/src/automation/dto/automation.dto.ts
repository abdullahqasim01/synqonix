import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { AutomationTrigger, TaskPriority, TaskType } from '../../generated/prisma/enums.js';

export const ACTION_TYPES = ['SET_PRIORITY', 'ASSIGN', 'ADD_LABEL', 'MOVE_TO_STATUS', 'COMMENT'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export class AutomationConditionsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsEnum(TaskType, { each: true }) types?: TaskType[];
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsEnum(TaskPriority, { each: true }) priorities?: TaskPriority[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) labelIds?: string[];
}

export class AutomationActionDto {
  @IsIn(ACTION_TYPES) type: ActionType;
  /** SET_PRIORITY: a priority; ASSIGN: a user id; ADD_LABEL: a label id; MOVE_TO_STATUS: a status id; COMMENT: the text. */
  @IsString() @MinLength(1) @MaxLength(2000) value: string;
}

export class CreateAutomationDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsEnum(AutomationTrigger) trigger: AutomationTrigger;
  /** For `STATUS_CHANGED`: only when a task moves to this status (any status when omitted). */
  @IsOptional() @IsString() triggerStatusId?: string;
  @IsOptional() @ValidateNested() @Type(() => AutomationConditionsDto) conditions?: AutomationConditionsDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => AutomationActionDto) actions: AutomationActionDto[];
}

export class UpdateAutomationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsEnum(AutomationTrigger) trigger?: AutomationTrigger;
  @IsOptional() @IsString() triggerStatusId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => AutomationConditionsDto) conditions?: AutomationConditionsDto;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => AutomationActionDto) actions?: AutomationActionDto[];
}

export class AutomationDto {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  triggerStatusId: string | null;
  conditions: AutomationConditionsDto;
  actions: AutomationActionDto[];
  runCount: number;
  lastRunAt: Date | null;
  lastError: string | null;
}
