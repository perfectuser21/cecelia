import { PIPELINE_TASK_TYPES } from './lib/task-type-registry.js';

export { PIPELINE_TASK_TYPES };

/** Fixed internal aliases only; payload flags never confer execution ownership. */
export function phoneOrdinaryQueueSql(alias) {
  if (alias !== 't' && alias !== 'tasks') throw Error('phone_queue_sql_alias_invalid');
  return `${alias}.executor_kind IS DISTINCT FROM 'phone-ssh-controller'
    AND NOT EXISTS (SELECT 1 FROM phone_task_owners o WHERE o.task_id = ${alias}.id)`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function queueLaneSql(table = 'tasks') {
  const column = (name) => `${table}.${name}`;
  const pipelineTypes = PIPELINE_TASK_TYPES.map(sqlString).join(',');
  return `CASE
    WHEN ${column('status')} NOT IN ('queued','pending') OR ${column('claimed_by')} IS NOT NULL THEN NULL
    WHEN COALESCE(${column("payload->>'headed_manual'")}, 'false') = 'true' THEN 'ide'
    WHEN ${column('task_type')} IN (${pipelineTypes}) THEN 'pipeline'
    ELSE 'ready'
  END`;
}
