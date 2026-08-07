/**
 * task-event-log.js — watchdog/dispatch 处置留痕统一写入（task 94ee0ec4）。
 *
 * 失败语义（合同「失败语义声明」表）：处置动作必须落 task_events 行（含 event_type
 * 与 payload 摘要）；写事件失败仅告警不阻断处置（可观测降级，不影响主链）。
 */

/**
 * 写一条 task_events 处置留痕行。绝不抛错——写失败只 console.warn。
 *
 * @param {import('pg').Pool} pool - pg 连接池
 * @param {string} taskId - 任务 ID
 * @param {string} eventType - 处置事件类型（如 watchdog_requeue / watchdog_safe_requeue /
 *   watchdog_headed_requeue / watchdog_quarantine / failed_dispatch）
 * @param {Object} [payload={}] - 处置摘要（reason / evidence 等）
 * @returns {Promise<boolean>} - 是否写入成功
 */
export async function recordTaskEventSafe(pool, taskId, eventType, payload = {}) {
  try {
    await pool.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at)
       VALUES ($1, $2, $3::jsonb, NOW())`,
      [taskId, eventType, JSON.stringify(payload)]
    );
    return true;
  } catch (err) {
    console.warn(`[task-event-log] 处置留痕写入失败（不阻断处置） task=${taskId} type=${eventType}: ${err.message}`);
    return false;
  }
}
