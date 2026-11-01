export const SprintEvents = {
  started: 'sprint.started',
  completed: 'sprint.completed',
} as const;

export interface SprintEvent {
  workspaceId: string;
  projectId: string;
  sprintId: string;
  sprintName: string;
  actorId: string;
}
