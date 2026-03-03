/**
 * Report Scheduler - 48h 系统简报自动生成
 *
 * 负责：
 * 1. 检查是否到达 48h 报告时间点（checkScheduledReport）
 * 2. 生成系统简报（generateSystemReport）
 * 3. 保存到 reports 表
 * 4. 通过 WebSocket 推送到前端
 *
 * 配置：
 * - REPORT_INTERVAL_HOURS: 报告间隔（默认 48 小时）
 * - 从 working_memory 表读取 last_report_time
 */

import pool from './db.js';
import { callLLM } from './llm-caller.js';
import { broadcast } from './websocket.js';

// 默认 48 小时，可通过环境变量覆盖（测试时可设为 0 或很小的值）
const REPORT_INTERVAL_HOURS = parseInt(
  process.env.REPORT_INTERVAL_HOURS || '48',
  10
);

const LAST_REPORT_KEY = 'last_report_time';

/**
 * 检查是否需要生成定期简报
 * 由 tick.js 在每次 executeTick 中调用
 *
 * @param {import('pg').Pool} [dbPool] - 可选的数据库连接池（默认使用全局 pool）
 * @returns {Promise<boolean>} 是否触发了报告生成
 */
export async function checkScheduledReport(dbPool = pool) {
  try {
    // 读取上次报告时间
    const result = await dbPool.query(
      `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
      [LAST_REPORT_KEY]
    );

    const now = new Date();

    if (result.rows.length === 0) {
      // 从未生成过报告，立即生成
      console.log('[report-scheduler] No previous report found, generating first report');
      await generateSystemReport(dbPool);
      await _updateLastReportTime(dbPool, now);
      return true;
    }

    const lastReportData = result.rows[0].value_json;
    const lastReportTime = new Date(lastReportData.timestamp);
    const elapsedHours = (now - lastReportTime) / (1000 * 60 * 60);

    if (REPORT_INTERVAL_HOURS === 0 || elapsedHours >= REPORT_INTERVAL_HOURS) {
      console.log(
        `[report-scheduler] ${elapsedHours.toFixed(1)}h since last report (threshold: ${REPORT_INTERVAL_HOURS}h), generating...`
      );
      await generateSystemReport(dbPool);
      await _updateLastReportTime(dbPool, now);
      return true;
    }

    return false;
  } catch (err) {
    console.error('[report-scheduler] checkScheduledReport failed (non-fatal):', err.message);
    return false;
  }
}

/**
 * 更新 working_memory 中的上次报告时间
 * @param {import('pg').Pool} dbPool
 * @param {Date} timestamp
 */
async function _updateLastReportTime(dbPool, timestamp) {
  await dbPool.query(
    `INSERT INTO working_memory (key, value_json)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [LAST_REPORT_KEY, JSON.stringify({ timestamp: timestamp.toISOString() })]
  );
}

/**
 * 生成系统简报
 * 查询过去 N 小时的任务统计和系统健康数据，调用 LLM 生成摘要，
 * 保存到 reports 表，并通过 WebSocket 推送到前端。
 *
 * @param {import('pg').Pool} [dbPool] - 可选的数据库连接池
 * @returns {Promise<Object>} 生成的报告对象
 */
export async function generateSystemReport(dbPool = pool) {
  const intervalHours = REPORT_INTERVAL_HOURS || 48;
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd - intervalHours * 60 * 60 * 1000);

  console.log(`[report-scheduler] Generating ${intervalHours}h report: ${periodStart.toISOString()} ~ ${periodEnd.toISOString()}`);

  // 1. 收集任务统计数据
  const taskStats = await _collectTaskStats(dbPool, periodStart, periodEnd);

  // 2. 收集系统健康数据
  const healthData = await _collectHealthData(dbPool);

  // 3. 收集重要事件
  const recentEvents = await _collectRecentEvents(dbPool, periodStart, periodEnd);

  // 4. 构建基础简报内容
  const reportContent = {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      interval_hours: intervalHours,
    },
    tasks: taskStats,
    health: healthData,
    recent_events: recentEvents,
    summary: null, // 将被 LLM 填充
  };

  // 5. 尝试 LLM 生成摘要（失败则降级为纯统计）
  let summary = null;
  let generatedBy = 'stats_only';
  try {
    summary = await _generateLLMSummary(reportContent);
    generatedBy = 'cortex';
    reportContent.summary = summary;
  } catch (llmErr) {
    console.warn('[report-scheduler] LLM summary failed, falling back to stats-only:', llmErr.message);
    summary = _generateFallbackSummary(reportContent);
    reportContent.summary = summary;
  }

  // 6. 确定健康状态
  const healthStatus = _determineHealthStatus(taskStats, healthData);

  // 7. 保存到数据库
  let reportId = null;
  try {
    const insertResult = await dbPool.query(
      `INSERT INTO reports (
        report_type, interval_hours, period_start, period_end,
        content, summary, tasks_completed, tasks_failed, tasks_total,
        health_status, generated_by
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        'system_48h',
        intervalHours,
        periodStart,
        periodEnd,
        JSON.stringify(reportContent),
        summary,
        taskStats.completed,
        taskStats.failed,
        taskStats.total,
        healthStatus,
        generatedBy,
      ]
    );
    reportId = insertResult.rows[0]?.id;
    console.log(`[report-scheduler] Report saved: ${reportId}`);
  } catch (dbErr) {
    console.error('[report-scheduler] Failed to save report to DB:', dbErr.message);
  }

  // 8. 通过 WebSocket 推送
  let pushed = false;
  try {
    broadcast('report_generated', {
      report_id: reportId,
      report_type: 'system_48h',
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      summary,
      tasks_completed: taskStats.completed,
      tasks_failed: taskStats.failed,
      tasks_total: taskStats.total,
      health_status: healthStatus,
      generated_at: new Date().toISOString(),
    });
    pushed = true;

    // 更新推送状态
    if (reportId) {
      await dbPool.query(
        `UPDATE reports SET pushed_to_ws = true WHERE id = $1`,
        [reportId]
      ).catch(() => {}); // 非关键，失败不抛出
    }
  } catch (wsErr) {
    console.warn('[report-scheduler] WebSocket push failed (non-fatal):', wsErr.message);
  }

  const report = {
    id: reportId,
    period_start: periodStart,
    period_end: periodEnd,
    content: reportContent,
    summary,
    tasks_completed: taskStats.completed,
    tasks_failed: taskStats.failed,
    tasks_total: taskStats.total,
    health_status: healthStatus,
    generated_by: generatedBy,
    pushed_to_ws: pushed,
  };

  console.log(
    `[report-scheduler] Report complete: ${taskStats.completed} completed, ${taskStats.failed} failed, health=${healthStatus}`
  );

  return report;
}

/**
 * 收集过去 N 小时的任务统计
 */
async function _collectTaskStats(dbPool, periodStart, periodEnd) {
  try {
    const result = await dbPool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('completed', 'done')) AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('queued', 'in_progress')) AS active
       FROM tasks
       WHERE created_at BETWEEN $1 AND $2`,
      [periodStart, periodEnd]
    );
    const row = result.rows[0] || {};
    return {
      completed: parseInt(row.completed || 0, 10),
      failed: parseInt(row.failed || 0, 10),
      quarantined: parseInt(row.quarantined || 0, 10),
      total: parseInt(row.total || 0, 10),
      active: parseInt(row.active || 0, 10),
      success_rate: row.total > 0
        ? Math.round((parseInt(row.completed || 0, 10) / parseInt(row.total, 10)) * 100)
        : 0,
    };
  } catch (err) {
    console.error('[report-scheduler] _collectTaskStats failed:', err.message);
    return { completed: 0, failed: 0, quarantined: 0, total: 0, active: 0, success_rate: 0 };
  }
}

