import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [AuthModule, WorkspacesModule, ChannelsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
