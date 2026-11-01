import { Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService } from './activity.service.js';
import type { ChecklistDto } from './dto/task.dto.js';
import type { UpdateChecklistItemDto } from './dto/details.dto.js';
import { TaskAccessService } from './task-access.service.js';

const include = { items: { orderBy: { position: 'asc' } } } as const;

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly activity: ActivityService,
  ) {}

  private toDto(c: { id: string; title: string; position: number; items: { id: string; text: string; done: boolean; position: number }[] }): ChecklistDto {
    return {
      id: c.id, title: c.title, position: c.position,
      items: c.items.map((i) => ({ id: i.id, text: i.text, done: i.done, position: i.position })),
    };
  }

  private async findChecklist(taskId: string, checklistId: string) {
    const c = await this.prisma.checklist.findFirst({ where: { id: checklistId, taskId }, include });
    if (!c) throw new NotFoundException('Checklist not found');
    return c;
  }

  async create(m: Membership, ref: string, title: string): Promise<ChecklistDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    const last = await this.prisma.checklist.aggregate({ where: { taskId: task.id }, _max: { position: true } });
    const created = await this.prisma.$transaction(async (tx) => {
      const c = await tx.checklist.create({
        data: { taskId: task.id, title: title.trim(), position: (last._max.position ?? -1) + 1 }, include,
      });
      await this.activity.record(tx, task.id, m.userId, [{ type: 'checklist_added', to: c.title }]);
      return c;
    });
    return this.toDto(created);
  }

  async rename(m: Membership, ref: string, checklistId: string, title: string): Promise<ChecklistDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    await this.findChecklist(task.id, checklistId);
    return this.toDto(await this.prisma.checklist.update({ where: { id: checklistId }, data: { title: title.trim() }, include }));
  }

  async remove(m: Membership, ref: string, checklistId: string) {
    const { task } = await this.access.load(m, ref, { write: true });
    const c = await this.findChecklist(task.id, checklistId);
    await this.prisma.$transaction(async (tx) => {
      await tx.checklist.delete({ where: { id: checklistId } });
      await this.activity.record(tx, task.id, m.userId, [{ type: 'checklist_removed', from: c.title }]);
    });
  }

  async addItem(m: Membership, ref: string, checklistId: string, text: string): Promise<ChecklistDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    await this.findChecklist(task.id, checklistId);
    const last = await this.prisma.checklistItem.aggregate({ where: { checklistId }, _max: { position: true } });
    await this.prisma.checklistItem.create({
      data: { checklistId, text: text.trim(), position: (last._max.position ?? -1) + 1 },
    });
    return this.toDto(await this.findChecklist(task.id, checklistId));
  }

  async updateItem(m: Membership, ref: string, checklistId: string, itemId: string, dto: UpdateChecklistItemDto): Promise<ChecklistDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    await this.findChecklist(task.id, checklistId);
    const res = await this.prisma.checklistItem.updateMany({
      where: { id: itemId, checklistId },
      data: { ...(dto.text !== undefined && { text: dto.text.trim() }), ...(dto.done !== undefined && { done: dto.done }) },
    });
    if (res.count === 0) throw new NotFoundException('Checklist item not found');
    return this.toDto(await this.findChecklist(task.id, checklistId));
  }

  async removeItem(m: Membership, ref: string, checklistId: string, itemId: string): Promise<ChecklistDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    await this.findChecklist(task.id, checklistId);
    const res = await this.prisma.checklistItem.deleteMany({ where: { id: itemId, checklistId } });
    if (res.count === 0) throw new NotFoundException('Checklist item not found');
    return this.toDto(await this.findChecklist(task.id, checklistId));
  }
}
