const INDEPENDENT_KINDS = new Set([
  'headed-session', 'coding-workflow-runner', 'external-worker', 'openclaw-agent', 'script',
]);
const LOCAL_KINDS = new Set(['brain-local', 'codex-review-local']);

export function collectBrainDrainScope(tasks, processes, launches) {
  const blockers = new Map();
  const put = (key, value) => { if (!blockers.has(key)) blockers.set(key, value); };
  for (const process of processes) {
    const taskId = process.taskId;
    const shared = process.source === 'shared-activity-runner';
    put(taskId ?? Symbol(), {
      kind: shared ? 'shared_controller' : 'local_execution',
      ...(taskId ? { task_id: taskId } : {}),
      ...(process.runId ? { run_id: process.runId } : {}),
      reason: shared ? 'brain_owned_controller' : 'executor_registry_entry',
    });
  }
  for (const launch of launches) put(launch.taskId ?? Symbol(), {
    kind: 'launch', ...(launch.taskId ? { task_id: launch.taskId } : {}), reason: 'launch_in_flight',
  });
  let independent = 0;
  for (const task of tasks) {
    if (blockers.has(task.id)) continue;
    const invocation = task.payload?.invocation;
    if (invocation) {
      put(task.id, { kind: 'shared_controller', task_id: task.id,
        ...(invocation.dispatch?.run_id ? { run_id: invocation.dispatch.run_id } : {}),
        reason: 'invocation_completion_unconfirmed' });
    } else if (INDEPENDENT_KINDS.has(task.executor_kind)) {
      independent++;
    } else {
      put(task.id, { kind: LOCAL_KINDS.has(task.executor_kind) ? 'local_execution' : 'unknown',
        task_id: task.id, reason: task.executor_kind ? 'brain_ownership_not_settled' : 'execution_owner_unknown' });
    }
  }
  return { blockers: [...blockers.values()], independent_task_count: independent };
}
