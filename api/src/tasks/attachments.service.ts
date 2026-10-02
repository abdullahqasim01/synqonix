import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import type { Env } from '../config/env.js';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService } from './activity.service.js';
import type { AttachmentDto } from './dto/task.dto.js';
import { StorageService } from './storage/storage.service.js';
import { TaskAccessService } from './task-access.service.js';

/** Strips paths and control characters from a user-supplied file name. */
export function safeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|?*:]/g, '').trim().slice(0, 200);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file';
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private toDto(a: { id: string; filename: string; mimeType: string; size: number; uploaderId: string | null; createdAt: Date }): AttachmentDto {
    return { id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, uploaderId: a.uploaderId, createdAt: a.createdAt };
  }

  async upload(m: Membership, ref: string, file: Express.Multer.File | undefined): Promise<AttachmentDto> {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    const { task } = await this.access.load(m, ref, { write: true });
    const maxMb = this.config.get('MAX_UPLOAD_MB');
    if (file.size > maxMb * 1024 * 1024) throw new PayloadTooLargeException(`Files can be at most ${maxMb} MB`);
    const filename = safeFilename(file.originalname);
    const storageKey = `${m.workspaceId}/${task.id}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const a = await tx.attachment.create({
          data: {
            taskId: task.id, uploaderId: m.userId, filename, storageKey,
            mimeType: file.mimetype || 'application/octet-stream', size: file.size,
          },
        });
        await this.activity.record(tx, task.id, m.userId, [{ type: 'attachment_added', to: filename }]);
        return a;
      });
      return this.toDto(row);
    } catch (e) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw e;
    }
  }

  async download(m: Membership, ref: string, attachmentId: string): Promise<{ stream: Readable; filename: string; size: number }> {
    const { task } = await this.access.load(m, ref);
    const a = await this.prisma.attachment.findFirst({ where: { id: attachmentId, taskId: task.id } });
    if (!a) throw new NotFoundException('Attachment not found');
    return { stream: await this.storage.read(a.storageKey), filename: a.filename, size: a.size };
  }

  async remove(m: Membership, ref: string, attachmentId: string) {
    const { task, manage } = await this.access.load(m, ref, { write: true });
    const a = await this.prisma.attachment.findFirst({ where: { id: attachmentId, taskId: task.id } });
    if (!a) throw new NotFoundException('Attachment not found');
    if (a.uploaderId !== m.userId && !manage) throw new ForbiddenException('Only the uploader or a project admin can delete this file');
    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: a.id } });
      await this.activity.record(tx, task.id, m.userId, [{ type: 'attachment_removed', from: a.filename }]);
    });
    await this.storage.delete(a.storageKey).catch(() => undefined);
  }
}
