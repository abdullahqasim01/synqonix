import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { ViewsController } from './views.controller.js';
import { ViewsService } from './views.service.js';

@Module({
  imports: [WorkspacesModule],
  controllers: [ViewsController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}
