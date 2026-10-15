/**
 * task-lease.js — 统一领单租约（派发总闸 G，任务 c5f6e683；迁移 553 task_leases）。
 *
 * 所有外部执行者（factory-dispatcher / coding-workflow-runner / us-price-keyword 领单器 …）走同一个
 * POST /api/brain/tasks/:id/claim，带 lease_seconds 即落租约；执行期间 POST /tasks/:id/heartbeat 续约。
 * Brain 自派的 openclaw-agent（秋米 / workflow_dispatch / 手机队列）在 ssh 起跑后落 Brain 租约
 * （claimer 为空，长度 = 执行超时 + 15 分钟），不靠心跳。
 *
 * task-lease-reaper（scheduler，60s）收过期租约：
 *   - 任务已终态 / 认领已换人 → 只关租约，不动任务
 *   - 领单租约 → 按任务类型现有语义：执行者合同 onStale 为 requeue / release-claim-and-alert → 回队（清认领，
 *     task_leases.requeue_count+1，满 3 次判 failed）；其余（openclaw-agent / script / coding-workflow-runner …外部执行体）
 *     → 判 lost（failed，error_message=lease_expired:…）。领单方可在 claim 时用 on_lease_expire 显式指定。
 *   - Brain 租约 → 先探活（远端 .exit/.pid）：alive 续 15 分钟；dead 且过期不足 10 分钟留给专属收割；
 *     dead 超宽限或 unknown → 判 lost。这把 openclaw-agent「生死未知不处置」接上了收口。
 *   - 回队 / 判 lost 都释放该任务持有的设备锁（锁跟租约走）。
 * 心跳与落租约时同步把任务持有的设备锁 expires_at 拉到 lease_until。
 */
import { EXECUTOR_CONTRACTS, resolveLivenessKind } from '../executor-contracts.js';
import { releaseDeviceLocksHeldBy } from '../device-lock-helpers.js';
import { finalizeTask } from './task-terminal.js';
import { recordTaskEventSafe } from './task-event-log.js';

export const LEASE_MIN_SECONDS = 30;
export const LEASE_MAX_SECONDS = 4 * 3600;
export const BRAIN_LEASE_MARGIN_SECONDS = 900;
export const BRAIN_LEASE_EXTEND_SECONDS = 900;
export const BRAIN_LEASE_MAX_EXTENDS = 8;
export const DEAD_GRACE_SECONDS = 600;
const ON_EXPIRE = new Set(['auto', 'requeue', 'fail']);
const REQUEUE_ON_STALE = new Set(['requeue', 'release-claim-and-alert']);
export const LEASE_MAX_REQUEUES = 3;
const REAP_BATCH = 50;
const PROBE_BUDGET = 10;
const ACTIVE = ['queued', 'in_progress'];

/** 越界夹紧；非数字返回 null（= 不落租约）。 */
export function clampLeaseSeconds(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(LEASE_MAX_SECONDS, Math.max(LEASE_MIN_SECONDS, n));
}

/** 过期处置：'requeue' | 'fail'。显式 on_expire 优先，否则按执行者合同 onStale。 */
export function resolveExpiryAction(task, lease) {
  if (lease?.on_expire === 'requeue' || lease?.on_expire === 'fail') return lease.on_expire;
  const kind = resolveLivenessKind(task) || 'headed-session';
  const onStale = EXECUTOR_CONTRACTS[kind]?.onStale;
  return REQUEUE_ON_STALE.has(onStale) ? 'requeue' : 'fail';
}

async function syncDeviceLocks(pool, taskId, leaseUntil) {
  await pool.query('UPDATE device_locks SET expires_at = $2::timestamptz WHERE locked_by = $1', [String(taskId), leaseUntil]);
}

