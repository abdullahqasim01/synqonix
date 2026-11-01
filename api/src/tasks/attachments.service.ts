import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService } from './activity.service.js';
import type { AttachmentDto } from './dto/task.dto.js';
import { SignedTokens } from '../storage/signed-token.js';
import { DownloadUrlDto, RequestUploadDto, UploadTargetDto } from '../storage/storage.dto.js';
import { StorageService } from '../storage/storage.service.js';
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
    private readonly tokens: SignedTokens,
  ) {}

  private toDto(a: { id: string; filename: string; mimeType: string; size: number; uploaderId: string | null; createdAt: Date }): AttachmentDto {
    return { id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, uploaderId: a.uploaderId, createdAt: a.createdAt };
  }

  /** Step 1: check permissions and limits, and hand out a presigned link for the file. */
  async requestUpload(m: Membership, ref: string, dto: RequestUploadDto): Promise<UploadTargetDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    const maxMb = this.config.get('MAX_UPLOAD_MB');
    if (dto.size > maxMb * 1024 * 1024) throw new PayloadTooLargeException(`Files can be at most ${maxMb} MB`);
    const filename = safeFilename(dto.filename);
    const key = `${m.workspaceId}/${task.id}/${randomUUID()}`;
    const target = await this.storage.presignUpload(key, dto.size);
    const mimeType = dto.mimeType?.trim() || 'application/octet-stream';
    const uploadToken = this.tokens.sign({ kind: 'task', key, filename, mimeType, size: dto.size, task: task.id, user: m.userId }, 15 * 60);
    return { uploadUrl: target.url, method: target.method, headers: target.headers, expiresAt: target.expiresAt, uploadToken };
  }

  /** Step 2: after the browser's PUT succeeded, verify the object really is there and record it. */
  async confirmUpload(m: Membership, ref: string, uploadToken: string): Promise<AttachmentDto> {
    const { task } = await this.access.load(m, ref, { write: true });
    const c = this.tokens.verify<{ kind: string; key: string; filename: string; mimeType: string; size: number; task: string; user: string }>(uploadToken);
    if (c.kind !== 'task' || c.task !== task.id || c.user !== m.userId) throw new BadRequestException('This upload does not belong to this task');
    const existing = await this.prisma.attachment.findFirst({ where: { storageKey: c.key } });
    if (existing) return this.toDto(existing);
    const stored = await this.storage.head(c.key);
    if (!stored) throw new BadRequestException('The file was not uploaded');
    if (stored.size !== c.size) {
      await this.storage.delete(c.key).catch(() => undefined);
      throw new BadRequestException('The uploaded file does not match the size that was announced');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const a = await tx.attachment.create({
        data: { taskId: task.id, uploaderId: m.userId, filename: c.filename, storageKey: c.key, mimeType: c.mimeType, size: c.size },
      });
      await this.activity.record(tx, task.id, m.userId, [{ type: 'attachment_added', to: c.filename }]);
      return a;
    });
    return this.toDto(row);
  }

  async downloadUrl(m: Membership, ref: string, attachmentId: string): Promise<DownloadUrlDto> {
    const { task } = await this.access.load(m, ref);
    const a = await this.prisma.attachment.findFirst({ where: { id: attachmentId, taskId: task.id } });
    if (!a) throw new NotFoundException('Attachment not found');
    return this.storage.presignDownload(a.storageKey, a.filename);
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
