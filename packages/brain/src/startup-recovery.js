/**
 * Startup Recovery - Brain 重启后的孤儿任务恢复
 *
 * 问题：Brain 重启时，status=in_progress 的任务因进程被终止无法回调，
 * 导致任务永久卡死（直到 monitor-loop 5 分钟后才发现）。
 *
 * 解决：Brain 启动时立即扫描并重置无心跳的孤儿任务为 queued 状态，
 * 让首次 tick 就能重新派发，而不是等待 5+ 分钟。
 *
 * 安全性：只重置 updated_at 超过 5 分钟的任务，防止误杀刚派发的任务。
 */

const ORPHAN_THRESHOLD_MINUTES = 5;

/**
 * 扫描并重置孤儿 in_progress 任务为 queued
 * @param {import('pg').Pool} pool - pg Pool 实例
 * @returns {Promise<{ requeued: Array<{id:string, title:string}>, error?: string }>}
 */
export async function runStartupRecovery(pool) {
  try {
    // 找出孤儿任务：in_progress 且 updated_at 超过阈值（进程已死）
    const resetResult = await pool.query(`
      UPDATE tasks
      SET status = 'queued', updated_at = NOW()
      WHERE status = 'in_progress'
        AND updated_at < NOW() - INTERVAL '${ORPHAN_THRESHOLD_MINUTES} minutes'
      RETURNING id, title
    `);

    const requeued = resetResult.rows;

    if (requeued.length === 0) {
      console.log('[StartupRecovery] No orphaned tasks found');
      return { requeued: [] };
    }

    const ids = requeued.map(t => t.id);

    // 同步取消对应的僵尸 run_events 记录，防止 monitor-loop 重复检测
    await pool.query(`
      UPDATE run_events
      SET status = 'cancelled', updated_at = NOW()
      WHERE task_id = ANY($1::uuid[])
        AND status = 'running'
    `, [ids]);

    console.log(`[StartupRecovery] Re-queued ${requeued.length} orphaned tasks:`, ids);
    return { requeued };

  } catch (err) {
    // 恢复失败不能阻塞 Brain 启动
    console.error('[StartupRecovery] ERROR: DB query failed, skipping recovery:', err.message);
    return { requeued: [], error: err.message };
  }
}
