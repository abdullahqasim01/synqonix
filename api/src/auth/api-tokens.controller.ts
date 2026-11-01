import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequiresSession } from '../common/decorators.js';
import type { AuthUser } from '../common/decorators.js';
import { ApiTokensService } from './api-tokens.service.js';
import { ApiTokenDto, CreateApiTokenDto, CreatedApiTokenDto } from './dto/api-token.dto.js';

@ApiTags('api-tokens')
@ApiBearerAuth()
@RequiresSession()
@Controller('api-tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  @ApiOkResponse({ type: [ApiTokenDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.tokens.list(user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: CreatedApiTokenDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiTokenDto) {
    return this.tokens.create(user.id, dto.name, dto.expiresAt);
  }

  @Delete(':id') @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tokens.revoke(user.id, id);
  }
}
