/**
 * Backlog Alert - 队列积压阈值告警
 *
 * queue_depth > 10 时向 Alex 发送飞书告警，30 分钟内最多发一次。
 * 告警内容：当前队列深度、积压最久的任务标题、24h 完成率。
 *
 * 使用方式（在 tick 中调用）：
 *   import { checkBacklogAlert } from './backlog-alert.js';
 *   await checkBacklogAlert(pool);
 */

import { sendFeishu } from './notifier.js';

export const BACKLOG_THRESHOLD = 10;
export const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 分钟

// 内存状态：上次告警时间戳
let _lastBacklogAlertAt = 0;

/**
 * 检查队列积压并在超阈值时发送告警
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ alerted: boolean, queue_depth: number, reason?: string }>}
 */
export async function checkBacklogAlert(pool) {
  // 1. 查询当前队列深度
  const depthResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'queued'`
  );
  const queueDepth = parseInt(depthResult.rows[0]?.cnt ?? 0, 10);

  if (queueDepth <= BACKLOG_THRESHOLD) {
    return { alerted: false, queue_depth: queueDepth, reason: 'below_threshold' };
  }

  // 2. 30 分钟限流
  const now = Date.now();
  if (now - _lastBacklogAlertAt < ALERT_COOLDOWN_MS) {
    return { alerted: false, queue_depth: queueDepth, reason: 'rate_limited' };
  }

  // 3. 查询积压最久的任务
  const oldestResult = await pool.query(`
    SELECT title, created_at
    FROM tasks
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const oldest = oldestResult.rows[0];
  const oldestTitle = oldest?.title ?? '(未知)';
  const oldestAgeMin = oldest?.created_at
    ? Math.round((now - new Date(oldest.created_at).getTime()) / 60000)
    : null;

  // 4. 查询 24h 完成率
  const rateResult = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) AS total
    FROM tasks
    WHERE updated_at >= NOW() - INTERVAL '24 hours'
  `);
  const completed = parseInt(rateResult.rows[0]?.completed ?? 0, 10);
  const total = parseInt(rateResult.rows[0]?.total ?? 0, 10);
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : null;

  // 5. 构造告警内容
  const ageStr = oldestAgeMin !== null ? `（积压 ${oldestAgeMin} 分钟）` : '';
  const rateStr = completionRate !== null ? `24h 完成率：${completionRate}%` : '';
  const lines = [
    `🚨 队列积压告警`,
    `当前队列深度：${queueDepth} 个任务（阈值 > ${BACKLOG_THRESHOLD}）`,
    `积压最久任务：${oldestTitle}${ageStr}`,
  ];
  if (rateStr) lines.push(rateStr);
  const text = lines.join('\n');

  // 6. 发送并更新时间戳
  _lastBacklogAlertAt = now;
  console.log(`[backlog-alert] 发送告警，queue_depth=${queueDepth}`);
  sendFeishu(text).catch(e => console.error('[backlog-alert] 告警发送失败:', e.message));

  return { alerted: true, queue_depth: queueDepth, oldest_task: oldestTitle };
}
