import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, Public, RequiresSession } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { AuthService, ClientInfo } from './auth.service.js';
import {
  AuthResponseDto, ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto,
  RegisterDto, ResetPasswordDto, SessionDto, TokenDto,
} from './dto/auth.dto.js';

export const REFRESH_COOKIE = 'sx_refresh';
const STRICT = { default: { limit: 10, ttl: 60_000 } };

const clientInfo = (req: Request): ClientInfo => ({
  userAgent: req.headers['user-agent'],
  ip: req.ip,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/v1/auth',
      maxAge: this.auth.refreshMaxAgeMs,
    });
  }

  private respond(res: Response, body: AuthResponseDto) {
    this.setRefreshCookie(res, body.refreshToken);
    return body;
  }

  @Public() @Throttle(STRICT)
  @Post('register')
  @ApiCreatedResponse({ type: AuthResponseDto })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(dto, clientInfo(req)));
  }

  @Public() @Throttle(STRICT)
  @Post('login') @HttpCode(200)
  @ApiOkResponse({ type: AuthResponseDto })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto, clientInfo(req)));
  }

  @Public() @Throttle(STRICT)
  @Post('refresh') @HttpCode(200)
  @ApiOkResponse({ type: AuthResponseDto })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    return this.respond(res, await this.auth.refresh(token));
  }

  @Public()
  @Post('logout') @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(dto.refreshToken ?? req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Public() @Throttle(STRICT)
  @Post('verify-email') @HttpCode(204)
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @ApiBearerAuth() @Throttle(STRICT)
  @Post('resend-verification') @HttpCode(204)
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.id);
  }

  @Public() @Throttle(STRICT)
  @Post('forgot-password') @HttpCode(204)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public() @Throttle(STRICT)
  @Post('reset-password') @HttpCode(204)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @ApiBearerAuth() @RequiresSession() @Throttle(STRICT)
  @Post('change-password') @HttpCode(204)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, user.sessionId, dto.currentPassword, dto.newPassword);
  }

  @ApiBearerAuth() @RequiresSession()
  @Get('sessions')
  @ApiOkResponse({ type: [SessionDto] })
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth() @RequiresSession()
  @Delete('sessions/:id') @HttpCode(204)
  revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.revokeUserSession(user.id, id);
  }
}
