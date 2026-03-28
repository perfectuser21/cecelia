/**
 * publish-monitor.js
 *
 * 发布队列监控器。
 *
 * 每次 Tick 调用 monitorPublishQueue()：
 *   1. 自动重试 failed 的 content_publish 任务（retry_count < MAX_RETRY）
 *   2. 统计今日发布状态，写入 working_memory key='daily_publish_stats'
 *
 * 设计原则：
 *   - fire-and-forget 友好：内部捕获所有异常，不抛出
 *   - 幂等：多次调用结果一致
 */

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 最大重试次数（超过则不再重试，需人工介入） */
const MAX_RETRY = 3;

/** working_memory key：今日发布统计 */
const STATS_KEY = 'daily_publish_stats';

// ─── DB 查询 ──────────────────────────────────────────────────────────────────

/**
 * 查询需要重试的 failed content_publish tasks。
 * 条件：status='failed' AND retry_count < MAX_RETRY AND 今日创建
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
async function fetchRetryableTasks(pool) {
  const { rows } = await pool.query(
    `SELECT id, title, retry_count, payload
     FROM tasks
     WHERE task_type = 'content_publish'
       AND status = 'failed'
       AND retry_count < $1
       AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
     ORDER BY retry_count ASC, created_at ASC`,
    [MAX_RETRY]
  );
  return rows;
}

/**
 * 重置 task 为 queued 状态并增加 retry_count。
 *
 * @param {import('pg').Pool} pool
 * @param {string} taskId
 * @param {number} currentRetry
 */
async function retryTask(pool, taskId, currentRetry) {
  await pool.query(
    `UPDATE tasks
     SET status = 'queued',
         retry_count = $2,
         started_at = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [taskId, currentRetry + 1]
  );
}

/**
 * 统计今日 content_publish tasks 的各状态数量。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<object>} { queued, in_progress, completed, failed, total, platforms }
 */
async function fetchTodayStats(pool) {
  const { rows } = await pool.query(
    `SELECT
       status,
       payload->>'platform' AS platform,
       COUNT(*) AS cnt
     FROM tasks
     WHERE task_type = 'content_publish'
       AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
     GROUP BY status, payload->>'platform'`
  );

  const stats = { queued: 0, in_progress: 0, completed: 0, failed: 0, total: 0 };
  const platformMap = {};

  for (const row of rows) {
    const n = parseInt(row.cnt, 10);
    stats[row.status] = (stats[row.status] || 0) + n;
    stats.total += n;

    const p = row.platform;
    if (p) {
      if (!platformMap[p]) platformMap[p] = { queued: 0, in_progress: 0, completed: 0, failed: 0 };
      platformMap[p][row.status] = (platformMap[p][row.status] || 0) + n;
    }
  }

  const completedCount = stats.completed || 0;
  const totalDone = completedCount + (stats.failed || 0);
  stats.success_rate = totalDone > 0 ? Math.round((completedCount / totalDone) * 100) : null;
  stats.coverage = Object.keys(platformMap).filter(p => platformMap[p].completed > 0).length;
  stats.platforms = platformMap;
  stats.date = new Date().toISOString().slice(0, 10);

  return stats;
}

/**
 * 将统计写入 working_memory。
 *
 * @param {import('pg').Pool} pool
 * @param {object} stats
 */
async function writeStats(pool, stats) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [STATS_KEY, JSON.stringify(stats)]
  );
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 每 tick 调用的发布队列监控器。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{retried: number, stats: object}>}
 */
export async function monitorPublishQueue(pool) {
  let retried = 0;
  let stats = {};

  try {
    // 1. 自动重试失败任务
    const retryable = await fetchRetryableTasks(pool);
    for (const task of retryable) {
      try {
        await retryTask(pool, task.id, task.retry_count);
        retried++;
        const platform = task.payload?.platform || 'unknown';
        console.log(`[publish-monitor] 重试 content_publish: ${platform} (retry ${task.retry_count + 1}/${MAX_RETRY})`);
      } catch (err) {
        console.error(`[publish-monitor] 重试任务 ${task.id} 失败: ${err.message}`);
      }
    }

    // 2. 统计今日状态
    stats = await fetchTodayStats(pool);

    // 3. 写入 working_memory
    await writeStats(pool, stats);

    if (stats.total > 0) {
      const rate = stats.success_rate !== null ? `${stats.success_rate}%` : 'N/A';
      console.log(`[publish-monitor] 今日发布统计: 总数=${stats.total} 完成=${stats.completed} 成功率=${rate} 覆盖平台=${stats.coverage}`);
    }
  } catch (err) {
    console.error(`[publish-monitor] 监控异常: ${err.message}`);
  }

  return { retried, stats };
}

/**
 * 从 working_memory 读取最新发布统计（供 API 调用）。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<object|null>}
 */
export async function getPublishStats(pool) {
  const { rows } = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [STATS_KEY]
  );
  return rows[0]?.value_json || null;
}
