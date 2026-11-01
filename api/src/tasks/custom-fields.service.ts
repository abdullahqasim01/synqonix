import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectAccessService } from '../projects/project-access.service.js';
import type { CreateCustomFieldDto, CustomFieldDto, UpdateCustomFieldDto } from './dto/details.dto.js';

const isUnique = (e: unknown) => (e as { code?: string }).code === 'P2002';

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  private toDto(f: { id: string; name: string; type: CustomFieldDto['type']; options: unknown; position: number }): CustomFieldDto {
    return { id: f.id, name: f.name, type: f.type, options: Array.isArray(f.options) ? (f.options as string[]) : null, position: f.position };
  }

  async list(m: Membership, projectId: string): Promise<CustomFieldDto[]> {
    await this.projects.load(m, projectId);
    const rows = await this.prisma.customField.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  private cleanOptions(options: string[] | undefined) {
    const list = [...new Set((options ?? []).map((o) => o.trim()).filter(Boolean))];
    if (list.length === 0) throw new BadRequestException('A select field needs at least one option');
    return list;
  }

  async create(m: Membership, projectId: string, dto: CreateCustomFieldDto): Promise<CustomFieldDto> {
    await this.projects.load(m, projectId, { manage: true });
    if (dto.type !== 'SELECT' && dto.options?.length) throw new BadRequestException('Only select fields have options');
    const last = await this.prisma.customField.aggregate({ where: { projectId }, _max: { position: true } });
    try {
      const row = await this.prisma.customField.create({
        data: {
          projectId, name: dto.name.trim(), type: dto.type,
          options: dto.type === 'SELECT' ? this.cleanOptions(dto.options) : undefined,
          position: (last._max.position ?? -1) + 1,
        },
      });
      return this.toDto(row);
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A custom field with this name already exists');
      throw e;
    }
  }

  async update(m: Membership, projectId: string, fieldId: string, dto: UpdateCustomFieldDto): Promise<CustomFieldDto> {
    await this.projects.load(m, projectId, { manage: true });
    const field = await this.prisma.customField.findFirst({ where: { id: fieldId, projectId } });
    if (!field) throw new NotFoundException('Custom field not found');
    if (dto.options !== undefined && field.type !== 'SELECT') throw new BadRequestException('Only select fields have options');
    try {
      const row = await this.prisma.customField.update({
        where: { id: fieldId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.options !== undefined && { options: this.cleanOptions(dto.options) }),
        },
      });
      return this.toDto(row);
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('A custom field with this name already exists');
      throw e;
    }
  }

  async remove(m: Membership, projectId: string, fieldId: string) {
    await this.projects.load(m, projectId, { manage: true });
    const res = await this.prisma.customField.deleteMany({ where: { id: fieldId, projectId } });
    if (res.count === 0) throw new NotFoundException('Custom field not found');
  }
}
