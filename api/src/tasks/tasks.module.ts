import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { AttachmentsService } from './attachments.service.js';
import { ChecklistsService } from './checklists.service.js';
import { CommentsService } from './comments.service.js';
import { CustomFieldsController } from './custom-fields.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { RecentTasksService } from './recent-tasks.service.js';
import { RelationsService } from './relations.service.js';
import { StorageService } from './storage/storage.service.js';
import { TaskAccessService } from './task-access.service.js';
import { TaskDetailsController } from './task-details.controller.js';
import { TaskMoveService } from './task-move.service.js';
import { TaskRankService } from './task-rank.service.js';
import { TaskSupportService } from './task-support.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { WatchersService } from './watchers.service.js';
import { ViewsModule } from '../views/views.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';

@Module({
  imports: [WorkspacesModule, ViewsModule],
  controllers: [TasksController, TaskDetailsController, CustomFieldsController],
  providers: [
    TasksService, TaskMoveService, TaskRankService, RecentTasksService, TaskAccessService, TaskSupportService, ActivityService, CommentsService,
    ChecklistsService, RelationsService, WatchersService, AttachmentsService, CustomFieldsService, StorageService,
  ],
  exports: [TasksService, TaskAccessService, ActivityService, StorageService],
})
export class TasksModule {}
