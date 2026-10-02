import { Module } from '@nestjs/common';
import { InvitationsController } from '../invitations/invitations.controller.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import { ProjectsController } from '../projects/projects.controller.js';
import { ProjectsService } from '../projects/projects.service.js';
import { TeamsController } from '../teams/teams.controller.js';
import { TeamsService } from '../teams/teams.service.js';
import { WorkspaceGuard } from '../permissions/workspace.guard.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';

/** Workspaces and everything scoped to them: members, invitations, teams, projects. */
@Module({
  controllers: [WorkspacesController, InvitationsController, TeamsController, ProjectsController],
  providers: [WorkspacesService, InvitationsService, TeamsService, ProjectsService, WorkspaceGuard],
  exports: [WorkspaceGuard],
})
export class WorkspacesModule {}
