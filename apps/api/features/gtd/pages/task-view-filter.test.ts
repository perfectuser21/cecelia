import { describe, expect, it } from 'vitest';
import { filterTasksByView } from './task-view-filter';

describe('filterTasksByView', () => {
  it('按Brain与IDE区分待执行任务', () => {
    const tasks = [
      { id: 'ready-1', status: 'queued', queue_lane: 'ready', claimed_by: null },
      { id: 'ide-1', status: 'queued', queue_lane: 'ide', claimed_by: null },
    ];

    expect(filterTasksByView(tasks, 'ready').map(task => task.id)).toEqual(['ready-1']);
    expect(filterTasksByView(tasks, 'ide').map(task => task.id)).toEqual(['ide-1']);
  });
});
