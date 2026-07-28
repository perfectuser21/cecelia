/**
 * kernel-liveness.js —— Kernel v1 进程判活（2026-07-27）
 *
 * 背景：harness 有两代运行时并存。
 *   - 旧 one-session relay：执行体是 docker 容器 `cecelia-relay-<task前8位>-*`，
 *     活性事实写在 initiative_run_events（ts / ts_end）。
 *   - Kernel v1：执行体是 harness-skill-relay.js `launchKernelProcess()` 用
 *     nodeSpawn(process.execPath, [orchestrator/run.js ...], {detached:true}) 起的
 *     裸 Node 进程，不是容器；活性事实写在 initiative_runs.orchestrator_heartbeat_at
 *     （配套 orchestrator_pid / orchestrator_host，见 orchestrator/heartbeat.js）。
 *
 * packages/brain/src/orchestrator/ 全目录对 initiative_run_events 零引用，也从不
 * 创建 cecelia-relay-* 容器 —— 旧守卫看 Kernel run 时两个信号同时返回"死"。
 *
 * 事故实锤：task 51836fb2 / run 13d41c64，orchestrator_heartbeat_at = 01:06:53，
 * 比该 task 被标 failed 的 01:02:37 晚 4 分 16 秒。Controller 活得好好的却被判死，
 * orphan_requeue_count 烧到 3 后终态 failed。
 *
 * 铁律 —— fail-open：
 *   查询异常 / 字段缺失 / host 不匹配 / pid 探活拿不到确定答案，一律 'unknown'。
 *   只有"host 匹配 + pid 存在 + kill(pid,0) 返回 ESRCH"这一条正面证据才判 'dead'。
 *   把"我不知道"变成"它死了"就是这次事故的全部根因。
 *
 * 依赖全注入（pool / now / hostFn / killFn），便于单测喂假 db、假 process.kill。
 */
import os from 'node:os';
import { sha256Canonical } from './kernel-equivalence-receipts.js';

const LIVENESS_SEAM_ID = 'kernel.liveness.orphan_recovery';
const LIVENESS_EFFECTS = Object.freeze({
  normal: Object.freeze({
    verdict: 'alive',
    observed_outcome: 'confirmed',
    effect_code: 'live_attempt_preserved',
  }),
  violation: Object.freeze({
    verdict: 'unknown',
    observed_outcome: 'denied',
    effect_code: 'uncertain_liveness_cleanup_denied',
  }),
  recovery: Object.freeze({
    verdict: 'dead',
    observed_outcome: 'recovered',
    effect_code: 'confirmed_dead_attempt_recovered',
  }),
});

function livenessSeamError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * 心跳新鲜阈值 = 3 分钟。
 * 取值理由：Kernel 的等待循环每 90s 打一次心跳（orchestrator/run.js → writeHeartbeat），
 * 两个心跳间隔 + 调度余量 = 3min。与 harness-relay-watchdog.js 的
 * KERNEL_RECONCILE_STALE_MS 同源同值，两处判据保持一致，避免"守卫甲说死、守卫乙说活"。
 */
export const KERNEL_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

/** 该任务是否跑在 Kernel v1 运行时上（payload 由 _spawnKernelRuntime 持久化）。 */
export function isKernelRuntimeTask(task) {
  return task?.payload?.harness_runtime === 'kernel-v1';
}

/** timestamptz / ISO string / Date / epoch ms → epoch ms；无法解析返回 null。 */
function toEpochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

/**
 * 取该任务当前的 Kernel run 行（v2 且非终态）。
 * 双键定位：current_task_id 是 kernel run 的身份键（见 _spawnKernelRuntime 去重注释），
 * initiative_id 作为兜底（B51 约定 initiative_id 缺省 = task.id）。
 * @returns {Promise<object|null>} 查不到返回 null（不抛）；SQL 异常向上抛，由调用方 fail-open。
 */
export async function loadKernelRun(pool, { taskId, initiativeId = null } = {}) {
  if (!pool?.query || !taskId) return null;
  const { rows } = await pool.query(
    `SELECT id, initiative_id, current_task_id, phase,
            orchestrator_heartbeat_at, orchestrator_pid, orchestrator_host, started_at
       FROM initiative_runs
      WHERE orchestrator_version = 'v2'
        AND phase NOT IN ('done','failed')
        AND (current_task_id = $1::uuid OR initiative_id = COALESCE($2::uuid, $1::uuid))
      ORDER BY started_at DESC
      LIMIT 1`,
    [taskId, initiativeId]
  );
  return rows?.[0] ?? null;
}

/**
 * Kernel 心跳时刻（epoch ms），供旧守卫与 initiative_run_events 取 max。
 * 非 kernel 任务或任何异常一律 null（调用方按"这条信号没有"处理，不当作死亡证据）。
 */
export async function latestKernelHeartbeatMs({ pool, task, run = null } = {}) {
  if (!isKernelRuntimeTask(task)) return null;
  let row = run;
  if (!row) {
    try {
      row = await loadKernelRun(pool, {
        taskId: task.id,
        initiativeId: task.payload?.initiative_id ?? null,
      });
    } catch {
      return null;
    }
  }
  return toEpochMs(row?.orchestrator_heartbeat_at);
}

