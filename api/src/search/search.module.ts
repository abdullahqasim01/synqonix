import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({ imports: [WorkspacesModule, ChannelsModule], controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
