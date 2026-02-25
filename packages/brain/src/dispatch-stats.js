/**
 * dispatch-stats.js
 * 派发成功率统计 - 维护 1 小时滚动窗口
 *
 * 数据存储在 working_memory key: dispatch_stats
 * 格式：
 * {
 *   window_1h: {
 *     total: number,
 *     success: number,
 *     failed: number,
 *     rate: number|null,
 *     last_updated: string,
 *     failure_reasons: { [reason]: number }
 *   },
 *   events: [{ ts: string, success: boolean, reason?: string }]
 * }
 *
 * events 数组只保留 1 小时内的条目，用于滚动统计。
 */

export const DISPATCH_STATS_KEY = 'dispatch_stats';
export const WINDOW_MS = 60 * 60 * 1000; // 1 小时
export const DISPATCH_RATE_THRESHOLD = 0.3; // 成功率低于 30% 触发熔断
export const DISPATCH_MIN_SAMPLE = 10;     // 最低样本数

/**
 * 读取当前 dispatch_stats（从 DB）
 * @param {object} pool - pg 连接池
 */
export async function readDispatchStats(pool) {
  const result = await pool.query(
    'SELECT value_json FROM working_memory WHERE key = $1',
    [DISPATCH_STATS_KEY]
  );
  if (result.rows.length === 0) {
    return { events: [] };
  }
  const data = result.rows[0].value_json;
  // 兼容旧格式
  if (!data.events) {
    data.events = [];
  }
  return data;
}

/**
 * 写入 dispatch_stats 到 DB
 * @param {object} pool
 * @param {object} data
 */
export async function writeDispatchStats(pool, data) {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [DISPATCH_STATS_KEY, data]);
}

/**
 * 计算 1 小时窗口内的统计（纯函数，便于测试）
 * @param {Array} events - 事件数组 [{ ts, success, reason? }]
 * @param {number} now - 当前时间戳（ms）
 */
export function computeWindow1h(events, now) {
  const cutoff = now - WINDOW_MS;
  const recent = events.filter(e => new Date(e.ts).getTime() >= cutoff);

  const total = recent.length;
  const success = recent.filter(e => e.success).length;
  const failed = total - success;
  const rate = total > 0 ? success / total : null;

  const failure_reasons = {};
  for (const e of recent) {
    if (!e.success && e.reason) {
      failure_reasons[e.reason] = (failure_reasons[e.reason] || 0) + 1;
    }
  }

  return {
    total,
    success,
    failed,
    rate,
    failure_reasons
  };
}

/**
 * 记录一次派发结果到 dispatch_stats（纯监控，不影响派发逻辑）
 * @param {object} pool - pg 连接池
 * @param {boolean} success - 是否成功派发
 * @param {string|null} reason - 失败原因（success=false 时提供）
 * @param {number} [nowMs] - 当前时间戳（可注入，便于测试）
 */
export async function recordDispatchResult(pool, success, reason = null, nowMs) {
  const now = nowMs !== undefined ? nowMs : Date.now();
  const ts = new Date(now).toISOString();

  try {
    // 读取现有数据
    const data = await readDispatchStats(pool);

    // 追加新事件
    const event = { ts, success };
    if (!success && reason) {
      event.reason = reason;
    }
    data.events.push(event);

    // 裁剪：只保留 1 小时内的事件（滚动窗口）
    const cutoff = now - WINDOW_MS;
    data.events = data.events.filter(e => new Date(e.ts).getTime() >= cutoff);

    // 重新计算窗口统计
    data.window_1h = {
      ...computeWindow1h(data.events, now),
      last_updated: ts
    };

    // 写回 DB
    await writeDispatchStats(pool, data);
  } catch (err) {
    // 统计失败不影响主流程
    console.error(`[dispatch-stats] 记录失败: ${err.message}`);
  }
}

/**
 * 获取当前 dispatch_stats（用于 API 返回）
 * @param {object} pool
 * @param {number} [nowMs] - 可注入时间（测试用）
 */
export async function getDispatchStats(pool, nowMs) {
  const now = nowMs !== undefined ? nowMs : Date.now();
  const data = await readDispatchStats(pool);

  // 实时计算（使用最新时间，过期数据不计入）
  const window_1h = {
    ...computeWindow1h(data.events || [], now),
    last_updated: new Date(now).toISOString()
  };

  return { window_1h };
}