/**
 * Kernel v1 判活。
 *
 * 判定顺序：
 *   1. 非 kernel-v1 → 'not_applicable'（调用方原样走旧逻辑，旧路径行为一字不动）
 *   2. orchestrator_heartbeat_at 在 staleMs 内 → 'alive'
 *   3. 否则 orchestrator_pid + orchestrator_host 与本机一致 → kill(pid,0) 探活
 *   4. 拿不到确定答案 → 'unknown'
 *
 * @returns {Promise<{verdict:'not_applicable'|'alive'|'dead'|'unknown', reason:string,
 *                    source?:'heartbeat'|'pid', heartbeatAgeMs?:number, runId?:string}>}
 */
export async function assessKernelLiveness({
  pool,
  task,
  run = null,
  now = () => Date.now(),
  staleMs = KERNEL_HEARTBEAT_STALE_MS,
  hostFn = () => os.hostname(),
  killFn = (pid, signal) => process.kill(pid, signal),
} = {}) {
  if (!isKernelRuntimeTask(task)) {
    return { verdict: 'not_applicable', reason: 'not_kernel_runtime' };
  }

  let row = run;
  if (!row) {
    try {
      row = await loadKernelRun(pool, {
        taskId: task.id,
        initiativeId: task.payload?.initiative_id ?? null,
      });
    } catch (err) {
      return { verdict: 'unknown', reason: `run_query_error:${err.message}` };
    }
  }
  if (!row) return { verdict: 'unknown', reason: 'no_kernel_run' };

  // ① 心跳
  const hbMs = toEpochMs(row.orchestrator_heartbeat_at);
  if (hbMs != null) {
    const age = now() - hbMs;
    if (age <= staleMs) {
      return {
        verdict: 'alive', reason: 'fresh_heartbeat', source: 'heartbeat',
        heartbeatAgeMs: age, runId: row.id,
      };
    }
  }

  // ② pid（必须 host 一致——跨主机裸 pid 无意义，见 orchestrator/heartbeat.js 注释）
  const pid = Number(row.orchestrator_pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { verdict: 'unknown', reason: 'no_pid', source: 'pid', runId: row.id };
  }
  const runHost = row.orchestrator_host ? String(row.orchestrator_host) : null;
  let localHost = null;
  try {
    localHost = hostFn();
  } catch {
    localHost = null;
  }
  if (!runHost || !localHost || runHost !== localHost) {
    return { verdict: 'unknown', reason: 'host_mismatch', source: 'pid', runId: row.id };
  }
  try {
    killFn(pid, 0);
    return { verdict: 'alive', reason: 'pid_alive', source: 'pid', runId: row.id };
  } catch (err) {
    // EPERM = 进程在但当前用户没权限发信号 → 活；ESRCH = 确证没了 → 死；其余不猜。
    if (err?.code === 'EPERM') {
      return { verdict: 'alive', reason: 'pid_alive_eperm', source: 'pid', runId: row.id };
    }
    if (err?.code === 'ESRCH') {
      return { verdict: 'dead', reason: 'pid_gone', source: 'pid', runId: row.id };
    }
    return {
      verdict: 'unknown',
      reason: `pid_probe_error:${err?.code ?? err?.message ?? 'unknown'}`,
      source: 'pid', runId: row.id,
    };
  }
}

export function createKernelLivenessEquivalenceSeam({
  effectSigner,
  recoverDeadAttempt,
} = {}) {
  if (typeof effectSigner?.signEffectResult !== 'function') {
    throw livenessSeamError('seam_effect_signer_unavailable');
  }
  if (typeof recoverDeadAttempt !== 'function') {
    throw livenessSeamError('liveness_recovery_port_unavailable');
  }

  return Object.freeze({
    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    }) {
      signal?.throwIfAborted();
      if (
        cell?.seam_id !== LIVENESS_SEAM_ID
        || typeof resource?.snapshot !== 'function'
        || !resource?.liveness_input
      ) {
        throw livenessSeamError('liveness_equivalence_resource_invalid');
      }
      const effect = LIVENESS_EFFECTS[cell.scenario];
      if (!effect) {
        throw livenessSeamError('liveness_equivalence_scenario_invalid');
      }

      const before = await resource.snapshot({ phase: 'before', signal });
      signal?.throwIfAborted();
      const assessment = await assessKernelLiveness(
        resource.liveness_input,
      );
      signal?.throwIfAborted();
      if (assessment.verdict !== effect.verdict) {
        throw livenessSeamError('liveness_equivalence_outcome_unexpected');
      }

      let recovery = null;
      if (cell.scenario === 'recovery') {
        recovery = await recoverDeadAttempt({
          assessment,
          cell,
          grant,
          resource,
          signal,
        });
        signal?.throwIfAborted();
        if (!['requeued', 'recovered'].includes(recovery?.action)) {
          throw livenessSeamError(
            'liveness_equivalence_recovery_unconfirmed',
          );
        }
      }
      const after = await resource.snapshot({
        phase: 'after',
        assessment,
        recovery,
        signal,
      });
      signal?.throwIfAborted();

      return effectSigner.signEffectResult({
        service_id: LIVENESS_SEAM_ID,
        cell,
        grant,
        resource_id: grant.resource_id,
        resource_ref: grant.resource_ref,
        observed_outcome: effect.observed_outcome,
        effect_code: effect.effect_code,
        before_hash: sha256Canonical(before),
        after_hash: sha256Canonical(after),
        predecessor,
        signal,
      });
    },

    async cancel({ signal } = {}) {
      return { confirmed: signal?.aborted === true };
    },

    async cleanup() {
      return { confirmed: true };
    },
  });
}
