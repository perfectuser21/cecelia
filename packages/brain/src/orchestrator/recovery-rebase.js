import { lockMapProjectionAuthority, readMap } from '../lib/map-read-service.js';
import { parseBaseRepo } from './github-pr-discovery.js';
import { isCanonicalTaskBranch, WORKSPACE_REPOSITORIES } from './workspace-spec.js';
import { freezeRecoveryExecutionProfile, profileValueKey, validRecoveryExecutionTarget } from './recovery-execution-profile.js';

const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9-]{36}$/;
const REQUEST_FIELDS = ['expected_receipt_id', 'base_sha', 'head_sha', 'actor', 'reason', 'sprint_dir',
  'execution_target','expected_profile_hash'];

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

export function validateRecoveryRebase(input) {
  if (input.recoveryRebase == null) return;
  const r = input.recoveryRebase;
  if (input.createdSource !== 'explicit_recovery' || input.phase !== 'planning'
      || !r || typeof r !== 'object' || Array.isArray(r)
      || Object.keys(r).some(key => !REQUEST_FIELDS.includes(key))
      || !UUID.test(r.expected_receipt_id ?? '') || !SHA.test(r.base_sha ?? '')
      || !SHA.test(r.head_sha ?? '') || typeof r.actor !== 'string' || !r.actor.trim()
      || r.actor.length > 200 || typeof r.reason !== 'string' || !r.reason.trim()
      || r.reason.length > 2000 || typeof r.sprint_dir !== 'string'
      || !/^sprints(?:\/[A-Za-z0-9._-]+)*$/.test(r.sprint_dir)
      || r.sprint_dir.split('/').some(p => p === '.' || p === '..')) {
    fail('recovery_rebase_request_invalid', 400);
  }
  if (!validRecoveryExecutionTarget(r)) fail('recovery_rebase_request_invalid', 400);
}

export function matchesRecoveryRebase(stored, request, predecessorRunId) {
  return stored?.predecessor_run_id === predecessorRunId
    && REQUEST_FIELDS.every(field => profileValueKey(stored?.[field]) === profileValueKey(request[field]));
}

