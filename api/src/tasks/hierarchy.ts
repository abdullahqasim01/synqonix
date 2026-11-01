import type { TaskType } from '../generated/prisma/enums.js';

/** Epic -> (story | task | bug) -> subtask. */
export function validParentTypes(child: TaskType): TaskType[] | null {
  switch (child) {
    case 'EPIC': return null; // top level only
    case 'SUBTASK': return ['STORY', 'TASK', 'BUG'];
    default: return ['EPIC']; // story/task/bug may optionally sit under an epic
  }
}

/** Returns a human-readable problem with placing `type` under `parentType`, or null if fine. */
export function hierarchyError(type: TaskType, parentType: TaskType | null): string | null {
  const allowed = validParentTypes(type);
  if (parentType === null) {
    return type === 'SUBTASK' ? 'A sub-task needs a parent task' : null;
  }
  if (allowed === null) return 'An epic cannot have a parent';
  if (!allowed.includes(parentType)) {
    return type === 'SUBTASK'
      ? 'A sub-task must belong to a story, task or bug'
      : 'Only an epic can be the parent of a story, task or bug';
  }
  return null;
}
