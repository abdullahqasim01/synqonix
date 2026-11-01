import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { GithubClient, HttpGithubClient } from './github.client.js';
import { GithubController, GithubProjectController, GithubPublicController, GithubTaskController } from './github.controller.js';
import { GithubWebhookService } from './github-webhook.service.js';
import { GithubService } from './github.service.js';

@Module({
  imports: [WorkspacesModule, TasksModule],
  controllers: [GithubController, GithubProjectController, GithubTaskController, GithubPublicController],
  providers: [GithubService, GithubWebhookService, { provide: GithubClient, useClass: HttpGithubClient }],
})
export class GithubModule {}
