import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { AgileController } from './agile.controller.js';
import { ReleasesService } from './releases.service.js';
import { ReportsService } from './reports.service.js';
import { SprintTracker } from './sprint-tracker.service.js';
import { SprintsService } from './sprints.service.js';

@Module({
  imports: [WorkspacesModule, TasksModule],
  controllers: [AgileController],
  providers: [SprintsService, SprintTracker, ReportsService, ReleasesService],
  exports: [SprintTracker],
})
export class AgileModule {}
