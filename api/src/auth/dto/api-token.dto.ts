import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateApiTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ApiTokenDto {
  id: string;
  name: string;
  /** First characters of the token, to help identify it. */
  prefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export class CreatedApiTokenDto extends ApiTokenDto {
  /** The full token. Shown once. */
  token: string;
}
