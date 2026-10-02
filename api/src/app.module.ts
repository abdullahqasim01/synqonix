import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpThrottlerGuard } from './common/http-throttler.guard.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MailModule } from './mail/mail.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ViewsModule } from './views/views.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      // Lets e2e suites that create many accounts run without tripping limits.
      skipIf: () => process.env.THROTTLE_DISABLED === '1',
    }),
    PrismaModule,
    MailModule,
    AuditModule,
    AuthModule,
    WorkspacesModule,
    ViewsModule,
    TasksModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
