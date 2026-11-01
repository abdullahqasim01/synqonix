/**
 * Domain events emitted by the tasks module. Notifications (phase 8), automations and
 * integrations subscribe to these instead of being called from the services.
 */
export const TaskEvents = {
  created: 'task.created',
  updated: 'task.updated',
  statusChanged: 'task.status_changed',
  assigned: 'task.assigned',
  commented: 'task.commented',
  mentioned: 'task.mentioned',
  /** Position (and possibly status) changed by dragging a card. */
  ranked: 'task.ranked',
  deleted: 'task.deleted',
  /** Moved to another project; `fromProjectId` is where it used to live. */
  moved: 'task.moved',
} as const;

export interface TaskEventBase {
  workspaceId: string;
  projectId: string;
  taskId: string;
  taskKey: string;
  /** User who caused the event. */
  actorId: string;
}

export interface TaskAssignedEvent extends TaskEventBase {
  assigneeIds: string[];
}

export interface TaskStatusChangedEvent extends TaskEventBase {
  from: string;
  to: string;
}

export interface TaskCommentedEvent extends TaskEventBase {
  commentId: string;
}

export interface TaskMentionedEvent extends TaskEventBase {
  mentionedUserIds: string[];
  /** Where the mention happened. */
  source: 'comment' | 'description';
  commentId?: string;
}

export interface TaskRankedEvent extends TaskEventBase {
  statusId: string;
}

export interface TaskMovedEvent extends TaskEventBase {
  fromProjectId: string;
}

export type TaskEvent =
  | { name: typeof TaskEvents.created; payload: TaskEventBase }
  | { name: typeof TaskEvents.updated; payload: TaskEventBase & { fields: string[]; sprintIds?: string[] } }
  | { name: typeof TaskEvents.statusChanged; payload: TaskStatusChangedEvent }
  | { name: typeof TaskEvents.assigned; payload: TaskAssignedEvent }
  | { name: typeof TaskEvents.commented; payload: TaskCommentedEvent }
  | { name: typeof TaskEvents.mentioned; payload: TaskMentionedEvent }
  | { name: typeof TaskEvents.ranked; payload: TaskRankedEvent }
  | { name: typeof TaskEvents.deleted; payload: TaskEventBase & { sprintIds?: string[] } }
  | { name: typeof TaskEvents.moved; payload: TaskMovedEvent };
