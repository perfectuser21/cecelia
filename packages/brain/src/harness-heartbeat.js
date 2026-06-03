/**
 * harness-heartbeat.js — harness_initiative 驱动器心跳。
 *
 * OPEN-2 修复的一半：活驱动每 ~30s 调 writeDriverHeartbeat 把 tasks.driver_heartbeat_at
 * 刷到 NOW()。看门狗（harness-watchdog.js::resumeStalledHarnessDrivers）据此判断
 * 「驱动器是否还活着」——心跳新鲜 = 有活驱动在 pump（别动），心跳陈旧 = 驱动器已死（重排）。
 *
 * 调用点：
 *   - executor.js runHarnessInitiativeRouter（驱动开始 + 每个 stream node 推进）
 *   - harness-initiative.graph.js _waitForSubGraphCompletion（run_sub_task 每轮 poll）
 *
 * 不变量：心跳失败必须 non-fatal——绝不能因为一次 DB 抖动把正在跑的 graph 拖垮。
 */

/**
 * 刷 harness_initiative 任务的驱动器心跳。
 *
 * @param {{ query: Function }} dbPool
 * @param {string|null|undefined} initiativeId  harness_initiative 任务 id（= initiativeId）
 * @returns {Promise<void>}
 */
export async function writeDriverHeartbeat(dbPool, initiativeId) {
  if (!dbPool || !initiativeId) return;
  try {
    await dbPool.query(
      `UPDATE tasks SET driver_heartbeat_at = NOW()
       WHERE id = $1 AND task_type = 'harness_initiative'`,
      [initiativeId]
    );
  } catch (err) {
    // non-fatal：心跳只是看门狗的辅助信号，写失败最坏导致一次误判重排（幂等 resume 安全）
    console.warn(`[harness-heartbeat] writeDriverHeartbeat failed (non-fatal) initiative=${initiativeId}: ${err.message}`);
  }
}

export default { writeDriverHeartbeat };
