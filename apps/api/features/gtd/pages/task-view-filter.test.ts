import { describe, expect, it } from 'vitest';
import { filterTasksByView } from './task-view-filter';

describe('filterTasksByView', () => {
  it('separates queued tasks into Brain, IDE and Pipeline lanes', () => {
    const tasks = [
      { id: 'ready-1', status: 'queued', queue_lane: 'ready', claimed_by: null },
      { id: 'ide-1', status: 'queued', queue_lane: 'ide', claimed_by: null },
      { id: 'pipeline-1', status: 'queued', queue_lane: 'pipeline', claimed_by: null },
    ];

    expect(filterTasksByView(tasks, 'ready').map(task => task.id)).toEqual(['ready-1']);
    expect(filterTasksByView(tasks, 'ide').map(task => task.id)).toEqual(['ide-1']);
    expect(filterTasksByView(tasks, 'pipeline').map(task => task.id)).toEqual(['pipeline-1']);
  });
});
