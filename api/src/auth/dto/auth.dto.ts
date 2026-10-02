import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @IsEmail()
  @Transform(normalizeEmail)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @IsEmail()
  @Transform(normalizeEmail)
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  /** Only needed by non-browser clients; browsers send the httpOnly cookie. */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class TokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @Transform(normalizeEmail)
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class UserDto {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: Date;
}

export class AuthResponseDto {
  user: UserDto;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Also returned for non-browser clients; browsers receive it as an httpOnly cookie. */
  refreshToken: string;
}

export class SessionDto {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}
