/**
 * Stats Routes — dev 任务执行成功率统计
 *
 * GET /dev-success-rate — 获取 dev 任务成功率统计
 *   query: days (默认 7，最大 90) — 统计时间范围
 *
 * 返回:
 *   - period_days: 统计天数
 *   - total: 总任务数
 *   - success: 成功数 (status = completed)
 *   - failed: 失败数 (status = failed | quarantined)
 *   - cancelled: 取消数 (status = cancelled)
 *   - success_rate: 成功率（排除取消）
 *   - daily_trend: 每日趋势数组
 *   - failure_reasons: 失败原因分类
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * 将 failure_reason 字符串分类为标准类别
 * @param {string|null} reason - 原始 failure_reason
 * @returns {string} - 分类：ci_failure | branch_protection | dev_skill_error | other
 */
function classifyFailureReason(reason) {
  if (!reason) return 'other';
  const r = reason.toLowerCase();
  if (r.includes('ci') || r.includes('test') || r.includes('workflow') || r.includes('github action')) {
    return 'ci_failure';
  }
  if (r.includes('branch') || r.includes('protection') || r.includes('push') || r.includes('permission')) {
    return 'branch_protection';
  }
  if (r.includes('dev skill') || r.includes('/dev') || r.includes('skill') || r.includes('step')) {
    return 'dev_skill_error';
  }
  return 'other';
}

// GET /dev-success-rate — dev 任务成功率统计
router.get('/dev-success-rate', async (req, res) => {
  try {
    // 参数验证
    const daysParam = req.query.days ?? '7';
    const days = parseInt(daysParam, 10);

    if (isNaN(days) || !isFinite(days)) {
      return res.status(400).json({ error: 'Invalid days parameter: must be a number' });
    }
    if (days <= 0) {
      return res.status(400).json({ error: 'Invalid days parameter: must be > 0' });
    }
    if (days > 90) {
      return res.status(400).json({ error: 'Invalid days parameter: must be <= 90' });
    }

    // 计算时间范围
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // 查询整体统计 + 失败原因（含 metadata）
    const overallResult = await pool.query(
      `SELECT
         status,
         metadata->>'failure_reason' AS failure_reason,
         COUNT(*) AS cnt
       FROM tasks
       WHERE task_type = 'dev'
         AND created_at >= $1
       GROUP BY status, metadata->>'failure_reason'`,
      [since.toISOString()]
    );

    // 汇总整体统计
    let total = 0;
    let success = 0;
    let failed = 0;
    let cancelled = 0;
    const failureReasons = { ci_failure: 0, branch_protection: 0, dev_skill_error: 0, other: 0 };

    for (const row of overallResult.rows) {
      const cnt = parseInt(row.cnt, 10);
      total += cnt;
      const status = row.status;

      if (status === 'completed') {
        success += cnt;
      } else if (status === 'failed' || status === 'quarantined') {
        failed += cnt;
        // 分类失败原因
        const category = classifyFailureReason(row.failure_reason);
        failureReasons[category] += cnt;
      } else if (status === 'cancelled') {
        cancelled += cnt;
      }
    }

    // 计算成功率（排除取消的任务）
    const denominator = total - cancelled;
    const successRate = denominator > 0 ? Math.round((success / denominator) * 1000) / 10 : 0;

    // 查询每日趋势
    const dailyResult = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status IN ('failed', 'quarantined') THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         COUNT(*) AS total
       FROM tasks
       WHERE task_type = 'dev'
         AND created_at >= $1
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [since.toISOString()]
    );

    const dailyTrend = dailyResult.rows.map(row => {
      const dayTotal = parseInt(row.total, 10);
      const daySuccess = parseInt(row.success, 10);
      const dayFailed = parseInt(row.failed, 10);
      const dayCancelled = parseInt(row.cancelled, 10);
      const dayDenominator = dayTotal - dayCancelled;
      const dayRate = dayDenominator > 0 ? Math.round((daySuccess / dayDenominator) * 1000) / 10 : 0;

      return {
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
        total: dayTotal,
        success: daySuccess,
        failed: dayFailed,
        cancelled: dayCancelled,
        success_rate: dayRate,
      };
    });

    return res.json({
      period_days: days,
      total,
      success,
      failed,
      cancelled,
      success_rate: successRate,
      daily_trend: dailyTrend,
      failure_reasons: failureReasons,
    });
  } catch (err) {
    console.error('[stats] dev-success-rate query failed:', err.message);
    return res.status(500).json({ error: 'Failed to query dev success rate', details: err.message });
  }
});

export default router;
