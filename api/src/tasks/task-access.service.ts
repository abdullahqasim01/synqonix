import { Injectable, NotFoundException } from '@nestjs/common';
import type { Membership, Project, Task } from '../generated/prisma/client.js';
import { ProjectAccessService, type ProjectAccess } from '../projects/project-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseTaskRef } from './task-ref.js';

export interface TaskAccess extends ProjectAccess {
  task: Task;
  project: Project;
}

@Injectable()
export class TaskAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  /**
   * Loads a task by id or key inside the caller's workspace, enforcing project visibility
   * (404 for hidden tasks) and, optionally, write / manage rights (403).
   */
  async load(m: Membership, ref: string, opts: { write?: boolean; manage?: boolean } = {}): Promise<TaskAccess> {
    const parsed = parseTaskRef(ref);
    const task =
      parsed.kind === 'id'
        ? await this.prisma.task.findFirst({ where: { id: parsed.id, project: { workspaceId: m.workspaceId } } })
        : await this.prisma.task.findFirst({
            where: {
              number: parsed.number,
              project: { key: parsed.projectKey, workspaceId: m.workspaceId },
            },
          });
    if (!task) throw new NotFoundException('Task not found');
    const access = await this.projects.load(m, task.projectId, opts);
    return { ...access, task };
  }
}
