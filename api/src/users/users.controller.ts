import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Patch, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import * as argon2 from 'argon2';
import { toUserDto } from '../auth/auth.service.js';
import { UserDto } from '../auth/dto/auth.dto.js';
import { CurrentUser, RequiresSession } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { DeleteAccountDto, UpdateProfileDto } from './dto/users.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOkResponse({ type: UserDto })
  async me(@CurrentUser() user: AuthUser) {
    return toUserDto(await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }));
  }

  @Patch('me')
  @ApiOkResponse({ type: UserDto })
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return toUserDto(
      await this.prisma.user.update({ where: { id: user.id }, data: { name: dto.name.trim() } }),
    );
  }

  @Delete('me') @HttpCode(204) @RequiresSession()
  async remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await argon2.verify(row.passwordHash, dto.password))) {
      throw new UnauthorizedException('Password is incorrect');
    }
    // Don't orphan workspaces: sole owners must hand over or delete them first.
    const owned = await this.prisma.membership.findMany({
      where: { userId: user.id, role: 'OWNER' },
      select: { workspaceId: true },
    });
    for (const { workspaceId } of owned) {
      const otherOwners = await this.prisma.membership.count({
        where: { workspaceId, role: 'OWNER', userId: { not: user.id } },
      });
      if (otherOwners === 0) {
        throw new BadRequestException('Transfer ownership of, or delete, your workspaces before deleting your account');
      }
    }
    await this.prisma.user.delete({ where: { id: user.id } });
  }
}
