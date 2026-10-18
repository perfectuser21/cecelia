/** 同类失败积累触发只读诊断，不因一次运行失败现场改代码。 */
import { digest } from './commander-v2-contract.js';
import { ensureCommanderImprovement, improvementKey } from './commander-improvement.js';
import { event } from './commander-v2-store.js';
export async function recordCommanderFailure(db, task, control, reason, deps={}) {
  const e = control.envelope;
  const failedAssertions = (control.verification?.assertions ?? []).filter(a => a.pass !== true).map(a => a.name).sort();
  const error_fingerprint = digest({ workflow_key: e.workflow_key, reason, failed_assertions: failedAssertions,
    execution_code: control.delivery?.failure?.code ?? null });
  const implementation_version = { release_id: e.definition.release_id, definition_sha256: e.definition.snapshot_sha256,
    runtime_snapshot_sha256: e.definition.runtime_snapshot_sha256 };
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,717))',[improvementKey(e,error_fingerprint)]);
  const prior = (await db.query(`SELECT payload FROM task_events WHERE event_type='commander_failure'
    AND payload->>'run_id'=$1 LIMIT 1`, [e.run_id])).rows[0];
  if (!prior) await event(db, task.id, 'commander_failure', { run_id: e.run_id, workflow_key: e.workflow_key,
    error_fingerprint, implementation_version, reason, actor: 'workflow-commander-v2', evidence: control.verification?.evidence ?? [] });
  const count = Number((await db.query(`SELECT count(DISTINCT payload->>'run_id') AS n FROM task_events WHERE event_type='commander_failure'
    AND payload->>'error_fingerprint'=$1 AND payload->'implementation_version'->>'runtime_snapshot_sha256'=$2`,
  [error_fingerprint, implementation_version.runtime_snapshot_sha256])).rows[0]?.n ?? 0);
  const threshold = e.recovery.improvement_after_failures;
  const improvement=Number.isInteger(threshold)&&threshold>0&&count>=threshold
    ?await ensureCommanderImprovement(db,task,control,{reason,error_fingerprint},deps):undefined;
  return { reason, error_fingerprint, implementation_version, occurrences: count, ...(improvement?{improvement}:{}),
    evidence_query: { event_type: 'commander_failure', error_fingerprint },
    ...(Number.isInteger(threshold) && threshold > 0 && count >= threshold ? { improvement_suggestion: {
      kind: 'decision', action: 'evaluate_implementation_change', threshold, reason: '同版本同类失败达到合同阈值；只读诊断后决定是否创建一次开发修补，不修改在途实现' } } : {}) };
}