/**
 * 收集系统健康指标
 */
async function _collectHealthData(dbPool) {
  try {
    // 查询队列状态
    const queueResult = await dbPool.query(
      `SELECT status, COUNT(*) AS cnt FROM tasks
       WHERE status IN ('queued', 'in_progress', 'failed')
       GROUP BY status`
    );

    const queueMap = {};
    for (const row of queueResult.rows) {
      queueMap[row.status] = parseInt(row.cnt, 10);
    }

    return {
      queued: queueMap['queued'] || 0,
      in_progress: queueMap['in_progress'] || 0,
      recent_failures: queueMap['failed'] || 0,
      tick_interval_minutes: parseInt(process.env.TICK_INTERVAL_MINUTES || '2', 10),
    };
  } catch (err) {
    console.error('[report-scheduler] _collectHealthData failed:', err.message);
    return { queued: 0, in_progress: 0, recent_failures: 0 };
  }
}

/**
 * 收集最近重要事件
 */
async function _collectRecentEvents(dbPool, periodStart, periodEnd) {
  try {
    const result = await dbPool.query(
      `SELECT event_type, payload, created_at
       FROM cecelia_events
       WHERE created_at BETWEEN $1 AND $2
         AND event_type IN ('task_failed', 'task_quarantined', 'alertness_panic', 'circuit_breaker_open')
       ORDER BY created_at DESC
       LIMIT 20`,
      [periodStart, periodEnd]
    );
    return result.rows.map(row => ({
      event_type: row.event_type,
      created_at: row.created_at,
      summary: row.payload?.summary || row.payload?.message || null,
    }));
  } catch (err) {
    // cecelia_events 表可能不存在或结构不同，非关键
    return [];
  }
}

