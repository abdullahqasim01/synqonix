import { describe, expect, it } from 'vitest';
import { mergeViewQuery } from './view-query.js';

describe('mergeViewQuery', () => {
  const view = {
    projectId: 'p1',
    query: { filters: { priority: 'HIGH' as const, assignee: 'me', q: 'login' }, sort: 'dueDate' as const, order: 'asc' as const },
  };

  it('applies the stored filters, sort and project', () => {
    expect(mergeViewQuery(view, { view: 'v1' })).toEqual({
      priority: 'HIGH', assignee: 'me', q: 'login', sort: 'dueDate', order: 'asc', projectId: 'p1',
    });
  });

  it('lets explicit parameters override the view, but not undefined ones', () => {
    const merged = mergeViewQuery(view, { view: 'v1', assignee: 'none', q: undefined, limit: 10 });
    expect(merged).toMatchObject({ assignee: 'none', q: 'login', limit: 10, priority: 'HIGH' });
    expect(merged).not.toHaveProperty('view');
  });

  it('keeps the view pinned to its project', () => {
    expect(mergeViewQuery(view, { view: 'v1' }).projectId).toBe('p1');
    expect(mergeViewQuery({ projectId: null, query: {} }, { view: 'v1' })).toEqual({});
  });
});