// 调用方已锁任务/前任；仅在 createKernelRun 的事务内执行。旧收据和旧run从不更新。
export async function rebaseReceiptForRecovery(client, { task, receipt, predecessor, request }, deps = {}) {
  if (task.status !== 'failed' || predecessor.phase !== 'failed') {
    fail('recovery_rebase_predecessor_not_failed');
  }
  if (receipt.id !== request.expected_receipt_id || receipt.superseded
      || receipt.task_id !== task.id || task.payload.routing_receipt_id !== receipt.id) {
    fail('recovery_rebase_receipt_changed');
  }
  const branch = receipt.evidence?.branch;
  const repo = parseBaseRepo(receipt.repo);
  if (!WORKSPACE_REPOSITORIES.includes(repo) || !isCanonicalTaskBranch(branch)
      || task.payload.branch !== branch || task.payload.base_sha !== receipt.evidence?.base_sha
      || !SHA.test(receipt.evidence?.base_sha ?? '') || task.payload.map_recovery === true) {
    fail('recovery_rebase_route_invalid');
  }
  const latest = await client.query(
    `SELECT id FROM initiative_runs WHERE current_task_id=$1 AND orchestrator_version='v2'
      ORDER BY started_at DESC,id DESC LIMIT 1`, [task.id],
  );
  if (latest.rows[0]?.id !== predecessor.id) fail('recovery_rebase_predecessor_changed');
  const attempts = await client.query(
    `SELECT attempt.id FROM harness_attempts attempt JOIN initiative_runs run ON run.id=attempt.run_id
      WHERE run.current_task_id=$1 AND attempt.status IN ('queued','starting','running')
      FOR UPDATE OF attempt`, [task.id],
  );
  if (attempts.rows.length) fail('recovery_rebase_active_attempt');
  const mapping = deps.resolveScopeKey ? null : await client.query(
    'SELECT scope_key FROM map_scope_repositories WHERE repo=$1 FOR SHARE', [receipt.repo],
  );
  const scopeKey = deps.resolveScopeKey ? await deps.resolveScopeKey(client, receipt.repo) : mapping.rows[0]?.scope_key;
  if (!scopeKey || (mapping && mapping.rows.length !== 1)) fail('recovery_rebase_scope_invalid');
  const now = deps.now ?? new Date();
  const authority = await (deps.lockMapProjectionAuthority ?? lockMapProjectionAuthority)(client, { scopeKey });
  const map = await (deps.readMap ?? readMap)(client, { scopeKey, authority, now });
  const fresh = map?.freshness?.repos?.[receipt.repo];
  if (map?.freshness?.status !== 'fresh' || fresh?.status !== 'fresh'
      || fresh.source_revision !== request.base_sha) fail('recovery_rebase_map_changed');
  const remote = !deps.resolveBranchHead || !deps.resolveCommitDiff
    ? await import('./remote-exact-commit-blob-resolver.js') : null;
  const branchHead = await (deps.resolveBranchHead ?? remote.defaultExactBranchHeadResolver)({ repo, branch });
  if (branchHead !== request.head_sha) fail('recovery_rebase_head_changed');
  const diff = await (deps.resolveCommitDiff ?? remote.defaultExactCommitDiffResolver)(
    { repo, baseSha: request.base_sha, headSha: request.head_sha },
  );
  if (diff?.isAncestor !== true || !Array.isArray(diff.changedFiles)) fail('recovery_rebase_lineage_invalid');
  const execution = await freezeRecoveryExecutionProfile(client, { task, request, repo });
  const evidence = { ...receipt.evidence, base_sha: request.base_sha,
    prev_base_sha: receipt.evidence.base_sha, resigned_at: now.toISOString(),
    reanchor_reason: 'explicit_unsealed_recovery', recovery_rebase: {
      predecessor_run_id: predecessor.id, head_sha: request.head_sha, branch, repo,
      actor: request.actor, reason: request.reason, sprint_dir: request.sprint_dir,
      map_projection_run_id: map.projection_run_id,
      ...(execution.evidence ? { execution_profile: execution.evidence } : {}),
    } };
  const generation = Number(receipt.anchor_generation ?? 1);
  if (!Number.isSafeInteger(generation) || generation < 1) fail('recovery_rebase_generation_invalid');
  const inserted = await client.query(
    `INSERT INTO work_routing_receipts (
       task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,
       default_execution_profile,execution_profile_override,repo,map_scope,
       impact_contract_required,orchestrator,router_version,route_reason,evidence,
       map_scope_validation_version,direct_contract_seed,supersedes_receipt_id,anchor_generation,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20,now())
     RETURNING *`,
    [task.id, receipt.source, receipt.source_id, receipt.work_kind, receipt.change_kind,
      receipt.pipeline, receipt.canonical_task_type, receipt.default_execution_profile,
      receipt.execution_profile_override ?? null, receipt.repo, JSON.stringify(receipt.map_scope),
      receipt.impact_contract_required, receipt.orchestrator, receipt.router_version, receipt.route_reason,
      JSON.stringify(evidence), receipt.map_scope_validation_version,
      receipt.direct_contract_seed == null ? null : JSON.stringify(receipt.direct_contract_seed), receipt.id, generation + 1],
  );
  const successor = { ...receipt, ...inserted.rows[0], evidence, anchor_generation: generation + 1, superseded: false };
  const recovery = { ...request, predecessor_run_id: predecessor.id };
  const payload = { ...execution.payload, routing_receipt_id: successor.id, base_sha: request.base_sha,
    sprint_dir: request.sprint_dir, recovery_rebase: recovery };
  await client.query(
    `UPDATE tasks SET payload=COALESCE(payload,'{}'::jsonb)||$2::jsonb,updated_at=NOW() WHERE id=$1`,
    [task.id, JSON.stringify(payload)],
  );
  const event = { task_id: task.id, old_receipt_id: receipt.id, new_receipt_id: successor.id,
    old_base_sha: receipt.evidence.base_sha, new_base_sha: request.base_sha,
    anchor_generation: generation + 1, ...recovery,
    ...(execution.evidence ? { execution_profile: execution.evidence } : {}) };
  await client.query(
    `INSERT INTO cecelia_events (event_type,source,task_id,payload)
     VALUES ('kernel_unsealed_recovery_rebased','kernel_orchestrator',$1,$2::jsonb)`, [task.id, JSON.stringify(event)],
  );
  await client.query(
    `INSERT INTO task_events (task_id,event_type,payload,created_at)
     VALUES ($1,'kernel_unsealed_recovery_rebased',$2::jsonb,NOW())`, [task.id, JSON.stringify(event)],
  );
  task.payload = { ...task.payload, ...payload };
  return successor;
}
