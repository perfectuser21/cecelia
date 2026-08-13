/**
 * kernel-controller-lifecycle.js — Session Controller / Kernel 生命周期守护与恢复
 * （sprint 08131104 Harness 入口统一，issue 962d399c 无主 Kernel Run 修复）。
 *
 * 职责边界：
 *  - Kernel process fatal：只结束 Kernel process，Controller（ownership 记录）存活，
 *    回传结构化 + 脱敏的 failure_reason（不落 controller_session_id 以外凭据）。
 *  - Controller fatal（lease 过期）/ 迁移前无主历史 run：判无主 → fail-closed 进恢复流程，
 *    绝不静默停留在活跃/ done 态（决策：无主 run 静默放行 = merged_without_evaluator_gate）。
 *
 * 无主判定（判定点登记表 C = A OR B）：
 *   A. controller_session_id 为空（从未取 ownership / 迁移前历史 run）
 *   B. controller_lease_expires_at 过期且无存活 controller（Controller 已死）
 *
 * 禁 mock 边：本模块直接对真 pg.Pool + initiative_runs 读写；测试真 PG 验真，禁 mock pool。
 */
import { finalizeKernelRun } from './kernel-run-store.js';
import { redactSecrets } from './failure-persistence.js';

/** 结构化 Kernel fatal failure_reason 前缀（可观测约定：kernel_process_fatal:<code>）。 */
export const KERNEL_FATAL_REASON_PREFIX = 'kernel_process_fatal';

/** 无主 run 恢复 failure_reason 前缀。 */
export const OWNERLESS_RECOVERED_REASON_PREFIX = 'ownerless_kernel_run_recovered';

const TERMINAL_PHASES = new Set(['done', 'failed']);

/**
 * 结构化 + 脱敏 failure_reason（INV-2 [日志脱敏]+[凭据安全]）。
 * 折叠成单行结构化码，redactSecrets 剥离任何 token/credential 明文，硬上限防日志膨胀。
 *
 * @param {string} prefix 结构化前缀（如 kernel_process_fatal）
 * @param {string} code 故障码 / 简短诊断
 * @returns {string} 形如 `kernel_process_fatal:<sanitized_code>`
 */
export function structuredFailureReason(prefix, code) {
  const raw = code == null ? 'unknown' : String(code);
  const oneLine = redactSecrets(raw).replace(/\s+/g, '_').slice(0, 200);
  const safeCode = oneLine.length > 0 ? oneLine : 'unknown';
  return `${prefix}:${safeCode}`;
}

/**
 * 纯谓词：run 行是否无主（判定点 C = A OR B）。terminal（done/failed）run 不再判无主。
 *
 * @param {{phase:string, controller_session_id:?string, controller_lease_expires_at:?(string|Date)}} runRow
 * @param {Date} now 当前时刻（注入保持确定性；禁 Date.now）
 * @returns {boolean}
 */
export function isOwnerlessRun(runRow, now) {
  if (!runRow) return false;
  if (TERMINAL_PHASES.has(runRow.phase)) return false;
  // A. 从未取 ownership（含迁移前无 controller_session_id 的历史 run）
  const sid = runRow.controller_session_id;
  if (sid == null || String(sid).trim() === '') return true;
  // B. lease 缺失或已过期（Controller 已死）
  const leaseRaw = runRow.controller_lease_expires_at;
  if (leaseRaw == null) return true;
  const lease = leaseRaw instanceof Date ? leaseRaw : new Date(leaseRaw);
  if (!Number.isFinite(lease.getTime())) return true;
  return lease.getTime() < now.getTime();
}

/**
 * Kernel process fatal 处理：只结束 Kernel（run finalize failed + 结构化脱敏 failure_reason），
 * Controller ownership 记录（controller_session_id）保持不动 —— Controller 存活可执行恢复/回传。
 *
 * finalizeKernelRun 的 UPDATE 只写 phase/failure_reason/completed_at/updated_at，不触碰
 * controller_session_id，故 Controller ownership 天然存活（B-05 断言 controller_session_id 仍在）。
 *
 * @param {import('pg').Pool} pool 真 pg.Pool（禁 mock 被改的边）
 * @param {{runId:string, expectedTaskId:string, failureCode:string}} params
 * @returns {Promise<{controllerAlive:boolean, failureReason:string, run:object}>}
 */
export async function handleKernelProcessFatal(pool, { runId, expectedTaskId, failureCode }) {
  const failureReason = structuredFailureReason(KERNEL_FATAL_REASON_PREFIX, failureCode);
  const result = await finalizeKernelRun(pool, {
    runId,
    expectedTaskId,
    outcome: 'failed',
    reason: failureReason,
  });
  // finalizeKernelRun 不清 controller_session_id → Controller ownership 记录存活。
  return { controllerAlive: true, failureReason, run: result?.run ?? null };
}

/**
 * 无主 Kernel Run 恢复扫描（Controller fatal / lease 过期 / 迁移前无主历史 run）。
 * 找出所有活跃（phase 非 done/failed）但无主的 v2 Kernel run，逐条 fail-closed 收敛：
 * finalize failed + 结构化 failure_reason，交由既有恢复流程重新派发。绝不静默放行。
 *
 * @param {import('pg').Pool} pool 真 pg.Pool
 * @param {{now?: Date}} [opts]
 * @returns {Promise<Array<{runId:string, taskId:string, cause:string, failureReason:string}>>}
 *          被判无主并已 fail-closed 收敛的 run 列表
 */
export async function reconcileOwnerlessKernelRuns(pool, { now = new Date() } = {}) {
  const { rows } = await pool.query(
    `SELECT id, current_task_id, phase,
            controller_session_id, controller_lease_expires_at
       FROM initiative_runs
      WHERE orchestrator_version = 'v2'
        AND phase NOT IN ('done', 'failed')
        AND (
          controller_session_id IS NULL
          OR controller_lease_expires_at IS NULL
          OR controller_lease_expires_at < $1
        )
      ORDER BY id`,
    [now],
  );

  const recovered = [];
  for (const run of rows) {
    // 二次纯谓词确认（同一 now 语义），避免与并发续租竞态误伤。
    if (!isOwnerlessRun(run, now)) continue;
    const cause = (run.controller_session_id == null || String(run.controller_session_id).trim() === '')
      ? 'no_controller_ownership'
      : 'controller_lease_expired';
    const failureReason = structuredFailureReason(OWNERLESS_RECOVERED_REASON_PREFIX, cause);
    try {
      await finalizeKernelRun(pool, {
        runId: run.id,
        expectedTaskId: run.current_task_id,
        outcome: 'failed',
        reason: failureReason,
      });
      recovered.push({
        runId: run.id, taskId: run.current_task_id, cause, failureReason,
      });
    } catch (err) {
      // 单条收敛失败不阻塞其余无主 run 的恢复（下一轮巡检重试）。
      console.warn(`[kernel-controller-lifecycle] ownerless recover failed run=${run.id}: ${err.message}`);
    }
  }
  return recovered;
}