async function upsertLease(pool, { taskId, claimer, source, onExpire, seconds }) {
  const { rows } = await pool.query(
    `INSERT INTO task_leases (task_id, claimer, source, on_expire, lease_seconds, lease_until, claimed_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($5::int * INTERVAL '1 second'), NOW())
     ON CONFLICT (task_id) DO UPDATE SET
       claimer = EXCLUDED.claimer, source = EXCLUDED.source, on_expire = EXCLUDED.on_expire,
       lease_seconds = EXCLUDED.lease_seconds, lease_until = EXCLUDED.lease_until, claimed_at = NOW(),
       heartbeat_at = NULL, heartbeat_count = 0, extend_count = 0, released_at = NULL, release_reason = NULL
     RETURNING lease_until, lease_seconds, on_expire`,
    [taskId, claimer, source, onExpire, seconds],
  );
  const lease = rows?.[0] ?? null;
  if (lease?.lease_until) await syncDeviceLocks(pool, taskId, lease.lease_until);
  return lease;
}

/**
 * 统一 claim：原子认领（claimed_by IS NULL 才成功），带 leaseSeconds 时落租约。
 * @returns {{status:number, body:object}}
 */
export async function claimTaskWithLease(pool, { taskId, claimer, executorKind, leaseSeconds, onExpire } = {}) {
  if (!claimer) return { status: 400, body: { error: 'claimer is required' } };
  const expire = onExpire ?? 'auto';
  if (!ON_EXPIRE.has(expire)) return { status: 400, body: { error: 'on_lease_expire must be auto|requeue|fail' } };
  const seconds = clampLeaseSeconds(leaseSeconds);
  const kind = executorKind || 'headed-session';
  // 执行机 coding workflow runner 认领必须落下自己的 kind（executor-contracts 据此当外部执行体，启动同步不打回）
  const forceKind = kind === 'coding-workflow-runner';
  const result = await pool.query(
    `UPDATE tasks SET claimed_by = $1, claimed_at = NOW(),
            executor_kind = CASE WHEN $4 THEN $3 ELSE COALESCE(executor_kind, $3) END
      WHERE id = $2 AND claimed_by IS NULL AND payload->>'commander_protocol' IS DISTINCT FROM 'commander-v2'
      RETURNING id, claimed_by, claimed_at, executor_kind`,
    [claimer, taskId, kind, forceKind],
  );
  if (!result.rows?.length) {
    const existing = await pool.query('SELECT claimed_by, claimed_at FROM tasks WHERE id = $1', [taskId]);
    if (!existing.rows?.length) return { status: 404, body: { error: 'Task not found', id: taskId } };
    return { status: 409, body: { error: 'Task already claimed', claimed_by: existing.rows[0].claimed_by, claimed_at: existing.rows[0].claimed_at } };
  }
  const body = { ...result.rows[0] };
  if (seconds !== null) {
    const lease = await upsertLease(pool, { taskId, claimer, source: 'claim', onExpire: expire, seconds });
    body.lease_until = lease?.lease_until ?? null;
    body.lease_seconds = lease?.lease_seconds ?? seconds;
    body.on_lease_expire = lease?.on_expire ?? expire;
  }
  return { status: 200, body };
}

/** 心跳续约：只有同一领单方、租约未关、任务仍活跃且认领仍是它时才续。 */
export async function heartbeatTaskLease(pool, { taskId, claimer, leaseSeconds } = {}) {
  const seconds = clampLeaseSeconds(leaseSeconds);
  const { rows } = await pool.query(
    `UPDATE task_leases l
        SET lease_seconds = COALESCE($3::int, l.lease_seconds),
            lease_until = NOW() + (COALESCE($3::int, l.lease_seconds) * INTERVAL '1 second'),
            heartbeat_at = NOW(), heartbeat_count = l.heartbeat_count + 1
       FROM tasks t
      WHERE l.task_id = $1 AND t.id = l.task_id AND l.claimer = $2 AND l.released_at IS NULL
        AND t.claimed_by = $2 AND t.status IN ('queued', 'in_progress') AND t.payload->>'commander_protocol' IS DISTINCT FROM 'commander-v2'
      RETURNING l.task_id, l.lease_until, l.heartbeat_count, l.lease_seconds`,
    [taskId, claimer, seconds],
  );
  if (rows?.length) {
    await syncDeviceLocks(pool, taskId, rows[0].lease_until);
    return { ok: true, lease: rows[0] };
  }
  const cur = await pool.query('SELECT status, claimed_by FROM tasks WHERE id = $1', [taskId]);
  return { ok: false, reason: 'lease_lost', task: cur.rows?.[0] ?? null };
}

