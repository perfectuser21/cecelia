export function queueLaneSql(table = 'tasks') {
  const column = (name) => `${table}.${name}`;
  return `CASE
    WHEN ${column('status')} NOT IN ('queued','pending') OR ${column('claimed_by')} IS NOT NULL THEN NULL
    WHEN COALESCE(${column("payload->>'headed_manual'")}, 'false') = 'true' THEN 'ide'
    ELSE 'ready'
  END`;
}
