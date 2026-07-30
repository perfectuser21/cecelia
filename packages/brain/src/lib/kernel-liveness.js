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
import { loadActiveKernelRun } from '../orchestrator/kernel-run-store.js';

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
 * current_task_id 是唯一身份键；initiative_id 只做业务聚合，不能参与判活。
 * @returns {Promise<object|null>} 查不到返回 null（不抛）；SQL 异常向上抛，由调用方 fail-open。
 */
export async function loadKernelRun(pool, { taskId } = {}) {
  if (!pool?.query || !taskId) return null;
  return loadActiveKernelRun(pool, taskId);
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

  // needs_context 是显式控制面暂停，不是执行进程故障。Controller 在 pause 后
  // 正常退出，旧 PID 消失和心跳停止都不能把等待人答的 run 判死。
  if (row.phase === 'paused') {
    return { verdict: 'alive', reason: 'run_paused', runId: row.id };
  }

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
