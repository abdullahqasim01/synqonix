import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { CustomFieldType, RelationType } from '../../generated/prisma/enums.js';
import { Type } from 'class-transformer';

export class CommentBodyDto {
  /** Markdown. Mention a teammate with `[@Name](mention:<userId>)`. */
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body: string;
}

export class CommentDto {
  id: string;
  authorId: string | null;
  body: string;
  edited: boolean;
  createdAt: Date;
  editedAt: Date | null;
}

export class CreateChecklistDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;
}

export class UpdateChecklistDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;
}

export class CreateChecklistItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  text: string;
}

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  text?: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class CreateRelationDto {
  @IsEnum(RelationType)
  type: RelationType;

  /** Key (`SYN-12`) or id of the other task. */
  @IsString()
  targetTask: string;
}

export class ActivityQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsString() before?: string;
}

export class CreateCustomFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @IsEnum(CustomFieldType)
  type: CustomFieldType;

  /** Required for SELECT fields. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value))
  options?: string[];
}

export class UpdateCustomFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  options?: string[];
}

export class CustomFieldDto {
  id: string;
  name: string;
  type: CustomFieldType;
  options: string[] | null;
  position: number;
}
