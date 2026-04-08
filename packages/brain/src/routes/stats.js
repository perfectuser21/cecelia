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
 *   - excluded: 排除数 (status = cancelled | canceled | paused | queued | in_progress)
 *   - success_rate: 成功率（仅计算终态：completed + failed/quarantined）
 *   - daily_trend: 每日趋势数组
 *   - failure_reasons: 失败原因分类
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * 将 failure_reason（metadata）+ error_message 联合分类为标准类别
 * @param {string|null} reason - metadata->>'failure_reason'
 * @param {string|null} errorMessage - tasks.error_message
 * @returns {string} - 分类：liveness_dead | ci_failure | branch_protection | dev_skill_error | other
 */
function classifyFailureReason(reason, errorMessage) {
  // 优先从 error_message 分类（watchdog/liveness_dead 等常见模式）
  const msg = (errorMessage || '').toLowerCase();
  if (msg.includes('liveness_dead') || msg.includes('watchdog')) {
    return 'liveness_dead';
  }
  if (msg.includes('crisis') || msg.includes('oom') || msg.includes('memory')) {
    return 'resource_pressure';
  }

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

/**
 * 判断任务状态是否为「已排除」（不计入成功率分母）
 * 排除：两种拼写的取消 + paused + 未完成（queued/in_progress）
 */
function isExcludedStatus(status) {
  return status === 'cancelled' || status === 'canceled' || status === 'paused' ||
    status === 'queued' || status === 'in_progress';
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

    // 查询整体统计 + 失败原因（含 metadata + error_message）
    const overallResult = await pool.query(
      `SELECT
         status,
         metadata->>'failure_reason' AS failure_reason,
         error_message,
         COUNT(*) AS cnt
       FROM tasks
       WHERE task_type = 'dev'
         AND created_at >= $1
       GROUP BY status, metadata->>'failure_reason', error_message`,
      [since.toISOString()]
    );

    // 汇总整体统计
    let total = 0;
    let success = 0;
    let failed = 0;
    let excluded = 0;
    const failureReasons = { liveness_dead: 0, resource_pressure: 0, ci_failure: 0, branch_protection: 0, dev_skill_error: 0, other: 0 };

    for (const row of overallResult.rows) {
      const cnt = parseInt(row.cnt, 10);
      total += cnt;
      const status = row.status;

      if (status === 'completed') {
        success += cnt;
      } else if (status === 'failed' || status === 'quarantined') {
        failed += cnt;
        // 从 error_message + failure_reason 联合分类
        const category = classifyFailureReason(row.failure_reason, row.error_message);
        failureReasons[category] = (failureReasons[category] || 0) + cnt;
      } else if (isExcludedStatus(status)) {
        excluded += cnt;
      }
    }

    // 计算成功率（仅基于终态任务：completed + failed/quarantined）
    // 排除：cancelled/canceled（取消）、paused（暂停）、queued/in_progress（未完成）
    const denominator = total - excluded;
    const successRate = denominator > 0 ? Math.round((success / denominator) * 1000) / 10 : 0;

    // 查询每日趋势
    const dailyResult = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status IN ('failed', 'quarantined') THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status IN ('cancelled', 'canceled', 'paused', 'queued', 'in_progress') THEN 1 ELSE 0 END) AS excluded,
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
      const dayExcluded = parseInt(row.excluded, 10);
      const dayDenominator = dayTotal - dayExcluded;
      const dayRate = dayDenominator > 0 ? Math.round((daySuccess / dayDenominator) * 1000) / 10 : 0;

      return {
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date),
        total: dayTotal,
        success: daySuccess,
        failed: dayFailed,
        excluded: dayExcluded,
        success_rate: dayRate,
      };
    });

    return res.json({
      period_days: days,
      total,
      success,
      failed,
      excluded,
      success_rate: successRate,
      daily_trend: dailyTrend,
      failure_reasons: failureReasons,
    });
  } catch (err) {
    console.error('[stats] dev-success-rate query failed:', err.message);
    return res.status(500).json({ error: 'Failed to query dev success rate', details: err.message });
  }
});

// GET /dev-pipeline — dev 任务端到端成功率（pr_merged / total_dev）
router.get('/dev-pipeline', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE payload->>'decomposition' IS DISTINCT FROM 'true') AS total_dev,
        COUNT(*) FILTER (WHERE pr_merged_at IS NOT NULL AND payload->>'decomposition' IS DISTINCT FROM 'true') AS pr_merged,
        COUNT(*) FILTER (WHERE pr_url IS NOT NULL AND payload->>'decomposition' IS DISTINCT FROM 'true') AS pr_created,
        COUNT(*) FILTER (WHERE pr_status = 'ci_passed' AND payload->>'decomposition' IS DISTINCT FROM 'true') AS pr_ci_passed,
        COUNT(*) FILTER (WHERE pr_status = 'ci_failed' AND payload->>'decomposition' IS DISTINCT FROM 'true') AS pr_ci_failed,
        COUNT(*) FILTER (WHERE pr_status IN ('open', 'ci_pending') AND payload->>'decomposition' IS DISTINCT FROM 'true') AS pr_pending
      FROM tasks
      WHERE task_type = 'dev'
    `);

    const totalDev = parseInt(result.rows[0]?.total_dev ?? '0', 10);
    const prMerged = parseInt(result.rows[0]?.pr_merged ?? '0', 10);
    const prCreated = parseInt(result.rows[0]?.pr_created ?? '0', 10);
    const prCiPassed = parseInt(result.rows[0]?.pr_ci_passed ?? '0', 10);
    const prCiFailed = parseInt(result.rows[0]?.pr_ci_failed ?? '0', 10);
    const prPending = parseInt(result.rows[0]?.pr_pending ?? '0', 10);
    const endToEndSuccessRate = totalDev > 0 ? Math.round((prMerged / totalDev) * 1000) / 1000 : 0;

    return res.json({
      end_to_end_success_rate: endToEndSuccessRate,
      pr_merged: prMerged,
      total_dev: totalDev,
      target: 0.70,
      pr_created: prCreated,
      pr_ci_passed: prCiPassed,
      pr_ci_failed: prCiFailed,
      pr_pending: prPending,
    });
  } catch (err) {
    console.error('[stats] dev-pipeline query failed:', err.message);
    return res.status(500).json({ error: 'Failed to query dev pipeline stats', details: err.message });
  }
});

export default router;
