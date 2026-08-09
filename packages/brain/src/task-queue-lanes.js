export const PIPELINE_TASK_TYPES = [
  'content-pipeline',
  'content-export',
  'content-research',
  'content-copywriting',
  'content-copy-review',
  'content-generate',
  'content-image-review',
  'harness_ci_watch',
  'harness_deploy_watch',
];

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
