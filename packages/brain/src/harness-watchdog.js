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

/**
 * resumeStalledHarnessDrivers — OPEN-2 看门狗：重排「驱动器已死」的 parked harness 任务。
 *
 * 根因：harness_initiative parent graph 在 planner interrupt 后由 planner-callback 的
 * 一次性 in-memory invoke 同步驱动到 END。驱动器丢失（brain 重启/部署/异常）后，任务 park
 * 在非-END checkpoint。dispatcher 只 claim queued、唯一 re-driver startup-sync 仅 boot 跑
 * → 任务死等下次重启。本看门狗把它做成 tick 级周期版。
 *
 * 安全设计（杜绝双驱动 / 误杀合法等待）：
 *   - 只扫 phase='B_task_loop'（run_sub_task 阻塞区）。**排除 A_planning**——那是 planner
 *     在 interrupt 等容器 callback 的合法状态，无 in-brain 驱动器是预期的，重排会 thrash。
 *   - 只重排 driver_heartbeat_at 陈旧(>staleMinutes)或 NULL 的任务。活驱动（run_sub_task
 *     的 _waitForSubGraphCompletion）每 ~30s 刷心跳 → 心跳新鲜必然=活驱动在 pump（不动）。
 *   - 重排 = status→queued + resume_from_checkpoint=true（executor 走 resume 续 checkpoint）
 *     + 清 claim 三件套（否则 dispatcher 的 claimed_by IS NULL 永远选不出 → 死锁）。
 *   - UPDATE 带 `AND status='in_progress'` 原子守卫，防两个并发 tick 双翻。
 *   - 重排任务在 dispatcher 侧豁免并发 cap（见 dispatcher.js::shouldApplyHarnessCap），
 *     否则其它活跑占满 cap 时自愈被 cap 锁死。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {number} [opts.staleMinutes=3]  心跳陈旧阈值（分钟）
 * @returns {Promise<{ resumed: string[], scanned: number }>}
 */
export async function resumeStalledHarnessDrivers({ pool: dbPool = pool, staleMinutes = 3 } = {}) {
  const stalled = await dbPool.query(
    `SELECT t.id
       FROM tasks t
       JOIN initiative_runs ir ON ir.initiative_id = t.id
      WHERE t.task_type = 'harness_initiative'
        AND t.status = 'in_progress'
        AND ir.phase = 'B_task_loop'
        AND ir.completed_at IS NULL
        AND (t.driver_heartbeat_at IS NULL
             OR t.driver_heartbeat_at < NOW() - ($1 || ' minutes')::interval)
      ORDER BY t.driver_heartbeat_at ASC NULLS FIRST
      LIMIT 20`,
    [String(staleMinutes)]
  );

  const resumed = [];
  for (const row of stalled.rows) {
    try {
      const upd = await dbPool.query(
        `UPDATE tasks SET
           status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           started_at = NULL,
           payload = COALESCE(payload, '{}'::jsonb) || '{"resume_from_checkpoint": true}'::jsonb,
           updated_at = NOW()
         WHERE id = $1 AND status = 'in_progress'
         RETURNING id`,
        [row.id]
      );
      if (upd.rows.length > 0) {
        resumed.push(row.id);
        console.warn(
          `[harness-watchdog] resumed stalled driver: task=${row.id} ` +
          `(driver_heartbeat stale >${staleMinutes}min, phase=B_task_loop → re-queue resume_from_checkpoint)`
        );
      }
    } catch (err) {
      console.error(
        `[harness-watchdog] resume stalled driver failed (task=${row.id}) (non-fatal): ${err.message}`
      );
    }
  }
  return { resumed, scanned: stalled.rows.length };
}

export default { scanStuckHarness, resumeStalledHarnessDrivers };
