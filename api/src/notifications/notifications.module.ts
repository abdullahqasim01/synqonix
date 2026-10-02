import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { NotificationListeners } from './notification-listeners.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { RemindersService } from './reminders.service.js';

@Module({
  imports: [WorkspacesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationListeners, RemindersService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
