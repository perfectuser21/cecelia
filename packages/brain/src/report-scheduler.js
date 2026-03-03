/**
 * Report Scheduler — 48h 定期简报调度器
 *
 * 每次 tick 时调用 runReportSchedulerIfNeeded()，
 * 内部判断距上次简报是否 >= 48h（可通过环境变量配置）。
 *
 * 简报内容（纯统计，不调 LLM）：
 *   - 过去 N 小时任务完成情况统计
 *   - 系统健康状态（活跃进程、报警等级）
 *   - 重要事件摘要
 *   - 当前队列状态
 *
 * 存储：daily_logs 表（type='system_report'）
 * 推送：WebSocket broadcast system:report 事件
 *
 * 调用方式：由 tick.js fire-and-forget 调用 runReportSchedulerIfNeeded()
 */

/* global console, process */

import pool from './db.js';
import { broadcast, WS_EVENTS } from './websocket.js';

// ── 配置 ──────────────────────────────────────────────────

/** 简报间隔，默认 48h，可通过环境变量覆盖（测试时设为 60000 = 1分钟）*/
const REPORT_INTERVAL_MS = parseInt(
  process.env.CECELIA_REPORT_INTERVAL_MS || String(48 * 60 * 60 * 1000),
  10
);

/** working_memory 中存储上次简报时间的 key */
const LAST_REPORT_KEY = 'last_system_report_time';

// ── 防重复检查 ────────────────────────────────────────────

/**
 * 从 working_memory 读取上次简报时间
 * @param {import('pg').Pool} db
 * @returns {Promise<Date|null>}
 */
export async function getLastReportTime(db) {
  const { rows } = await db.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [LAST_REPORT_KEY]
  );
  if (!rows.length || !rows[0].value_json?.timestamp) return null;
  return new Date(rows[0].value_json.timestamp);
}

/**
 * 判断是否应该生成新简报
 * @param {import('pg').Pool} db
 * @returns {Promise<{should: boolean, reason: string, last_time: Date|null}>}
 */
export async function checkShouldGenerateReport(db) {
  const lastTime = await getLastReportTime(db);

  if (!lastTime) {
    return { should: true, reason: 'no_previous_report', last_time: null };
  }

  const elapsed = Date.now() - lastTime.getTime();
  if (elapsed >= REPORT_INTERVAL_MS) {
    return {
      should: true,
      reason: 'interval_elapsed',
      last_time: lastTime,
      elapsed_ms: elapsed
    };
  }

  return {
    should: false,
    reason: 'too_soon',
    last_time: lastTime,
    elapsed_ms: elapsed,
    next_report_in_ms: REPORT_INTERVAL_MS - elapsed
  };
}

// ── 数据采集 ──────────────────────────────────────────────

/**
 * 获取过去 N 小时内的任务统计
 * @param {import('pg').Pool} db
 * @param {Date} since
 */
async function getTaskStats(db, since) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > $1) AS completed,
       COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > $1) AS failed,
       COUNT(*) FILTER (WHERE status = 'queued') AS queued,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined
     FROM tasks`,
    [since.toISOString()]
  );
  const row = rows[0] || {};
  return {
    completed: parseInt(row.completed) || 0,
    failed: parseInt(row.failed) || 0,
    queued: parseInt(row.queued) || 0,
    in_progress: parseInt(row.in_progress) || 0,
    quarantined: parseInt(row.quarantined) || 0
  };
}

/**
 * 获取关键事件摘要（最近 N 小时）
 * @param {import('pg').Pool} db
 * @param {Date} since
 */
async function getKeyEvents(db, since) {
  const { rows } = await db.query(
    `SELECT event_type, source, payload, created_at
     FROM cecelia_events
     WHERE created_at > $1
       AND event_type IN (
         'task_completed', 'task_failed', 'tick_executed',
         'daily_report_generated', 'desire_expressed',
         'alertness_changed', 'quarantine_entered'
       )
     ORDER BY created_at DESC
     LIMIT 20`,
    [since.toISOString()]
  );
  return rows.map(r => ({
    type: r.event_type,
    source: r.source,
    time: r.created_at,
    payload: r.payload
  }));
}

/**
 * 获取系统报警等级（从 working_memory）
 * @param {import('pg').Pool} db
 */
async function getAlertnessLevel(db) {
  const { rows } = await db.query(
    `SELECT value_json FROM working_memory WHERE key = 'alertness_state' LIMIT 1`
  );
  return rows[0]?.value_json || null;
}

/**
 * 获取今日 Token 费用
 * @param {import('pg').Pool} db
 */
async function getTokenCost(db) {
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM((payload->>'cost_usd')::numeric), 0) AS total_cost_usd,
       COUNT(*) AS api_calls
     FROM cecelia_events
     WHERE event_type = 'llm_call'
       AND created_at > CURRENT_DATE`
  );
  return {
    total_cost_usd: parseFloat(rows[0]?.total_cost_usd) || 0,
    api_calls: parseInt(rows[0]?.api_calls) || 0
  };
}

