/**
 * Briefing API — 聚合简报数据
 *
 * 为 CeceliaPage V2 提供一站式数据聚合，
 * 前端打开页面时调用一次即可获取完整简报。
 *
 * 纯数据聚合，不调 LLM。
 */

import pool from './db.js';

/**
 * 根据当前小时生成问候语
 * @returns {string}
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/**
 * 获取简报数据
 * @param {object} options
 * @param {string} [options.since] - ISO timestamp, 默认 24h 前
 * @returns {Promise<object>}
 */
export async function getBriefing(options = {}) {
  const since = options.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const client = await pool.connect();

  try {
    // 并发查询所有数据
    const [
      taskStatsResult,
      recentEventsResult,
      pendingDesiresResult,
      focusResult,
      tokenResult,
      runningResult
    ] = await Promise.all([
      // 1. 任务统计（since 时间后）
      client.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > $1) AS completed,
          COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > $1) AS failed,
          COUNT(*) FILTER (WHERE status = 'queued') AS queued,
          COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress
        FROM tasks
      `, [since]),

      // 2. 最近事件（since 后的关键事件）
      client.query(`
        SELECT event_type, source, payload, created_at
        FROM cecelia_events
        WHERE created_at > $1
          AND event_type IN ('task_completed', 'task_failed', 'task_dispatched', 'daily_report_generated', 'desire_expressed')
        ORDER BY created_at DESC
        LIMIT 10
      `, [since]),

      // 3. 待决策 desires
      client.query(`
        SELECT id, type, content, proposed_action, urgency, created_at
        FROM desires
        WHERE status = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY urgency DESC, created_at DESC
        LIMIT 5
      `),

      // 4. 今日焦点
      client.query(`
        SELECT wm.value_json
        FROM working_memory wm
        WHERE wm.key = 'daily_focus'
        LIMIT 1
      `),

      // 5. Token 费用（今日）
      client.query(`
        SELECT
          COALESCE(SUM((payload->>'cost_usd')::numeric), 0) AS total_cost_usd,
          COUNT(*) AS api_calls
        FROM cecelia_events
        WHERE event_type = 'llm_call'
          AND created_at > CURRENT_DATE
      `),

      // 6. 运行中任务详情
      client.query(`
        SELECT id, title, task_type, started_at, priority
        FROM tasks
        WHERE status = 'in_progress'
        ORDER BY started_at ASC
        LIMIT 10
      `)
    ]);

    // 组装简报
    const taskStats = taskStatsResult.rows[0];
    const focusData = focusResult.rows[0]?.value_json;

    // 格式化事件列表
    const events = recentEventsResult.rows.map(row => ({
      time: new Date(row.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      type: row.event_type,
      text: formatEventText(row)
    }));

    // 格式化待决策
    const pendingDecisions = pendingDesiresResult.rows.map(row => ({
      desire_id: row.id,
      type: row.type,
      summary: row.content,
      proposed_action: row.proposed_action,
      urgency: row.urgency,
      created_at: row.created_at
    }));

    return {
      greeting: getGreeting(),
      since_last_visit: {
        since,
        completed: parseInt(taskStats.completed) || 0,
        failed: parseInt(taskStats.failed) || 0,
        queued: parseInt(taskStats.queued) || 0,
        in_progress: parseInt(taskStats.in_progress) || 0,
        events
      },
      pending_decisions: pendingDecisions,
      today_focus: focusData ? {
        title: focusData.objective_title || focusData.title,
        progress: focusData.progress || 0,
        objective_id: focusData.objective_id || focusData.id
      } : null,
      running_tasks: runningResult.rows.map(t => ({
        id: t.id,
        title: t.title,
        type: t.task_type,
        started_at: t.started_at,
        priority: t.priority
      })),
      token_cost_usd: parseFloat(tokenResult.rows[0]?.total_cost_usd) || 0,
      generated_at: new Date().toISOString()
    };
  } finally {
    client.release();
  }
}

/**
 * 格式化事件文本
 */
function formatEventText(row) {
  const payload = row.payload || {};
  switch (row.event_type) {
    case 'task_completed':
      return `${payload.agent || 'agent'} 完成了 ${payload.title || '任务'}`;
    case 'task_failed':
      return `${payload.agent || 'agent'} 执行失败: ${payload.title || '任务'}`;
    case 'task_dispatched':
      return `已派发: ${payload.title || '任务'}`;
    case 'daily_report_generated':
      return '日报已生成';
    case 'desire_expressed':
      return `Cecelia 表达了: ${payload.content?.substring(0, 50) || '...'}`;
    default:
      return `${row.event_type}: ${row.source || ''}`;
  }
}
