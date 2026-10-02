import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { TimeController } from './time.controller.js';
import { TimeService } from './time.service.js';

@Module({ imports: [WorkspacesModule, TasksModule], controllers: [TimeController], providers: [TimeService], exports: [TimeService] })
export class TimeModule {}
