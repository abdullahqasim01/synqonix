import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const make = (query: () => Promise<unknown>) =>
  new HealthController({ $queryRaw: query } as unknown as PrismaService);

describe('HealthController', () => {
  it('reports ok when the database responds', async () => {
    const res = await make(vi.fn().mockResolvedValue([1])).check();
    expect(res).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('throws 503 when the database is down', async () => {
    await expect(
      make(vi.fn().mockRejectedValue(new Error('down'))).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
