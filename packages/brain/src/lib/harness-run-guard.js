/**
 * harness-run-guard.js — initiative_runs 活性判据的唯一出处(TOP2 刀1,2026-08-07)
 *
 * 背景(当晚三条 harness_initiative 全灭):
 *   spawn 侧按"该 task 还有非终态且未过期的 initiative_runs 行"拒绝重复 spawn,
 *   收割侧(orphan-guard)却只把 tasks 打回 queued、完全不动 initiative_runs。
 *   两边判据分叉的后果是死锁:
 *     容器死 → 收割 requeue → dispatcher 重派 → spawn-guard 见活跃 run 拒绝
 *     → 任务留在 in_progress → 下轮再收割 → requeue 超限 → 终态 failed。
 *   实测日志里 "refusing duplicate spawn" 与 "requeued (第N次)" 交替刷了 40 分钟,
 *   W1/W2/W3 三条全灭,一条都没能重跑。
 *
 * 药:判据收成一处。spawn 侧调 findActiveRunBlockingSpawn 判拒,
 * 收割侧调 terminalizeRunsForTask 按同一判据清场——不可能再分叉。
 *
 * 两个函数都 fail-open / 不抛:DB 抽风不能挡住正常调度,也不能拖死收割主流程。
 */

/** 孤儿收割终态化 run 时写进 failure_reason 的死因标记。 */
export const ORPHAN_RUN_FAILURE_REASON = 'container_orphaned';

/** 复活流程终态化残留 run 时的死因标记(与收割区分,便于事后归因)。 */
export const REVIVED_RUN_FAILURE_REASON = 'container_orphaned_revived';

/**
 * 该 task 是否有会挡住重新 spawn 的活跃 run。
 * @returns {Promise<{id: string}|null>} 挡路的 run 行;无则 null
 */
export async function findActiveRunBlockingSpawn(pool, taskId) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM initiative_runs
       WHERE current_task_id = $1
         AND phase NOT IN ('done','failed')
         AND deadline_at > NOW()
       LIMIT 1`,
      [taskId]
    );
    return rows[0] || null;
  } catch (err) {
    // fail-open:DB 报错时保守放行,不能让 DB 抽风挡住正常调度
    console.warn(`[run-guard] 活跃 run 查询失败(保守放行): ${err.message}`);
    return null;
  }
}

/**
 * 把该 task 名下所有非终态 run 打成 failed —— 与 findActiveRunBlockingSpawn 同一把尺子,
 * 清完必然放行。只动非终态行,已 done 的成功记录绝不覆盖。
 * @returns {Promise<{ok: boolean, terminalized: number}>}
 */
export async function terminalizeRunsForTask(pool, taskId, reason) {
  try {
    const { rowCount } = await pool.query(
      `UPDATE initiative_runs
       SET phase = 'failed',
           failure_reason = COALESCE(failure_reason, $2),
           completed_at = COALESCE(completed_at, NOW()),
           updated_at = NOW()
       WHERE current_task_id = $1
         AND phase NOT IN ('done','failed')`,
      [taskId, reason]
    );
    if (rowCount > 0) {
      console.warn(`[run-guard] task=${taskId} 终态化 ${rowCount} 条残留 run (${reason})`);
    }
    return { ok: true, terminalized: rowCount || 0 };
  } catch (err) {
    // 不抛:收割/复活主流程不能被它拖死,下一轮扫描还会再试
    console.error(`[run-guard] task=${taskId} 终态化 run 失败: ${err.message}`);
    return { ok: false, terminalized: 0 };
  }
}