/**
 * 调用 LLM 生成简报摘要
 */
async function _generateLLMSummary(reportContent) {
  const { tasks, health, recent_events, period } = reportContent;

  const prompt = `你是 Cecelia 的系统简报生成器。请根据以下 ${period.interval_hours}h 系统运行数据，生成一段简洁的中文摘要（200字以内）。

## 任务统计
- 完成: ${tasks.completed} 个
- 失败: ${tasks.failed} 个
- 隔离: ${tasks.quarantined} 个
- 合计: ${tasks.total} 个
- 成功率: ${tasks.success_rate}%
- 当前活跃: ${tasks.active} 个

## 队列状态
- 排队中: ${health.queued} 个
- 运行中: ${health.in_progress} 个

## 重要事件数量
${recent_events.length > 0 ? `- 异常事件: ${recent_events.length} 条` : '- 无重大异常事件'}

请生成简报摘要，重点关注：系统整体健康状况、任务完成情况、需要注意的问题。`;

  const { text } = await callLLM('thalamus', prompt, {
    timeout: 30000,
    maxTokens: 400,
  });

  return text.trim();
}

/**
 * LLM 失败时的降级摘要（纯文本统计）
 */
function _generateFallbackSummary(reportContent) {
  const { tasks, health, period } = reportContent;
  const successRate = tasks.success_rate;
  const statusStr = successRate >= 80 ? '健康' : successRate >= 60 ? '一般' : '需关注';

  return `${period.interval_hours}h 系统简报：完成 ${tasks.completed} 个任务，失败 ${tasks.failed} 个，成功率 ${successRate}%。` +
    `当前队列：${health.queued} 个等待，${health.in_progress} 个运行中。系统状态：${statusStr}。`;
}

/**
 * 根据任务统计和健康数据确定健康状态
 */
function _determineHealthStatus(taskStats, healthData) {
  const { success_rate, failed } = taskStats;
  const { recent_failures } = healthData;

  if (success_rate >= 80 && recent_failures < 5) return 'healthy';
  if (success_rate >= 60 && recent_failures < 10) return 'degraded';
  if (failed > 20 || recent_failures >= 10) return 'critical';
  return 'degraded';
}

export {
  REPORT_INTERVAL_HOURS,
  LAST_REPORT_KEY,
};
