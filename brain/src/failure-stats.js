/**
 * failure-stats.js
 * 失败模式趋势分析与根因分类统计
 *
 * 数据来源：
 * - tasks 表：存储任务状态和失败信息
 * - cecelia_events 表：存储事件历史
 *
 * 提供的统计：
 * 1. 失败趋势分析 - 按时间窗口统计失败数量
 * 2. 根因分类 - 按 FAILURE_CLASS 分类统计
 */

import { pool } from '../db.js';
import { FAILURE_CLASS } from './quarantine.js';

/**
 * 失败模式趋势分析
 * @param {number} days - 时间范围（天数）
 * @returns {Promise<Array>} - 趋势数据数组
 */
export async function getFailureTrends(days = 1) {
  try {
    const result = await pool.query(`
      SELECT
        date_trunc('hour', created_at) as hour,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) as total
      FROM tasks
      WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'
        AND status IN ('failed', 'completed')
      GROUP BY date_trunc('hour', created_at)
      ORDER BY hour DESC
    `);

    return result.rows.map(row => ({
      hour: row.hour,
      total: parseInt(row.total) || 0,
      failed: parseInt(row.failed) || 0,
      completed: parseInt(row.completed) || 0,
      failure_rate: row.total > 0 ? (row.failed / row.total) : 0,
    }));
  } catch (err) {
    console.error('[failure-stats] Failed to get trends:', err.message);
    return [];
  }
}

/**
 * 获取根因分类统计
 * @param {number} days - 时间范围（天数）
 * @returns {Promise<Object>} - 分类统计数据
 */
export async function getFailureClassification(days = 7) {
  try {
    const result = await pool.query(`
      SELECT
        payload->'quarantine_info'->>'failure_class' as failure_class,
        COUNT(*) as count
      FROM tasks
      WHERE status = 'quarantined'
        AND created_at > NOW() - INTERVAL '${parseInt(days)} days'
        AND payload->'quarantine_info'->>'failure_class' IS NOT NULL
      GROUP BY payload->'quarantine_info'->>'failure_class'
      ORDER BY count DESC
    `);

    const total = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    const byClass = {};
    for (const row of result.rows) {
      const className = row.failure_class || 'unknown';
      const count = parseInt(row.count) || 0;
      byClass[className] = {
        count,
        percentage: total > 0 ? (count / total * 100).toFixed(1) : 0,
      };
    }

    return {
      total,
      days: parseInt(days),
      by_class: byClass,
    };
  } catch (err) {
    console.error('[failure-stats] Failed to get classification:', err.message);
    return { total: 0, days: parseInt(days), by_class: {} };
  }
}

/**
 * 获取失败概览 Dashboard 数据
 * 整合趋势和分类数据
 * @returns {Promise<Object>}
 */
export async function getFailureDashboard() {
  try {
    const [trends24h, trends7d, classification] = await Promise.all([
      getFailureTrends(1),
      getFailureTrends(7),
      getFailureClassification(7),
    ]);

    // 计算汇总统计
    const last24h = trends24h.reduce((acc, t) => ({
      total: acc.total + t.total,
      failed: acc.failed + t.failed,
      completed: acc.completed + t.completed,
    }), { total: 0, failed: 0, completed: 0 });

    const last7d = trends7d.reduce((acc, t) => ({
      total: acc.total + t.total,
      failed: acc.failed + t.failed,
      completed: acc.completed + t.completed,
    }), { total: 0, failed: 0, completed: 0 });

    return {
      trends: {
        last_24h: trends24h,
        last_7d: trends7d,
      },
      summary: {
        last_24h: {
          total: last24h.total,
          failed: last24h.failed,
          completed: last24h.completed,
          failure_rate: last24h.total > 0 ? (last24h.failed / last24h.total * 100).toFixed(1) : 0,
        },
        last_7d: {
          total: last7d.total,
          failed: last7d.failed,
          completed: last7d.completed,
          failure_rate: last7d.total > 0 ? (last7d.failed / last7d.total * 100).toFixed(1) : 0,
        },
      },
      classification,
    };
  } catch (err) {
    console.error('[failure-stats] Failed to get dashboard:', err.message);
    return {
      trends: { last_24h: [], last_7d: [] },
      summary: { last_24h: {}, last_7d: {} },
      classification: { total: 0, by_class: {} },
    };
  }
}