/** 领单方主动关租约（正常收尾可选调用；不关也会在过期时按终态收掉）。 */
export async function releaseTaskLease(pool, { taskId, claimer, reason } = {}) {
  const { rows } = await pool.query(
    `UPDATE task_leases SET released_at = NOW(), release_reason = $3
      WHERE task_id = $1 AND claimer IS NOT DISTINCT FROM $2 AND released_at IS NULL
      RETURNING task_id`,
    [taskId, claimer ?? null, String(reason || 'released_by_claimer').slice(0, 200)],
  );
  return { released: Boolean(rows?.length) };
}

/** Brain 自派执行（openclaw-agent）落租约：claimer 为空，过期先探活。 */
export async function setBrainLease(pool, taskId, seconds) {
  const s = clampLeaseSeconds(seconds) ?? LEASE_MAX_SECONDS;
  return upsertLease(pool, { taskId, claimer: null, source: 'brain', onExpire: 'auto', seconds: s });
}

async function markReleased(pool, taskId, reason) {
  await pool.query(
    'UPDATE task_leases SET released_at = NOW(), release_reason = $2 WHERE task_id = $1 AND released_at IS NULL',
    [taskId, reason],
  );
}

async function defaultProbe(task) {
  const kind = resolveLivenessKind(task);
  const probe = EXECUTOR_CONTRACTS[kind]?.probe;
  if (!probe) return 'unknown';
  try { return await probe(task, { allowDefaultPool: false }); } catch { return 'unknown'; }
}

async function requeue(pool, row, why) {
  const { rows } = await pool.query(
    `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
            error_message = $2, updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'in_progress') AND claimed_by IS NOT DISTINCT FROM $3
      RETURNING id`,
    [row.task_id, why, row.task_claimed_by],
  );
  if (!rows?.length) return false;
  await pool.query('UPDATE task_leases SET requeue_count = requeue_count + 1 WHERE task_id = $1', [row.task_id]);
  return true;
}

async function failLost(pool, row, why, detail) {
  const where = row.source === 'claim' ? { sql: 'claimed_by IS NOT DISTINCT FROM $1', params: [row.task_claimed_by] } : undefined;
  const r = await finalizeTask(pool, row.task_id, 'failed', {
    set: { error_message: why, completed_at: 'now' },
    mergeResult: { lease_expired: { ...detail, at: new Date().toISOString() } },
    onlyIfStatus: ACTIVE,
    ...(where ? { where } : {}),
  });
  return (r?.rowCount ?? 0) > 0;
}

