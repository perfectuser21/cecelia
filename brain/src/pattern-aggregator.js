/**
 * pattern-aggregator.js
 * 失败模式聚合引擎
 *
 * 功能：
 * - 日/周聚合报告生成
 * - 自动模式发现
 * - 增量聚合优化性能
 */

import { pool } from './db.js';

/**
 * 获取日聚合报告
 * @param {number} days - 返回最近N天的数据
 * @returns {Promise<Array>}
 */
export async function getDailyAggregation(days = 7) {
  try {
    const result = await pool.query(`
      SELECT
        DATE_TRUNC('day', created_at) as date,
        COUNT(*) FILTER (WHERE status = 'failed') as failure_count,
        COUNT(*) FILTER (WHERE status = 'completed') as success_count,
        COUNT(*) as total_runs
      FROM tasks
      WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'
        AND status IN ('failed', 'completed')
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date DESC
    `);

    return result.rows.map(row => ({
      date: row.date,
      total_runs: parseInt(row.total_runs) || 0,
      success_count: parseInt(row.success_count) || 0,
      failure_count: parseInt(row.failure_count) || 0,
      failure_rate: row.total_runs > 0
        ? (row.failure_count / row.total_runs * 100).toFixed(2)
        : 0,
    }));
  } catch (err) {
    console.error('[pattern-aggregator] Failed to get daily aggregation:', err.message);
    return [];
  }
}

/**
 * 获取周聚合报告
 * @param {number} weeks - 返回最近N周的数据
 * @returns {Promise<Array>}
 */
export async function getWeeklyAggregation(weeks = 4) {
  try {
    const result = await pool.query(`
      SELECT
        DATE_TRUNC('week', created_at) as week_start,
        DATE_TRUNC('week', created_at) + INTERVAL '1 week' - INTERVAL '1 second' as week_end,
        COUNT(*) FILTER (WHERE status = 'failed') as failure_count,
        COUNT(*) FILTER (WHERE status = 'completed') as success_count,
        COUNT(*) as total_runs
      FROM tasks
      WHERE created_at > NOW() - INTERVAL '${parseInt(weeks * 7)} days'
        AND status IN ('failed', 'completed')
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week_start DESC
    `);

    return result.rows.map(row => ({
      week_start: row.week_start,
      week_end: row.week_end,
      total_runs: parseInt(row.total_runs) || 0,
      success_count: parseInt(row.success_count) || 0,
      failure_count: parseInt(row.failure_count) || 0,
      failure_rate: row.total_runs > 0
        ? (row.failure_count / row.total_runs * 100).toFixed(2)
        : 0,
    }));
  } catch (err) {
    console.error('[pattern-aggregator] Failed to get weekly aggregation:', err.message);
    return [];
  }
}

/**
 * 获取聚合报告（统一入口）
 * @param {string} period - daily 或 weekly
 * @param {number} limit - 返回数量
 * @returns {Promise<Object>}
 */
export async function getAggregationReport(period = 'daily', limit = 7) {
  if (period === 'weekly') {
    const data = await getWeeklyAggregation(limit);
    return { period, data };
  }
  const data = await getDailyAggregation(limit);
  return { period, data };
}

/**
 * 自动发现新的失败模式
 * 基于频率分析，识别频繁出现的错误
 * @param {number} minFrequency - 最小出现次数
 * @returns {Promise<Array>}
 */
export async function discoverPatterns(minFrequency = 3) {
  try {
    // 从 quarantined 任务中提取失败模式
    const result = await pool.query(`
      SELECT
        payload->>'error' as error_text,
        payload->'quarantine_info'->>'failure_class' as failure_class,
        COUNT(*) as frequency,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen
      FROM tasks
      WHERE status = 'quarantined'
        AND payload->>'error' IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY payload->>'error', payload->'quarantine_info'->>'failure_class'
      HAVING COUNT(*) >= $1
      ORDER BY frequency DESC
      LIMIT 50
    `, [minFrequency]);

    // 过滤掉已存在于 learned_patterns 的模式
    const learnedPatterns = await pool.query(
      'SELECT pattern FROM learned_patterns'
    );
    const learnedSet = new Set(learnedPatterns.rows.map(r => r.pattern));

    return result.rows
      .filter(row => !learnedSet.has(row.error_text?.substring(0, 100)))
      .map(row => ({
        pattern: row.error_text?.substring(0, 100),
        frequency: parseInt(row.frequency),
        failure_class: row.failure_class,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      }));
  } catch (err) {
    console.error('[pattern-aggregator] Failed to discover patterns:', err.message);
    return [];
  }
}

/**
 * 获取顶级错误类型统计
 * @param {string} period - daily 或 weekly
 * @param {number} days - 天数
 * @returns {Promise<Array>}
 */
export async function getTopErrorTypes(period = 'daily', days = 7) {
  try {
    const interval = period === 'weekly' ? 'week' : 'day';
    const result = await pool.query(`
      SELECT
        payload->'quarantine_info'->>'failure_class' as error_type,
        COUNT(*) as count
      FROM tasks
      WHERE status = 'quarantined'
        AND created_at > NOW() - INTERVAL '${parseInt(days)} days'
        AND payload->'quarantine_info'->>'failure_class' IS NOT NULL
      GROUP BY payload->'quarantine_info'->>'failure_class'
      ORDER BY count DESC
      LIMIT 10
    `);

    return result.rows.map(row => ({
      error_type: row.error_type,
      count: parseInt(row.count),
    }));
  } catch (err) {
    console.error('[pattern-aggregator] Failed to get top error types:', err.message);
    return [];
  }
}
