export type TaskView = 'all' | 'ready' | 'ide' | 'pipeline' | 'in_progress' | 'blocked' | 'done' | 'dropped';

export function filterTasksByView<T extends {
  status: string;
  claimed_by: string | null;
  queue_lane?: string | null;
}>(tasks: T[], view: TaskView): T[] {
  return tasks.filter(task => {
    if (view === 'ready' || view === 'ide' || view === 'pipeline') return task.queue_lane === view;
    if (view === 'in_progress') return task.status === 'in_progress' && Boolean(task.claimed_by);
    if (view === 'blocked') return ['blocked', 'paused', 'failed', 'quarantined'].includes(task.status);
    if (view === 'done') return task.status === 'completed';
    if (view === 'dropped') return task.status === 'cancelled';
    return true;
  });
}