/**
 * 获取活跃 OKR 目标进度
 * @param {import('pg').Pool} db
 */
async function getGoalsProgress(db) {
  const { rows } = await db.query(
    `SELECT g.id, g.title, g.status, g.priority, g.progress, p.name AS project_name
     FROM goals g
     LEFT JOIN projects p ON g.project_id = p.id
     WHERE g.status NOT IN ('completed', 'cancelled')
     ORDER BY g.priority ASC, g.progress DESC
     LIMIT 10`
  );
  return rows;
}

// ── 简报生成 ──────────────────────────────────────────────

/**
 * 生成系统简报（纯统计，不调 LLM）
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<object>} 结构化简报 JSON
 */
export async function generateSystemReport(dbPool) {
  const db = dbPool || pool;
  const now = new Date();
  const intervalHours = REPORT_INTERVAL_MS / (1000 * 3600);
  const since = new Date(now.getTime() - REPORT_INTERVAL_MS);

  console.log(`[report-scheduler] 生成系统简报，覆盖过去 ${intervalHours.toFixed(1)}h`);

  // 并发查询所有数据
  const [taskStats, keyEvents, alertness, tokenCost, goalsProgress] = await Promise.all([
    getTaskStats(db, since).catch(e => {
      console.warn('[report-scheduler] 任务统计查询失败:', e.message);
      return { completed: 0, failed: 0, queued: 0, in_progress: 0, quarantined: 0 };
    }),
    getKeyEvents(db, since).catch(e => {
      console.warn('[report-scheduler] 事件查询失败:', e.message);
      return [];
    }),
    getAlertnessLevel(db).catch(() => null),
    getTokenCost(db).catch(() => ({ total_cost_usd: 0, api_calls: 0 })),
    getGoalsProgress(db).catch(() => [])
  ]);

  // 计算任务成功率
  const totalTasksDone = taskStats.completed + taskStats.failed;
  const successRate = totalTasksDone > 0
    ? Math.round((taskStats.completed / totalTasksDone) * 100)
    : null;

  // 判断系统健康状态
  let systemHealth = 'healthy';
  if (taskStats.failed > taskStats.completed && totalTasksDone > 0) {
    systemHealth = 'critical';
  } else if (taskStats.failed > 0) {
    systemHealth = 'warning';
  } else if (taskStats.in_progress === 0 && taskStats.queued === 0) {
    systemHealth = 'idle';
  }

  const report = {
    type: 'system_report',
    period: {
      from: since.toISOString(),
      to: now.toISOString(),
      hours: intervalHours
    },
    system_health: systemHealth,
    task_stats: {
      ...taskStats,
      total_done: totalTasksDone,
      success_rate: successRate
    },
    alertness: alertness ? {
      level: alertness.level,
      level_name: alertness.level_name
    } : null,
    token_cost: tokenCost,
    goals_progress: goalsProgress.map(g => ({
      title: g.title,
      status: g.status,
      priority: g.priority,
      progress: g.progress,
      project: g.project_name
    })),
    key_events: keyEvents.slice(0, 10),
    generated_at: now.toISOString()
  };

  console.log(`[report-scheduler] 简报生成完成 health=${systemHealth} completed=${taskStats.completed} failed=${taskStats.failed}`);
  return report;
}

