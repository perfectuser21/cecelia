// 派发时重锚定 base_sha（任务 d9c405e2 / 决策 49035988）。
// 路由收据 append-only（迁移 413），快进 = 插接班收据（supersedes_receipt_id + anchor_generation），
// 同事务同步 tasks.payload（421 触发器按最新收据比对 routing_receipt_id，必须先 INSERT 后 UPDATE）。
// 只在"分支尚无任何产出"时快进：kernel-v1 generator 不 push，候选留在跑场机本地，
// git 看不到，所以用 DB 事实 initiative_runs（harness_attempts.run_id 是其 NOT NULL FK）判定。
import { recordTaskEventSafe } from '../../lib/task-event-log.js';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const MAX_FASTFORWARD = 5;

function reanchorError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

export async function reanchorReceiptIfEmptyBranch(client, {
  task, receipt, map, now = new Date(), createdSource = null,
}) {
  const oldBaseSha = receipt?.evidence?.base_sha;
  const repoFreshness = map?.freshness?.repos?.[receipt?.repo];
  const targetSha = repoFreshness?.source_revision;
  if (!SHA_PATTERN.test(oldBaseSha ?? '') || repoFreshness?.status !== 'fresh' || !SHA_PATTERN.test(targetSha ?? '')) {
    return null;
  }
  if (targetSha === oldBaseSha) return null;
  if (receipt.work_kind !== 'coding_mutation') return null;
  if (task?.payload?.map_recovery === true) return null;
  if (createdSource === 'explicit_recovery') return null;

  const fastforwardCount = Number(task?.metadata?.base_sha_fastforward_count ?? 0);
  if (fastforwardCount >= MAX_FASTFORWARD) {
    throw reanchorError('map_thrash', {
      fastforward_count: fastforwardCount, old_base_sha: oldBaseSha, map_revision: targetSha,
    });
  }
  const rebaseDetail = {
    old_base_sha: oldBaseSha, new_base_sha: targetSha,
    branch: receipt.evidence?.branch ?? null, has_v2_run: receipt.has_v2_run === true,
  };
  if (receipt.has_v2_run === true) throw reanchorError('needs_rebase', rebaseDetail);
  const { rows: runRows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM initiative_runs any_run
        WHERE any_run.current_task_id = $1::uuid
           OR any_run.initiative_id = $1::uuid
     ) AS has_any_run`,
    [task.id],
  );
  if (runRows[0]?.has_any_run === true) throw reanchorError('needs_rebase', rebaseDetail);

  const nextGeneration = Number(receipt.anchor_generation ?? 1) + 1;
  const evidence = {
    ...(receipt.evidence ?? {}),
    base_sha: targetSha,
    prev_base_sha: oldBaseSha,
    resigned_at: now.toISOString(),
    reanchor_reason: 'map_revision_advanced',
  };
  const { rows: inserted } = await client.query(
    `INSERT INTO work_routing_receipts (
       task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,
       default_execution_profile,execution_profile_override,repo,map_scope,
       impact_contract_required,orchestrator,router_version,route_reason,evidence,
       map_scope_validation_version,direct_contract_seed,supersedes_receipt_id,anchor_generation,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20,now())
     RETURNING *`,
    [
      receipt.task_id, receipt.source, receipt.source_id, receipt.work_kind, receipt.change_kind,
      receipt.pipeline, receipt.canonical_task_type, receipt.default_execution_profile,
      receipt.execution_profile_override ?? null, receipt.repo, JSON.stringify(receipt.map_scope ?? []),
      receipt.impact_contract_required, receipt.orchestrator, receipt.router_version, receipt.route_reason,
      JSON.stringify(evidence), receipt.map_scope_validation_version ?? null,
      receipt.direct_contract_seed == null ? null : JSON.stringify(receipt.direct_contract_seed),
      receipt.id, nextGeneration,
    ],
  );
  const successor = inserted[0];
  await client.query(
    `UPDATE tasks
        SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      task.id,
      JSON.stringify({ routing_receipt_id: successor.id, base_sha: targetSha }),
      JSON.stringify({ base_sha_fastforward_count: fastforwardCount + 1 }),
    ],
  );
  const eventPayload = {
    task_id: task.id,
    old_receipt_id: receipt.id,
    new_receipt_id: successor.id,
    old_base_sha: oldBaseSha,
    new_base_sha: targetSha,
    anchor_generation: nextGeneration,
    map_projection_run_id: map.projection_run_id ?? null,
  };
  await client.query(
    `INSERT INTO cecelia_events (event_type,source,payload) VALUES ($1,'work-router',$2::jsonb)`,
    ['work_route_reanchored', JSON.stringify(eventPayload)],
  );
  await recordTaskEventSafe(client, task.id, 'base_sha_reanchored', eventPayload);
  return {
    ...successor,
    evidence: typeof successor.evidence === 'string' ? JSON.parse(successor.evidence) : successor.evidence,
    anchor_generation: nextGeneration,
    has_v2_run: false,
    superseded: false,
  };
}
