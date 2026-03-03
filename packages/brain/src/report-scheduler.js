/**
 * Report Scheduler - 系统简报定时生成
 *
 * 每 48 小时自动触发一次系统简报生成：
 * 1. 检查 reports 表最近一条 system_brief 生成时间
 * 2. 超过 48 小时（或无记录）→ 调用 LLM 生成简报
 * 3. 插入 reports 表（status=generated）
 * 4. 推送到 Notion（status=pushed）
 */

/* global console, process */

import pool from './db.js';

const REPORT_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48 小时
const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ─── Notion 工具 ──────────────────────────────────────────────

/**
 * 调用 Notion API
 */
async function notionRequest(token, path, method = 'GET', body = null) {
  const url = `${NOTION_API_BASE}${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(`Notion API ${method} ${path} → ${res.status}: ${data.message || 'Unknown error'}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

// ─── 数据采集 ──────────────────────────────────────────────────

/**
 * 收集过去 48 小时的系统关键数据
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<Object>} 系统数据快照
 */
async function collectSystemData(dbPool) {
  const db = dbPool || pool;
  const data = {};

  // 任务统计
  try {
    const taskStats = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '48 hours') AS completed_48h,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '48 hours') AS failed_48h,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_now,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_now,
        COUNT(*) FILTER (WHERE status = 'quarantined') AS quarantined_now
      FROM tasks
    `);
    data.task_stats = taskStats.rows[0];
  } catch (err) {
    console.error('[report-scheduler] Failed to collect task stats:', err.message);
    data.task_stats = {};
  }

  // KR 进度
  try {
    const krProgress = await db.query(`
      SELECT title, status, progress, priority
      FROM goals
      WHERE status IN ('in_progress', 'pending')
      ORDER BY priority, progress DESC
      LIMIT 10
    `);
    data.active_krs = krProgress.rows;
  } catch (err) {
    console.error('[report-scheduler] Failed to collect KR progress:', err.message);
    data.active_krs = [];
  }

  // 最近失败任务
  try {
    const recentFailures = await db.query(`
      SELECT title, task_type, updated_at
      FROM tasks
      WHERE status = 'failed'
        AND updated_at > NOW() - INTERVAL '48 hours'
      ORDER BY updated_at DESC
      LIMIT 5
    `);
    data.recent_failures = recentFailures.rows;
  } catch (err) {
    console.error('[report-scheduler] Failed to collect recent failures:', err.message);
    data.recent_failures = [];
  }

  // 隔离区任务数量
  try {
    const quarantineStats = await db.query(`
      SELECT COUNT(*) AS count FROM tasks WHERE status = 'quarantined'
    `);
    data.quarantine_count = parseInt(quarantineStats.rows[0]?.count || 0);
  } catch (err) {
    console.error('[report-scheduler] Failed to collect quarantine stats:', err.message);
    data.quarantine_count = 0;
  }

  // 系统上次 tick 时间
  try {
    const lastTickMem = await db.query(`
      SELECT value_json FROM working_memory WHERE key = 'tick_last'
    `);
    data.last_tick = lastTickMem.rows[0]?.value_json?.timestamp || null;
  } catch (err) {
    data.last_tick = null;
  }

  // 最近学习记录数
  try {
    const learningsCount = await db.query(`
      SELECT COUNT(*) AS count FROM learnings
      WHERE created_at > NOW() - INTERVAL '48 hours'
    `);
    data.new_learnings_48h = parseInt(learningsCount.rows[0]?.count || 0);
  } catch (err) {
    data.new_learnings_48h = 0;
  }

  data.collected_at = new Date().toISOString();
  return data;
}

// ─── 简报生成 ──────────────────────────────────────────────────

/**
 * 使用 LLM 生成系统简报摘要
 * @param {Object} systemData 系统数据快照
 * @returns {Promise<Object>} 简报内容
 */
async function generateBriefContent(systemData) {
  // 动态导入避免循环依赖
  const { callLLM } = await import('./llm-caller.js');

  const taskStats = systemData.task_stats || {};
  const completed = parseInt(taskStats.completed_48h || 0);
  const failed = parseInt(taskStats.failed_48h || 0);
  const total = completed + failed;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 100;

  const prompt = `你是 Cecelia 系统的报告生成器，负责生成简洁的 48 小时系统简报。

## 系统数据（过去 48 小时）

任务统计:
- 已完成: ${completed} 个
- 失败: ${failed} 个
- 完成率: ${completionRate}%
- 当前进行中: ${taskStats.in_progress_now || 0} 个
- 等待队列: ${taskStats.queued_now || 0} 个
- 隔离区: ${systemData.quarantine_count || 0} 个

活跃 KR（关键结果）:
${(systemData.active_krs || []).map(kr => `- [${kr.priority}] ${kr.title}: ${kr.progress || 0}%`).join('\n') || '暂无活跃 KR'}

最近失败任务:
${(systemData.recent_failures || []).map(t => `- ${t.title} (${t.task_type})`).join('\n') || '无近期失败'}

新增学习记录: ${systemData.new_learnings_48h || 0} 条
上次 Tick: ${systemData.last_tick || '未知'}

## 任务

请生成一份简洁的系统简报，包含以下内容：
1. 系统健康评分（0-10分）
2. 核心指标摘要
3. 关键发现（最多 3 条）
4. 关注点（若无则标注"系统运行正常"）
5. 下阶段重点

## 输出格式（严格 JSON，无注释）

{
  "health_score": 8.5,
  "period": "48h",
  "metrics": {
    "tasks_completed": ${completed},
    "tasks_failed": ${failed},
    "completion_rate": "${completionRate}%",
    "quarantine_count": ${systemData.quarantine_count || 0},
    "new_learnings": ${systemData.new_learnings_48h || 0}
  },
  "key_findings": ["发现1", "发现2"],
  "concerns": ["关注点1"],
  "next_focus": "下阶段重点",
  "summary": "一句话总结"
}`;

  const { text } = await callLLM('thalamus', prompt, { timeout: 60000, maxTokens: 1024 });

  // 解析 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM 响应中未找到 JSON');
  }

  const content = JSON.parse(jsonMatch[0]);
  content.generated_at = new Date().toISOString();
  content.raw_data_snapshot = {
    task_stats: systemData.task_stats,
    active_krs_count: systemData.active_krs?.length || 0,
    quarantine_count: systemData.quarantine_count,
  };

  return content;
}

// ─── Notion 推送 ──────────────────────────────────────────────

/**
 * 创建 Notion 简报页面
 * @param {Object} content 简报内容
 * @param {string} token Notion API token
 * @param {string} dbId Notion 数据库 ID
 * @returns {Promise<string>} Notion 页面 ID
 */
async function pushToNotion(content, token, dbId) {
  const title = `系统简报 ${new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  })}`;

  const summaryText = content.summary || '无摘要';
  const healthScore = content.health_score ?? '未评分';
  const keyFindings = Array.isArray(content.key_findings) ? content.key_findings : [];
  const concerns = Array.isArray(content.concerns) ? content.concerns : [];
  const nextFocus = content.next_focus || '';

  // 构建页面内容块
  const children = [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: `健康评分: ${healthScore}/10` } }],
      },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: summaryText.slice(0, 2000) } }],
      },
    },
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: '关键发现' } }],
      },
    },
    ...keyFindings.map(finding => ({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: String(finding).slice(0, 2000) } }],
      },
    })),
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: '关注点' } }],
      },
    },
    ...concerns.map(concern => ({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: String(concern).slice(0, 2000) } }],
      },
    })),
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: '下阶段重点' } }],
      },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: nextFocus.slice(0, 2000) } }],
      },
    },
  ];

  // 页面属性（Name 是 Notion 数据库必需的标题属性）
  const properties = {
    Name: {
      title: [{ type: 'text', text: { content: title } }],
    },
  };

  const newPage = await notionRequest(token, '/pages', 'POST', {
    parent: { database_id: dbId },
    properties,
    children,
  });

  return newPage.id;
}

// ─── 主函数 ──────────────────────────────────────────────────

/**
 * 检查并触发 48h 系统简报生成
 * 由 tick.js executeTick() 调用，失败不阻塞 tick 循环
 *
 * @param {import('pg').Pool} [dbPool] 可选，默认使用全局 pool
 * @returns {Promise<Object>} 结果对象
 */
export async function checkReportSchedule(dbPool) {
  const db = dbPool || pool;

  // 1. 查询最近一次简报生成时间
  let lastGeneratedAt = null;
  try {
    const result = await db.query(`
      SELECT MAX(generated_at) AS last_at
      FROM reports
      WHERE type = 'system_brief'
    `);
    lastGeneratedAt = result.rows[0]?.last_at || null;
  } catch (err) {
    // reports 表可能还不存在（migration 未运行）
    console.warn('[report-scheduler] Cannot query reports table:', err.message);
    return { skipped: true, reason: 'table_not_ready', error: err.message };
  }

  // 2. 检查是否到了触发时间
  const elapsed = lastGeneratedAt
    ? Date.now() - new Date(lastGeneratedAt).getTime()
    : Infinity;

  if (elapsed < REPORT_INTERVAL_MS) {
    const remainingMs = REPORT_INTERVAL_MS - elapsed;
    const remainingHours = (remainingMs / (60 * 60 * 1000)).toFixed(1);
    return {
      skipped: true,
      reason: 'too_soon',
      last_generated_at: lastGeneratedAt,
      next_in_hours: remainingHours,
    };
  }

  console.log(`[report-scheduler] 触发 48h 系统简报（上次：${lastGeneratedAt || '从未'}）`);

  // 3. 采集系统数据
  let systemData;
  try {
    systemData = await collectSystemData(db);
  } catch (err) {
    console.error('[report-scheduler] 采集系统数据失败:', err.message);
    return { skipped: false, success: false, error: err.message, stage: 'collect_data' };
  }

  // 4. 生成简报内容（LLM）
  let content;
  try {
    content = await generateBriefContent(systemData);
  } catch (err) {
    console.error('[report-scheduler] LLM 生成简报失败:', err.message);
    // 降级：使用纯数据简报
    const taskStats = systemData.task_stats || {};
    const completed = parseInt(taskStats.completed_48h || 0);
    const failed = parseInt(taskStats.failed_48h || 0);
    content = {
      health_score: null,
      period: '48h',
      metrics: taskStats,
      key_findings: [`完成任务: ${completed}，失败: ${failed}`],
      concerns: [`LLM 生成失败: ${err.message}`],
      next_focus: '',
      summary: `系统数据快照（${new Date().toISOString()}）`,
      generated_at: new Date().toISOString(),
      raw_data_snapshot: { task_stats: taskStats, quarantine_count: systemData.quarantine_count },
      fallback: true,
    };
  }

  // 5. 插入 reports 表
  let reportId;
  try {
    const insertResult = await db.query(`
      INSERT INTO reports (type, content, status)
      VALUES ('system_brief', $1, 'generated')
      RETURNING id
    `, [JSON.stringify(content)]);
    reportId = insertResult.rows[0].id;
    console.log(`[report-scheduler] 简报记录已创建: ${reportId}`);
  } catch (err) {
    console.error('[report-scheduler] 插入 reports 表失败:', err.message);
    return { skipped: false, success: false, error: err.message, stage: 'insert_report' };
  }

  // 6. 推送到 Notion
  const token = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_REPORTS_DB_ID || process.env.NOTION_KNOWLEDGE_DB_ID;

  if (!token || !dbId) {
    console.warn('[report-scheduler] Notion 未配置（NOTION_API_KEY 或 NOTION_REPORTS_DB_ID），跳过推送');
    return {
      skipped: false,
      success: true,
      report_id: reportId,
      notion_pushed: false,
      reason: 'notion_not_configured',
    };
  }

  try {
    const notionPageId = await pushToNotion(content, token, dbId);

    // 更新 reports 表状态
    await db.query(`
      UPDATE reports
      SET status = 'pushed', notion_id = $1
      WHERE id = $2
    `, [notionPageId, reportId]);

    console.log(`[report-scheduler] 简报已推送到 Notion: ${notionPageId}`);

    return {
      skipped: false,
      success: true,
      report_id: reportId,
      notion_id: notionPageId,
      notion_pushed: true,
      health_score: content.health_score,
    };
  } catch (err) {
    console.error('[report-scheduler] Notion 推送失败:', err.message);

    // 更新 reports 表状态为 failed
    await db.query(`
      UPDATE reports SET status = 'failed' WHERE id = $1
    `, [reportId]).catch(() => {});

    return {
      skipped: false,
      success: false,
      report_id: reportId,
      notion_pushed: false,
      error: err.message,
      stage: 'notion_push',
    };
  }
}
