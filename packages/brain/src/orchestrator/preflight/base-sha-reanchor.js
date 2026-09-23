// 派发时重锚定 base_sha（任务 d9c405e2 / 决策 49035988）。
// 路由收据 append-only（迁移 413），快进 = 插接班收据（supersedes_receipt_id + anchor_generation），
// 同事务同步 tasks.payload（421 触发器按最新收据比对 routing_receipt_id，必须先 INSERT 后 UPDATE）。
// 只在"分支尚无任何产出"时快进：kernel-v1 generator 不 push，候选留在跑场机本地，
// git 看不到，所以用 DB 事实 initiative_runs（harness_attempts.run_id 是其 NOT NULL FK）判定。

const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const MAX_FASTFORWARD = 5;

function reanchorError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

// 计数与代际都来自 jsonb / DB，可能是脏值（字符串/NaN）或被手工写成负数。
// 脏值按兜底值处理并告警，有限值夹到下限：保证写回的永远是有限非负整数，
// 既不会把 NaN 灌进 jsonb，也不会让负计数永久免疫 map_thrash 闸。
function finiteInt(raw, { fallback, floor, field, taskId }) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[base-sha-reanchor] ${field} 非法，按 ${fallback} 处理 task=${taskId} value=${JSON.stringify(raw)}`);
    return fallback;
  }
  return Math.max(floor, Math.trunc(parsed));
}

/**
 * 分支尚无产出时，把路由收据的 base_sha 快进到地图最新 revision。
 *
 * 前置条件（调用方必须满足，违反无法补救）：
 * - 必须在事务内调用，且 client 是该事务的 client，不能传 pool。收据表 append-only
 *   （迁移 413，无 DELETE 权限）；误传 pool 时 INSERT 立即落盘，后续步骤失败也回滚不掉，
 *   会留下一条永久孤儿接班收据，把任务锚在一个从未生效的 base_sha 上。
 * - 调用前 tasks 行必须已 SELECT ... FOR UPDATE 持锁，否则并发派发会重复快进。
 * - task 必须带 metadata 列（SELECT 未取该列 → 抛 task_metadata_missing，不静默按 0）。
 *
 * @param {import('pg').PoolClient} client 事务 client
 * @param {Object} args
 * @param {Object} args.task 已加锁的 task 行（需含 id / payload / metadata）
 * @param {Object} args.receipt 当前生效的路由收据
 * @param {Object} args.map 地图快照（freshness + projection_run_id）
 * @returns {Promise<Object|null>} 接班收据（含新 base_sha）；不满足快进条件返回 null
 * @throws {Error} code ∈ receipt_task_mismatch / receipt_superseded / task_metadata_missing /
 *   needs_rebase / map_thrash
 */
export async function reanchorReceiptIfEmptyBranch(client, {
  task, receipt, map, now = new Date(), createdSource = null,
}) {
  if (receipt?.task_id && receipt.task_id !== task?.id) {
    throw reanchorError('receipt_task_mismatch', {
      task_id: task?.id ?? null, receipt_task_id: receipt.task_id, receipt_id: receipt.id ?? null,
    });
  }
  // 传进来的必须是当前生效收据。拿已被接班的旧收据再快进，会插出第二条
  // supersedes 指向同一张旧收据的分叉链（465 唯一键会拒，整事务回滚），属调用方契约违约。
  if (receipt?.superseded === true) {
    throw reanchorError('receipt_superseded', {
      task_id: task?.id ?? null, receipt_id: receipt.id ?? null,
      anchor_generation: receipt.anchor_generation ?? null,
    });
  }

  const oldBaseSha = receipt?.evidence?.base_sha;
  const repoFreshness = map?.freshness?.repos?.[receipt?.repo];
  const targetSha = repoFreshness?.source_revision;
  if (!SHA_PATTERN.test(oldBaseSha ?? '')
    || map?.freshness?.status !== 'fresh'
    || repoFreshness?.status !== 'fresh'
    || !SHA_PATTERN.test(targetSha ?? '')) {
    return null;
  }
  if (targetSha === oldBaseSha) return null;
  if (receipt.work_kind !== 'coding_mutation') return null;
  if (task?.payload?.map_recovery === true) return null;
  if (createdSource === 'explicit_recovery') return null;

  // metadata 为 null 是合法列值（视为 {}）；undefined 说明调用方 SELECT 漏了该列，
  // 静默按 0 会让快进计数永远清零、绕过 map_thrash 闸，必须 fail-loud。
  if (task?.metadata === undefined) {
    throw reanchorError('task_metadata_missing', { task_id: task?.id ?? null });
  }

  const rebaseDetail = {
    task_id: task.id, old_base_sha: oldBaseSha, new_base_sha: targetSha,
    branch: receipt.evidence?.branch ?? null, has_v2_run: receipt.has_v2_run === true,
  };
  // 有产出的判定必须排在 map_thrash 之前：分支已经有东西时，正确处置是人工 rebase，
  // 而不是因为快进次数超限报一个会误导人去查地图抖动的 map_thrash。
  if (receipt.has_v2_run === true) throw reanchorError('needs_rebase', rebaseDetail);
  // 保守口径（spec）：建过 run 即视为"分支已有产出"，不再快进。代价是重试型 run
  // 建过一次后该任务永久失去快进能力，只能走 needs_rebase 人工重挂。
  // 拆成两个 EXISTS 用 OR 连接（不写成单表内 OR 条件），让 idx_initiative_runs_current_task
  // （迁移 465）与 idx_initiative_runs_initiative（迁移 238）各自可用。375 的部分唯一索引
  // 带 orchestrator_version/phase 谓词，裸 current_task_id = $1 走不到它，故 465 另建裸列索引。
  const { rows: runRows } = await client.query(
    `SELECT (
       EXISTS (SELECT 1 FROM initiative_runs WHERE current_task_id = $1::uuid)
       OR EXISTS (SELECT 1 FROM initiative_runs WHERE initiative_id = $1::uuid)
     ) AS has_any_run`,
    [task.id],
  );
  if (runRows[0]?.has_any_run === true) throw reanchorError('needs_rebase', rebaseDetail);

  const fastforwardCount = finiteInt(task.metadata?.base_sha_fastforward_count ?? 0, {
    fallback: 0, floor: 0, field: 'base_sha_fastforward_count', taskId: task.id,
  });
  if (fastforwardCount >= MAX_FASTFORWARD) {
    throw reanchorError('map_thrash', {
      task_id: task.id, fastforward_count: fastforwardCount,
      old_base_sha: oldBaseSha, map_revision: targetSha,
    });
  }

  const nextGeneration = finiteInt(receipt.anchor_generation ?? 1, {
    fallback: 1, floor: 1, field: 'anchor_generation', taskId: task.id,
  }) + 1;
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
      task.id, receipt.source, receipt.source_id, receipt.work_kind, receipt.change_kind,
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
    map_projection_run_id: map?.projection_run_id ?? null,
  };
  await client.query(
    `INSERT INTO cecelia_events (event_type,source,payload) VALUES ($1,'work-router',$2::jsonb)`,
    ['work_route_reanchored', JSON.stringify(eventPayload)],
  );
  // 不用 recordTaskEventSafe：它吞错返回 false，在事务内吞错会让一个已 abort 的事务
  // 继续往下走，最终假成功。留痕失败必须随事务上抛回滚。
  await client.query(
    `INSERT INTO task_events (task_id, event_type, payload, created_at)
     VALUES ($1, $2, $3::jsonb, NOW())`,
    [task.id, 'base_sha_reanchored', JSON.stringify(eventPayload)],
  );
  return {
    ...successor,
    evidence,
    anchor_generation: nextGeneration,
    base_sha: targetSha,
    has_v2_run: false,
    superseded: false,
  };
}
