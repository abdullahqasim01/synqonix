import { Controller, Get, Header, Headers, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators.js';
import { metrics } from '../common/observability.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('health')
@SkipThrottle()
@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService<Env, true>) {}

  /** Readiness: the database answers. Kept at `/health` for existing probes. */
  @Get('health')
  async check() {
    return this.ready();
  }

  /** Liveness: the process is up and serving; deliberately independent of the database. */
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up', uptime: process.uptime() };
  }

  /** Prometheus metrics; off unless METRICS_TOKEN is set, then bearer-protected. */
  @Get('metrics')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics(@Headers('authorization') auth?: string) {
    const token = this.config.get('METRICS_TOKEN', { infer: true });
    if (!token) throw new NotFoundException();
    const given = Buffer.from((auth ?? '').replace(/^Bearer /, ''));
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new UnauthorizedException();
    return metrics.render();
  }
}
