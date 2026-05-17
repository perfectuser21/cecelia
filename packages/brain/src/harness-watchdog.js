/**
 * harness-watchdog.js — Brain 进程级 harness initiative 兜底 watchdog。
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W3
 *
 * 设计理由：
 *   `runHarnessInitiativeRouter` 进程内 setTimeout 触发 abort 是第一道防线，
 *   但若 Brain 进程重启 / setTimeout 被 GC / invoke 卡死不响应 signal，
 *   逾期 initiative 会永远悬空。所以 tick 注册 5min/次扫描兜底：
 *
 *   - 扫 `initiative_runs WHERE phase IN ('A_planning','B_task_loop','C_final_e2e')
 *     AND deadline_at < NOW() AND completed_at IS NULL`
 *   - 标 phase=failed, failure_reason=watchdog_overdue, completed_at=NOW()
 *   - 不删 checkpoint（留诊断）
 *   - 可选 notifier 写 P1 alert（飞书/DB）
 *
 * Spec §W3 反复强调的不变量：
 *   - 不要静默吞错 — failed 路径必须留 failure_reason 文本
 *   - notifier 是 optional dep — 兼容 Brain dev 环境无飞书 token
 *   - 不主动 DELETE FROM checkpoints — 避免误删 in-flight 任务
 */
import pool from './db.js';

/**
 * 扫描所有 in-flight initiative_runs，标 deadline_at 已过未完成的为 watchdog_overdue。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {{ send: (msg: object) => Promise<void> }} [opts.notifier]
 * @returns {Promise<{ flagged: string[], scanned: number }>}
 */
export async function scanStuckHarness({ pool: dbPool = pool, notifier } = {}) {
  const overdue = await dbPool.query(`
    SELECT initiative_id, contract_id, deadline_at, phase
    FROM initiative_runs
    WHERE phase IN ('A_planning', 'B_task_loop', 'C_final_e2e')
      AND deadline_at IS NOT NULL
      AND deadline_at < NOW()
      AND completed_at IS NULL
    ORDER BY deadline_at ASC
    LIMIT 50
  `);

  const flagged = [];
  for (const row of overdue.rows) {
    try {
      await dbPool.query(
        `UPDATE initiative_runs
         SET phase='failed',
             failure_reason='watchdog_overdue',
             completed_at=NOW()
         WHERE initiative_id=$1 AND completed_at IS NULL`,
        [row.initiative_id]
      );
      flagged.push(row.initiative_id);
      console.warn(
        `[harness-watchdog] flagged initiative=${row.initiative_id} ` +
        `phase=${row.phase} deadline=${row.deadline_at?.toISOString?.() || row.deadline_at}`
      );

      if (notifier && typeof notifier.send === 'function') {
        try {
          await notifier.send({
            priority: 'P1',
            title: `Harness watchdog: initiative ${row.initiative_id} overdue`,
            body: `phase=${row.phase} deadline_at=${row.deadline_at}`,
          });
        } catch (notifyErr) {
          console.warn(
            `[harness-watchdog] notifier failed (non-fatal) for ${row.initiative_id}: ${notifyErr.message}`
          );
        }
      }
    } catch (err) {
      console.error(
        `[harness-watchdog] mark failed (initiative=${row.initiative_id}) (non-fatal): ${err.message}`
      );
    }
  }
  return { flagged, scanned: overdue.rows.length };
}

export default { scanStuckHarness };
