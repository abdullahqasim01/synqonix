import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { ChannelAccessService } from './channel-access.service.js';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [WorkspacesModule, TasksModule],
  controllers: [ChannelsController, MessagesController],
  providers: [ChannelsService, ChannelAccessService, MessagesService],
  exports: [ChannelsService, ChannelAccessService],
})
export class ChannelsModule {}
