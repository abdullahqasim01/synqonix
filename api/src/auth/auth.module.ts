import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { UsersController } from '../users/users.controller.js';
import { ApiTokensController } from './api-tokens.controller.js';
import { ApiTokensService } from './api-tokens.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, ApiTokensController, UsersController],
  providers: [
    AuthService,
    ApiTokensService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
