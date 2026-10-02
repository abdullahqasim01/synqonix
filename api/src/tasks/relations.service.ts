import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '../generated/prisma/client.js';
import type { RelationType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService } from './activity.service.js';
import { TaskAccessService } from './task-access.service.js';
import { taskKey } from './task-ref.js';

@Injectable()
export class RelationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly activity: ActivityService,
  ) {}

  async add(m: Membership, ref: string, type: RelationType, targetRef: string) {
    const { task, project } = await this.access.load(m, ref, { write: true });
    const { task: target, project: targetProject } = await this.access.load(m, targetRef); // must be visible
    if (target.id === task.id) throw new BadRequestException('A task cannot be related to itself');

    // BLOCKS / DUPLICATES are directional: the reverse pair would be a contradiction.
    // RELATES is symmetric, so either direction counts as a duplicate.
    const clash = await this.prisma.taskRelation.findFirst({
      where: {
        type,
        OR: [
          { fromTaskId: task.id, toTaskId: target.id },
          { fromTaskId: target.id, toTaskId: task.id },
        ],
      },
    });
    if (clash) throw new ConflictException('These tasks are already related that way');

    await this.prisma.$transaction(async (tx) => {
      await tx.taskRelation.create({ data: { fromTaskId: task.id, toTaskId: target.id, type } });
      const label = { BLOCKS: 'blocks', RELATES: 'relates to', DUPLICATES: 'duplicates' }[type];
      await this.activity.record(tx, task.id, m.userId, [
        { type: 'relation_added', to: `${label} ${taskKey(targetProject.key, target.number)}` },
      ]);
      const inverse = { BLOCKS: 'is blocked by', RELATES: 'relates to', DUPLICATES: 'is duplicated by' }[type];
      await this.activity.record(tx, target.id, m.userId, [
        { type: 'relation_added', to: `${inverse} ${taskKey(project.key, task.number)}` },
      ]);
    });
  }

  async remove(m: Membership, ref: string, relationId: string) {
    const { task } = await this.access.load(m, ref, { write: true });
    const rel = await this.prisma.taskRelation.findFirst({
      where: { id: relationId, OR: [{ fromTaskId: task.id }, { toTaskId: task.id }] },
    });
    if (!rel) throw new NotFoundException('Relation not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.taskRelation.delete({ where: { id: relationId } });
      await this.activity.record(tx, task.id, m.userId, [{ type: 'relation_removed' }]);
    });
  }
}
