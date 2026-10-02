import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { WebhookListeners } from './webhook-listeners.js';
import { HttpWebhookSender, WebhookSender } from './webhook-sender.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  imports: [WorkspacesModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookListeners, { provide: WebhookSender, useClass: HttpWebhookSender }],
})
export class WebhooksModule {}
