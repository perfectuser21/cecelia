/**
 * staging-e2e-plugin.js — 阶段2 Slice1：staging_e2e 任务的 tick 内联执行器
 *
 * 为什么是 plugin 而不是走 dispatcher：
 *   staging_e2e 任务 skill='/_internal'（Brain 进程内处理，不派外部 agent）。
 *   普通 dispatcher 会把 queued 任务派给 executor → 外部 agent，不适合内联 handler。
 *   故由本 plugin 在 tick 内联 claim + 执行，并把 staging_e2e 从 dispatcher 候选里排除
 *   （见 dispatch-helpers.js 的 task_type NOT IN 列表）。
 *
 * 每 tick：claim 一个 queued staging_e2e 任务 → handleStagingE2e（部署+E2E+落库）→ 标终态。
 * 节流门：STAGING_E2E_INTERVAL_MS（默认 30s）。
 * 失败处理：内部 catch，不向上抛，绝不让 tick loop 崩溃。
 */
import { handleStagingE2e } from './harness-staging-e2e.js';

const STAGING_E2E_INTERVAL_MS = parseInt(
  process.env.CECELIA_STAGING_E2E_INTERVAL_MS || String(30 * 1000),
  10
);
const CLAIMER = 'staging-e2e-plugin';

/**
 * 原子 claim 一个 queued staging_e2e 任务（FOR UPDATE SKIP LOCKED 防并发重复执行）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<object|null>} 被 claim 的任务行，无可执行任务返回 null
 */
export async function claimStagingE2eTask(pool) {
  const { rows } = await pool.query(
    `UPDATE tasks
        SET status = 'in_progress', claimed_by = $1, claimed_at = NOW(), started_at = NOW()
      WHERE id = (
        SELECT id FROM tasks
         WHERE task_type = 'staging_e2e'
           AND status = 'queued'
           AND claimed_by IS NULL
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, title, payload`,
    [CLAIMER]
  );
  return rows[0] || null;
}

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   tickState: { lastStagingE2eTime?: number },
 *   tickLog?: (...args: any[]) => void,
 *   intervalMs?: number,
 *   handler?: Function,   // 测试注入 handleStagingE2e
 * }} ctx
 * @returns {Promise<null | { skipped?:boolean, reason?:string, ran?:boolean, taskId?:string, verdict?:string, error?:string }>}
 */
export async function tick({ pool, tickState, tickLog, intervalMs, handler } = {}) {
  if (!tickState) throw new Error('staging-e2e-plugin: tickState required');
  const interval = intervalMs ?? STAGING_E2E_INTERVAL_MS;
  const elapsed = Date.now() - (tickState.lastStagingE2eTime || 0);
  if (elapsed < interval) {
    return { skipped: true, reason: 'throttled' };
  }
  tickState.lastStagingE2eTime = Date.now();

  const run = handler || handleStagingE2e;
  try {
    const task = await claimStagingE2eTask(pool);
    if (!task) return { skipped: true, reason: 'no_task' };

    let outcome;
    try {
      outcome = await run(task, { pool });
    } catch (handlerErr) {
      // handleStagingE2e 自身已兜底，这里是双保险
      console.error(`[tick] staging-e2e handler 异常 task=${task.id} (non-fatal): ${handlerErr.message}`);
      outcome = { verdict: 'ERROR', skipReason: 'handler_throw' };
    }

    // staging_e2e 任务本身完成（无论 verdict 如何），verdict 已落 staging_e2e_results。
    // 任务终态统一 completed —— 部署/E2E 的成败由 staging_e2e_results.verdict 表达，
    // 不用 tasks.status=failed（那会触发 watchdog 重派，但这不是该重试的任务）。
    await pool.query(
      `UPDATE tasks SET status = 'completed', completed_at = NOW(), result = $2::jsonb
        WHERE id = $1`,
      [task.id, JSON.stringify({
        verdict: outcome.verdict,
        deploy_status: outcome.deployStatus ?? null,
        skip_reason: outcome.skipReason ?? null,
        staging_e2e_result_id: outcome.resultId ?? null,
      })]
    );

    tickLog?.(`[tick] staging-e2e: task=${task.id} verdict=${outcome.verdict}`);
    return { ran: true, taskId: task.id, verdict: outcome.verdict };
  } catch (err) {
    console.error('[tick] staging-e2e-plugin failed (non-fatal):', err.message);
    return { error: err.message };
  }
}
