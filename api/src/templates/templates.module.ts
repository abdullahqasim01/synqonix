import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { RecurringService } from './recurring.service.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

@Module({ imports: [WorkspacesModule, TasksModule], controllers: [TemplatesController], providers: [TemplatesService, RecurringService], exports: [RecurringService] })
export class TemplatesModule {}
