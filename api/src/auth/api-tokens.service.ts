import { Injectable, NotFoundException } from '@nestjs/common';
import { randomToken, sha256 } from '../common/crypto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiTokenDto, CreatedApiTokenDto } from './dto/api-token.dto.js';
import { API_TOKEN_PREFIX } from './jwt-auth.guard.js';

@Injectable()
export class ApiTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, name: string, expiresAt?: string): Promise<CreatedApiTokenDto> {
    const token = `${API_TOKEN_PREFIX}${randomToken(32)}`;
    const row = await this.prisma.apiToken.create({
      data: {
        userId,
        name: name.trim(),
        tokenHash: sha256(token),
        prefix: token.slice(0, 12),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
    return { ...this.toDto(row), token };
  }

  async list(userId: string): Promise<ApiTokenDto[]> {
    const rows = await this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async revoke(userId: string, id: string) {
    const res = await this.prisma.apiToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('Token not found');
  }

  private toDto(r: {
    id: string; name: string; prefix: string;
    lastUsedAt: Date | null; expiresAt: Date | null; createdAt: Date;
  }): ApiTokenDto {
    return {
      id: r.id, name: r.name, prefix: r.prefix,
      lastUsedAt: r.lastUsedAt, expiresAt: r.expiresAt, createdAt: r.createdAt,
    };
  }
}
