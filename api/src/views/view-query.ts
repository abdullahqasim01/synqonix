import type { ListTasksQueryDto } from '../tasks/dto/task.dto.js';
import type { ViewQueryDto } from './dto/view.dto.js';

/**
 * Turns a saved view into task-list parameters. Anything the caller passes explicitly wins,
 * so `?view=ID&assignee=me` narrows the saved view instead of being ignored.
 */
export function mergeViewQuery(
  view: { projectId: string | null; query: ViewQueryDto },
  explicit: ListTasksQueryDto,
): ListTasksQueryDto {
  const { filters, sort, order } = view.query;
  const merged: Record<string, unknown> = {
    ...filters,
    ...(sort ? { sort } : {}),
    ...(order ? { order } : {}),
    ...(view.projectId ? { projectId: view.projectId } : {}),
  };
  for (const [key, value] of Object.entries(explicit)) {
    if (key !== 'view' && value !== undefined) merged[key] = value;
  }
  return merged as ListTasksQueryDto;
}