/** 一轮：返回 { requeued, failed, extended, released, skipped }。 */
export async function reapExpiredLeases(pool, deps = {}) {
  const probe = deps.probe ?? defaultProbe;
  const out = { requeued: 0, failed: 0, extended: 0, released: 0, skipped: 0 };
  const { rows } = await pool.query(
    `SELECT l.task_id, l.claimer, l.source, l.on_expire, l.lease_until, l.extend_count, l.heartbeat_count, l.requeue_count,
            EXTRACT(EPOCH FROM (NOW() - l.lease_until))::int AS expired_sec,
            t.id, t.status, t.task_type, t.executor_kind, t.claimed_by AS task_claimed_by,
            t.payload
       FROM task_leases l LEFT JOIN tasks t ON t.id = l.task_id
      WHERE l.released_at IS NULL AND l.lease_until < NOW()
      ORDER BY l.lease_until ASC
      LIMIT ${REAP_BATCH}`,
  );
  let probes = 0;
  for (const row of rows ?? []) {
    if (row.payload?.commander_protocol === 'commander-v2') { out.skipped++; continue; }
    if (!row.id || !ACTIVE.includes(row.status)) {
      await markReleased(pool, row.task_id, 'task_terminal');
      out.released++;
      continue;
    }
    if (row.source === 'claim' && row.task_claimed_by !== row.claimer) {
      await markReleased(pool, row.task_id, 'claim_changed');
      out.released++;
      continue;
    }
    const detail = {
      claimer: row.claimer, source: row.source, lease_until: row.lease_until,
      heartbeat_count: row.heartbeat_count, expired_sec: row.expired_sec,
    };
    let reason = `lease_expired: ${row.source === 'brain' ? 'brain lease' : `claimer=${row.claimer}`} 过期 ${row.expired_sec}s 无心跳`;
    let action;
    if (row.source === 'brain') {
      if (probes >= PROBE_BUDGET) { out.skipped++; continue; }
      probes++;
      const verdict = await probe(row);
      detail.probe = verdict;
      // 获客跨机控制器断网不能证明远端手机已停；未知只续租保锁，专属收割/人工只读恢复，禁止重发。
      if (row.payload?.leadgen_run) {
        const renewed=await pool.query("UPDATE task_leases SET lease_until=NOW()+($2::int * INTERVAL '1 second'),extend_count=extend_count+1 WHERE task_id=$1 AND released_at IS NULL RETURNING lease_until",[row.task_id,BRAIN_LEASE_EXTEND_SECONDS]);
        if(renewed.rows?.[0]?.lease_until)await syncDeviceLocks(pool,row.task_id,renewed.rows[0].lease_until);
        await recordTaskEventSafe(pool,row.task_id,'leadgen_lease_retained_unknown_or_alive',detail);out.extended++;continue;
      }
      if (verdict === 'alive' && row.extend_count < BRAIN_LEASE_MAX_EXTENDS) {
        await pool.query(
          `UPDATE task_leases SET lease_until = NOW() + ($2::int * INTERVAL '1 second'), extend_count = extend_count + 1
            WHERE task_id = $1 AND released_at IS NULL`,
          [row.task_id, BRAIN_LEASE_EXTEND_SECONDS],
        );
        await recordTaskEventSafe(pool, row.task_id, 'lease_extended_alive', detail);
        out.extended++;
        continue;
      }
      if (verdict === 'dead' && row.expired_sec < DEAD_GRACE_SECONDS) { out.skipped++; continue; }
      reason = `lease_expired: brain lease 过期 ${row.expired_sec}s，probe=${verdict}`;
      action = 'fail';
    } else {
      action = resolveExpiryAction(row, row);
      const requeues = Number(row.requeue_count ?? 0) + 1;
      if (action === 'requeue' && requeues >= LEASE_MAX_REQUEUES) {
        action = 'fail';
        reason = `${reason}；retries_exhausted ${requeues}/${LEASE_MAX_REQUEUES}`;
      }
    }
    const done = action === 'requeue' ? await requeue(pool, row, reason) : await failLost(pool, row, reason, detail);
    if (!done) {
      await markReleased(pool, row.task_id, 'task_changed');
      out.released++;
      continue;
    }
    await releaseDeviceLocksHeldBy(row.task_id, pool);
    await markReleased(pool, row.task_id, action === 'requeue' ? 'expired_requeued' : 'expired_lost');
    await recordTaskEventSafe(pool, row.task_id, 'lease_expired', { ...detail, action, reason });
    if (action === 'requeue') out.requeued++;
    else out.failed++;
  }
  return out;
}
