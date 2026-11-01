import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class AddTeamMemberDto {
  @IsUUID()
  userId: string;
}

export class TeamMemberDto {
  userId: string;
  name: string;
  email: string;
}

export class TeamDto {
  id: string;
  name: string;
  description: string | null;
  members: TeamMemberDto[];
  createdAt: Date;
}