// ── 存储 ──────────────────────────────────────────────────

/**
 * 将简报保存到 daily_logs 表（type='system_report'）
 * @param {import('pg').Pool} db
 * @param {object} report
 * @returns {Promise<{id: string, created: boolean}>}
 */
export async function saveReport(db, report) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const reportJson = JSON.stringify(report);

  // 当天可能有多条 system_report（每 48h 一条），用 generated_at 区分
  const result = await db.query(
    `INSERT INTO daily_logs (date, project_id, summary, type, agent)
     VALUES ($1, NULL, $2, 'system_report', 'report-scheduler')
     RETURNING id`,
    [today, reportJson]
  );

  const id = result.rows[0].id;
  console.log(`[report-scheduler] 简报已保存 id=${id}`);
  return { id, created: true };
}

/**
 * 更新 working_memory 中的上次简报时间
 * @param {import('pg').Pool} db
 * @param {Date} time
 */
export async function updateLastReportTime(db, time = new Date()) {
  await db.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [LAST_REPORT_KEY, { timestamp: time.toISOString() }]
  );
}

// ── WebSocket 推送 ────────────────────────────────────────

/**
 * 通过 WebSocket 推送简报通知到前端
 * @param {object} report
 * @param {string} logId - daily_logs ID
 */
export function pushReportToFrontend(report, logId) {
  try {
    broadcast(WS_EVENTS.SYSTEM_REPORT, {
      id: logId,
      type: 'system_report',
      system_health: report.system_health,
      period: report.period,
      summary: {
        completed: report.task_stats.completed,
        failed: report.task_stats.failed,
        queued: report.task_stats.queued,
        success_rate: report.task_stats.success_rate
      },
      generated_at: report.generated_at
    });
    console.log(`[report-scheduler] WebSocket 推送完成`);
  } catch (err) {
    console.warn('[report-scheduler] WebSocket 推送失败:', err.message);
  }
}

// ── 主入口 ────────────────────────────────────────────────

/**
 * 如果距上次简报 >= 48h，生成并保存简报
 * 由 tick.js fire-and-forget 调用
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<{skipped?: boolean, reason?: string} | {ok: boolean, report_id: string}>}
 */
export async function runReportSchedulerIfNeeded(dbPool) {
  const db = dbPool || pool;

  // 1. 检查是否需要生成
  let check;
  try {
    check = await checkShouldGenerateReport(db);
  } catch (err) {
    console.warn('[report-scheduler] 检查失败，跳过:', err.message);
    return { skipped: true, reason: 'check_failed', error: err.message };
  }

  if (!check.should) {
    const nextMinutes = Math.round((check.next_report_in_ms || 0) / 60000);
    console.log(`[report-scheduler] 跳过，距下次简报还有 ${nextMinutes} 分钟`);
    return { skipped: true, reason: check.reason, next_in_minutes: nextMinutes };
  }

  console.log(`[report-scheduler] 触发简报生成，原因: ${check.reason}`);

  // 2. 生成简报
  let report;
  try {
    report = await generateSystemReport(db);
  } catch (err) {
    console.error('[report-scheduler] 简报生成失败:', err.message);
    return { skipped: false, ok: false, error: err.message };
  }

  // 3. 保存到数据库
  let saveResult;
  try {
    saveResult = await saveReport(db, report);
  } catch (err) {
    console.error('[report-scheduler] 简报保存失败:', err.message);
    // 保存失败不阻止推送，但不更新时间戳（下次 tick 会重试）
    return { skipped: false, ok: false, error: err.message };
  }

  // 4. 更新 last_report_time
  try {
    await updateLastReportTime(db);
  } catch (err) {
    console.warn('[report-scheduler] 更新时间戳失败:', err.message);
    // 非致命，继续推送
  }

  // 5. WebSocket 推送
  pushReportToFrontend(report, saveResult.id);

  return {
    skipped: false,
    ok: true,
    report_id: saveResult.id,
    system_health: report.system_health,
    period: report.period
  };
}

export { REPORT_INTERVAL_MS, LAST_REPORT_KEY };
