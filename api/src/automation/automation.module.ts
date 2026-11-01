import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { AutomationController } from './automation.controller.js';
import { AutomationService } from './automation.service.js';

@Module({ imports: [WorkspacesModule, TasksModule], controllers: [AutomationController], providers: [AutomationService] })
export class AutomationModule {}
