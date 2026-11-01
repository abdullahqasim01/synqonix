import { Injectable } from '@nestjs/common';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskAccessService } from './task-access.service.js';

@Injectable()
export class WatchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
  ) {}

  async watch(m: Membership, ref: string) {
    const { task } = await this.access.load(m, ref); // anyone who can see a task may follow it
    await this.prisma.taskWatcher.createMany({ data: [{ taskId: task.id, userId: m.userId }], skipDuplicates: true });
  }

  async unwatch(m: Membership, ref: string) {
    const { task } = await this.access.load(m, ref);
    await this.prisma.taskWatcher.deleteMany({ where: { taskId: task.id, userId: m.userId } });
  }
}
