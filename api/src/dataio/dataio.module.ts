import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { DataIoController } from './dataio.controller.js';
import { ExportService } from './export.service.js';
import { ImportService } from './import.service.js';

@Module({ imports: [WorkspacesModule, TasksModule], controllers: [DataIoController], providers: [ExportService, ImportService] })
export class DataIoModule {}
