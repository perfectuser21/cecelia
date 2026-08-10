import { describe, expect, it } from 'vitest';
import { filterTasksByView } from '@features/core/gtd/pages/task-view-filter';

const tasks = [
  { id: 'ready-1', title: 'Brain 自动任务', status: 'queued', queue_lane: 'ready', claimed_by: null },
  { id: 'ide-1', title: 'IDE 会话任务', status: 'queued', queue_lane: 'ide', claimed_by: null },
  { id: 'pipeline-1', title: '内容流水线任务', status: 'queued', queue_lane: 'pipeline', claimed_by: null },
];

describe('Workbench Task queue lanes', () => {
  it('separates Brain, IDE and Pipeline queues instead of mixing them as Waiting', () => {
    expect(filterTasksByView).toBeTypeOf('function');
    expect(filterTasksByView(tasks, 'ready').map(task => task.id)).toEqual(['ready-1']);
    expect(filterTasksByView(tasks, 'ide').map(task => task.id)).toEqual(['ide-1']);
    expect(filterTasksByView(tasks, 'pipeline').map(task => task.id)).toEqual(['pipeline-1']);
  });
});
