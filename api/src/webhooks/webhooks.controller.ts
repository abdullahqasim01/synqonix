import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Membership } from '../generated/prisma/client.js';
import { CurrentMembership, RequirePermission, WorkspaceGuard } from '../permissions/workspace.guard.js';
import { CreatedWebhookDto, CreateWebhookDto, DeliveryDto, TestResultDto, UpdateWebhookDto, WebhookDto } from './dto/webhooks.dto.js';
import { WebhooksService } from './webhooks.service.js';

/** Workspace admins only: webhooks see every project's events. */
@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(WorkspaceGuard)
@ApiParam({ name: 'workspaceId', type: String })
@Controller('workspaces/:workspaceId/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get() @RequirePermission('workspace.update')
  @ApiOkResponse({ type: [WebhookDto] })
  list(@CurrentMembership() m: Membership) {
    return this.webhooks.list(m);
  }

  @Post() @RequirePermission('workspace.update')
  @ApiCreatedResponse({ type: CreatedWebhookDto })
  create(@CurrentMembership() m: Membership, @Body() dto: CreateWebhookDto) {
    return this.webhooks.create(m, dto);
  }

  @Patch(':webhookId') @RequirePermission('workspace.update')
  @ApiParam({ name: 'webhookId', type: String })
  @ApiOkResponse({ type: WebhookDto })
  update(@CurrentMembership() m: Membership, @Param('webhookId') id: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooks.update(m, id, dto);
  }

  @Delete(':webhookId') @HttpCode(204) @RequirePermission('workspace.update')
  @ApiParam({ name: 'webhookId', type: String })
  remove(@CurrentMembership() m: Membership, @Param('webhookId') id: string) {
    return this.webhooks.remove(m, id);
  }

  @Post(':webhookId/rotate-secret') @HttpCode(200) @RequirePermission('workspace.update')
  @ApiParam({ name: 'webhookId', type: String })
  @ApiOkResponse({ type: CreatedWebhookDto })
  rotate(@CurrentMembership() m: Membership, @Param('webhookId') id: string) {
    return this.webhooks.rotateSecret(m, id);
  }

  @Post(':webhookId/test') @HttpCode(200) @RequirePermission('workspace.update')
  @ApiParam({ name: 'webhookId', type: String })
  @ApiOkResponse({ type: TestResultDto })
  test(@CurrentMembership() m: Membership, @Param('webhookId') id: string) {
    return this.webhooks.test(m, id);
  }

  @Get(':webhookId/deliveries') @RequirePermission('workspace.update')
  @ApiParam({ name: 'webhookId', type: String })
  @ApiOkResponse({ type: [DeliveryDto] })
  deliveries(@CurrentMembership() m: Membership, @Param('webhookId') id: string) {
    return this.webhooks.deliveries(m, id);
  }

  @Post(':webhookId/deliveries/:deliveryId/redeliver') @HttpCode(204) @RequirePermission('workspace.update')
  @ApiParam({ name: 'webhookId', type: String })
  @ApiParam({ name: 'deliveryId', type: String })
  redeliver(@CurrentMembership() m: Membership, @Param('webhookId') id: string, @Param('deliveryId') did: string) {
    return this.webhooks.redeliver(m, id, did);
  }
}
