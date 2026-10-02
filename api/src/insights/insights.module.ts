import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({ imports: [WorkspacesModule], controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
