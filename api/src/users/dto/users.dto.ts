import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

export class DeleteAccountDto {
  @IsString()
  @MaxLength(128)
  password: string;
}
