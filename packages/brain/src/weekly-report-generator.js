/**
 * weekly-report-generator.js
 *
 * 自动周报生成器。
 *
 * 每次 Tick 末尾调用 generateWeeklyReport()，内部判断：
 *   1. 是否在周一 UTC 01:00–01:05 触发窗口内
 *   2. 是否本周已生成过（幂等）
 *
 * 如果是，则查询上周（Mon 00:00 UTC ~ Sun 23:59:59 UTC）的内容数据，
 * 生成周报并推送飞书。
 *
 * 触发条件：每周一 UTC 01:00 ± 5 分钟（北京时间周一 09:00）
 * 幂等机制：working_memory key='weekly_report_triggered_{YYYY-WNN}'
 * 周报存储：working_memory key='weekly_report_{YYYY-WNN}'
 */

import pool from './db.js';
import { sendFeishu } from './notifier.js';
import { computeTopicHeatScores, saveTopicFeedback } from './topic-heat-scorer.js';
import { queryWeeklyROI } from './content-analytics.js';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 触发小时（UTC）= 北京时间 09:00 */
const TARGET_HOUR = 1; // UTC 01:00

/** 触发窗口分钟数 */
const TRIGGER_WINDOW_MINUTES = 5;

/** UTC 星期几 = 周一（0=Sunday，1=Monday） */
const MONDAY = 1;

/** working_memory key 前缀：幂等触发记录 */
const WM_TRIGGER_KEY_PREFIX = 'weekly_report_triggered_';

/** working_memory key 前缀：周报内容存储 */
const WM_REPORT_KEY_PREFIX = 'weekly_report_';

// ─── 时间工具 ─────────────────────────────────────────────────────────────────

/**
 * 判断当前时间是否在周报触发窗口内（每周一 UTC 01:00 ± 5 分钟）。
 *
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {boolean}
 */
export function isInWeeklyReportTriggerWindow(now = new Date()) {
  const utcDay = now.getUTCDay();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcDay === MONDAY && utcHour === TARGET_HOUR && utcMinute < TRIGGER_WINDOW_MINUTES;
}

/**
 * 计算 ISO 周键（格式 YYYY-WNN），用于幂等 key。
 * 例：2026-04-06（周一）→ '2026-W15'
 *
 * @param {Date} now
 * @returns {string}
 */
export function getISOWeekKey(now) {
  // ISO 周：周一为第一天，1月4日所在周为第1周
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 调到周四
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * 计算上周的起止时间（UTC）。
 *
 * @param {Date} now - 当前时间（必须是周一）
 * @returns {{ start: Date, end: Date, startStr: string, endStr: string }}
 */
export function getLastWeekRange(now) {
  // 找到上周一（today - 7天）的 UTC 00:00:00
  const mondayThisWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const start = new Date(mondayThisWeek.getTime() - 7 * 24 * 60 * 60 * 1000); // 上周一 00:00
  const end = new Date(mondayThisWeek.getTime() - 1); // 上周日 23:59:59.999

  return {
    start,
    end,
    startStr: start.toISOString().slice(0, 10),
    endStr: end.toISOString().slice(0, 10),
  };
}

// ─── 幂等检查 ─────────────────────────────────────────────────────────────────

/**
 * 检查本周是否已经生成过周报。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} weekKey - YYYY-WNN
 * @returns {Promise<boolean>}
 */
async function hasThisWeekReport(dbPool, weekKey) {
  const key = WM_TRIGGER_KEY_PREFIX + weekKey;
  const { rows } = await dbPool.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [key]
  );
  return rows.length > 0;
}

/**
 * 标记本周已完成。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} weekKey - YYYY-WNN
 */
async function markThisWeekDone(dbPool, weekKey) {
  const key = WM_TRIGGER_KEY_PREFIX + weekKey;
  const val = JSON.stringify({ week: weekKey, triggered_at: new Date().toISOString() });
  await dbPool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, val]
  );
}

// ─── 数据查询 ─────────────────────────────────────────────────────────────────

/**
 * 查询上周内容产出数量（content-pipeline 完成的 tasks）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<{count: number, topics: string[]}>}
 */
async function fetchWeekContentOutput(dbPool, start, end) {
  const { rows } = await dbPool.query(
    `SELECT COUNT(*)::int AS cnt,
            ARRAY_AGG(DISTINCT payload->>'topic') FILTER (WHERE payload->>'topic' IS NOT NULL) AS topics
     FROM tasks
     WHERE task_type IN ('content_pipeline', 'content_generation', 'copywriting')
       AND status = 'completed'
       AND completed_at >= $1
       AND completed_at < $2`,
    [start, end]
  );
  const row = rows[0] || {};
  return {
    count: row.cnt || 0,
    topics: (row.topics || []).filter(Boolean).slice(0, 5),
  };
}

/**
 * 查询上周各平台发布成功/失败数。
 *
 * @param {import('pg').Pool} dbPool
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<Array<{platform: string, success: number, failed: number}>>}
 */
async function fetchWeekPublishStats(dbPool, start, end) {
  const { rows } = await dbPool.query(
    `SELECT platform,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS success,
            COUNT(*) FILTER (WHERE status = 'failed')::int    AS failed
     FROM content_publish_jobs
     WHERE created_at >= $1
       AND created_at < $2
     GROUP BY platform
     ORDER BY (COUNT(*) FILTER (WHERE status = 'completed')) DESC`,
    [start, end]
  );
  return rows.map(r => ({
    platform: r.platform,
    success: r.success || 0,
    failed: r.failed || 0,
  }));
}

/**
 * 查询上周各平台数据回收汇总（来自 pipeline_publish_stats）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<Array<{platform: string, views: number, likes: number, comments: number, shares: number}>>}
 */
async function fetchWeekEngagementData(dbPool, start, end) {
  const { rows } = await dbPool.query(
    `SELECT platform,
            COALESCE(SUM(views), 0)::bigint    AS views,
            COALESCE(SUM(likes), 0)::bigint    AS likes,
            COALESCE(SUM(comments), 0)::bigint AS comments,
            COALESCE(SUM(shares), 0)::bigint   AS shares
     FROM pipeline_publish_stats
     WHERE scraped_at >= $1
       AND scraped_at < $2
     GROUP BY platform
     ORDER BY SUM(views) DESC`,
    [start, end]
  );
  return rows.map(r => ({
    platform: r.platform,
    views: Number(r.views),
    likes: Number(r.likes),
    comments: Number(r.comments),
    shares: Number(r.shares),
  }));
}

/**
 * 查询上周发布失败总数（content_publish_jobs）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<number>}
 */
async function fetchWeekFailureCount(dbPool, start, end) {
  const { rows } = await dbPool.query(
    `SELECT COUNT(*)::int AS cnt
     FROM content_publish_jobs
     WHERE status = 'failed'
       AND created_at >= $1
       AND created_at < $2`,
    [start, end]
  );
  return rows[0]?.cnt || 0;
}

// ─── 周报生成 ─────────────────────────────────────────────────────────────────

/**
 * 将数字格式化（null/0 → '0'，大数加千分符）。
 */
function fmt(val) {
  if (val === null || val === undefined) return 'N/A';
  const n = Number(val);
  return isNaN(n) ? 'N/A' : n.toLocaleString('zh-CN');
}

/**
 * 生成周报文本（七个板块：内容产出、发布情况、数据回收、爆款主题、下周推荐、异常告警、周总结）。
 *
 * @param {string} weekKey - YYYY-WNN
 * @param {string} startStr - 上周一 YYYY-MM-DD
 * @param {string} endStr - 上周日 YYYY-MM-DD
 * @param {{count: number, topics: string[]}} contentOutput
 * @param {Array<{platform: string, success: number, failed: number}>} publishStats
 * @param {Array<{platform: string, views: number, likes: number, comments: number, shares: number}>} engagementData
 * @param {number} failureCount
 * @param {Array<{topic_keyword: string, heat_score: number, total_likes: number, total_comments: number, total_shares: number}>} [topicHeatData]
 * @returns {string}
 */
export function buildWeeklyReportText(weekKey, startStr, endStr, contentOutput, publishStats, engagementData, failureCount, topicHeatData = [], roiData = []) {
  const lines = [];

  lines.push(`ZenithJoy 内容周报 ${weekKey}`);
  lines.push(`统计范围：${startStr} ~ ${endStr}`);
  lines.push('');

  // ── 板块一：内容产出 ──────────────────────────────────────────────────────
  lines.push('== 内容产出 ==');
  if (contentOutput.count === 0) {
    lines.push('本周无 content-pipeline 完成任务。');
  } else {
    lines.push(`完成任务数：${contentOutput.count} 条`);
    if (contentOutput.topics.length > 0) {
      lines.push(`热门话题：${contentOutput.topics.join('、')}`);
    }
  }
  lines.push('');

  // ── 板块二：发布情况 ──────────────────────────────────────────────────────
  lines.push('== 发布情况 ==');
  if (publishStats.length === 0) {
    lines.push('本周无发布任务。');
  } else {
    const totalSuccess = publishStats.reduce((s, r) => s + r.success, 0);
    const totalFailed = publishStats.reduce((s, r) => s + r.failed, 0);
    lines.push(`全平台合计：成功 ${totalSuccess} / 失败 ${totalFailed}`);
    for (const stat of publishStats) {
      if (stat.success > 0 || stat.failed > 0) {
        lines.push(`  ${stat.platform}：成功 ${stat.success} / 失败 ${stat.failed}`);
      }
    }
  }
  lines.push('');

  // ── 板块三：数据回收 ──────────────────────────────────────────────────────
  lines.push('== 数据回收 ==');
  if (engagementData.length === 0) {
    lines.push('本周无数据回收记录（pipeline_publish_stats 无数据）。');
  } else {
    const totalViews = engagementData.reduce((s, r) => s + r.views, 0);
    const totalLikes = engagementData.reduce((s, r) => s + r.likes, 0);
    lines.push(`全平台合计：阅读 ${fmt(totalViews)} / 点赞 ${fmt(totalLikes)}`);
    for (const item of engagementData) {
      lines.push(`  ${item.platform}：阅读 ${fmt(item.views)} / 点赞 ${fmt(item.likes)} / 评论 ${fmt(item.comments)} / 转发 ${fmt(item.shares)}`);
    }
  }
  lines.push('');

  // ── 板块四：爆款主题 ──────────────────────────────────────────────────────
  lines.push('== 爆款主题 ==');
  if (!topicHeatData || topicHeatData.length === 0) {
    lines.push('本周暂无话题热度数据（发布后需等待 4h 数据回收）。');
  } else {
    const top5 = topicHeatData.slice(0, 5);
    for (let i = 0; i < top5.length; i++) {
      const t = top5[i];
      lines.push(`  ${i + 1}. ${t.topic_keyword}（热度 ${t.heat_score.toFixed(1)}分 | 点赞 ${fmt(t.total_likes)} / 评论 ${fmt(t.total_comments)} / 转发 ${fmt(t.total_shares)}）`);
    }
  }
  lines.push('');

  // ── 板块五：下周推荐方向 ──────────────────────────────────────────────────
  lines.push('== 下周推荐方向 ==');
  const recommended = (topicHeatData || []).filter(t => t.heat_score >= 60).slice(0, 3);
  if (recommended.length === 0) {
    lines.push('本周无热度达标话题，建议下周继续尝试多样化选题。');
  } else {
    lines.push('基于本周数据，推荐继续深耕以下方向：');
    for (const t of recommended) {
      lines.push(`  · ${t.topic_keyword}`);
    }
  }
  lines.push('');

  // ── 板块六：异常告警 ──────────────────────────────────────────────────────
  lines.push('== 异常告警 ==');
  if (failureCount === 0) {
    lines.push('本周无发布失败记录，一切正常。');
  } else {
    lines.push(`本周 content_publish_jobs 失败 ${failureCount} 次，请关注。`);
  }
  lines.push('');

  // ── 板块七：内容ROI ───────────────────────────────────────────────────────
  lines.push('== 内容ROI ==');
  if (!roiData || roiData.length === 0) {
    lines.push('本周暂无 content_analytics 数据，ROI 待采集后更新。');
  } else {
    const totalROIViews = roiData.reduce((s, r) => s + r.total_views, 0);
    const totalROIContent = roiData.reduce((s, r) => s + r.content_count, 0);
    const avgViewsAll = totalROIContent > 0 ? Math.round(totalROIViews / totalROIContent) : 0;
    lines.push(`全平台均值：${totalROIContent} 条内容 / 平均每篇 ${fmt(avgViewsAll)} 次曝光`);
    for (const r of roiData) {
      lines.push(`  ${r.platform}：${r.content_count} 条 | 均曝光 ${fmt(r.avg_views_per_content)} | 互动率 ${r.engagement_rate}‰`);
    }
  }
  lines.push('');

  // ── 板块八：周总结 ────────────────────────────────────────────────────────
  lines.push('== 周总结 ==');
  const totalPublish = publishStats.reduce((s, r) => s + r.success + r.failed, 0);
  const totalViews = engagementData.reduce((s, r) => s + r.views, 0);
  if (totalPublish > 0 && totalViews > 0) {
    lines.push(`本周累计发布 ${totalPublish} 条内容，全平台总曝光 ${fmt(totalViews)} 次。`);
  } else if (totalPublish > 0) {
    lines.push(`本周累计发布 ${totalPublish} 条内容，数据回收暂无记录。`);
  } else {
    lines.push('本周暂无发布记录，请关注内容生产进度。');
  }
  lines.push('');

  lines.push('---');
  lines.push(`由 Cecelia Brain 自动生成 · ${new Date().toISOString()}`);

  return lines.join('\n');
}

// ─── 周报写入 working_memory ──────────────────────────────────────────────────

/**
 * 将周报文本写入 working_memory，key 格式为 weekly_report_{YYYY-WNN}。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} weekKey
 * @param {string} reportText
 */
async function saveWeeklyReportToWorkingMemory(dbPool, weekKey, reportText) {
  const key = WM_REPORT_KEY_PREFIX + weekKey;
  const val = JSON.stringify({ week: weekKey, report: reportText, generated_at: new Date().toISOString() });
  await dbPool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, val]
  );
}

// ─── 周报写入 system_reports ──────────────────────────────────────────────────

/**
 * 将周报写入 system_reports 表，使其在 Dashboard /reports 页面可见。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} weekKey - YYYY-WNN
 * @param {string} startStr - 上周一 YYYY-MM-DD
 * @param {string} endStr - 上周日 YYYY-MM-DD
 * @param {string} reportText - 周报纯文本（飞书格式）
 * @param {object} rawData - 原始数据（供 Dashboard 结构化展示）
 * @returns {Promise<string>} 写入的 report id
 */
async function saveWeeklyReportToSystemReports(dbPool, weekKey, startStr, endStr, reportText, rawData) {
  const content = {
    title: `内容周报 ${weekKey}`,
    summary: `统计范围：${startStr} ~ ${endStr}，内容产出 ${rawData.contentOutput.count} 条`,
    week_key: weekKey,
    start_date: startStr,
    end_date: endStr,
    report_text: reportText,
    content_output: rawData.contentOutput,
    publish_stats: rawData.publishStats,
    engagement_data: rawData.engagementData,
    failure_count: rawData.failureCount,
    top_topics: (rawData.topicHeatData || []).slice(0, 5),
    roi_data: rawData.roiData || [],
    generated_at: new Date().toISOString(),
  };
  const metadata = {
    triggered_by: rawData.force ? 'api_manual' : 'tick_auto',
    week_key: weekKey,
  };
  const { rows } = await dbPool.query(
    `INSERT INTO system_reports (type, content, metadata)
     VALUES ('weekly_report', $1::jsonb, $2::jsonb)
     RETURNING id`,
    [JSON.stringify(content), JSON.stringify(metadata)]
  );
  return rows[0].id;
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 每周内容周报生成器。由 tick.js 在每次 Tick 末尾调用。
 *
 * @param {import('pg').Pool} [dbPool] - PostgreSQL 连接池（默认使用 db.js 的 pool）
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @param {{force?: boolean}} [opts] - force=true 跳过时间窗口检查和幂等检查（手动触发用）
 * @returns {Promise<{generated: boolean, week: string, skipped_window: boolean, skipped_dup: boolean, report_id?: string}>}
 */
export async function generateWeeklyReport(dbPool = pool, now = new Date(), opts = {}) {
  const force = opts.force === true;

  // 1. 判断是否在触发窗口内（每周一 UTC 01:00 ± 5 分钟）；force 模式跳过
  if (!force && !isInWeeklyReportTriggerWindow(now)) {
    const weekKey = getISOWeekKey(now);
    return { generated: false, week: weekKey, skipped_window: true, skipped_dup: false };
  }

  const weekKey = getISOWeekKey(now);
  const { start, end, startStr, endStr } = getLastWeekRange(now);

  // 2. 幂等：本周是否已生成（同一周内重复触发只执行一次）；force 模式跳过
  if (!force && await hasThisWeekReport(dbPool, weekKey)) {
    return { generated: false, week: weekKey, skipped_window: false, skipped_dup: true };
  }

  console.log(`[weekly-report-generator] 开始生成 ${weekKey} 周报，统计范围：${startStr} ~ ${endStr}${force ? ' (force)' : ''}`);

  try {
    // 3. 并发查询四类数据 + 话题热度评分 + 内容ROI
    const [contentOutput, publishStats, engagementData, failureCount, topicHeatData, roiData] = await Promise.all([
      fetchWeekContentOutput(dbPool, start, end),
      fetchWeekPublishStats(dbPool, start, end),
      fetchWeekEngagementData(dbPool, start, end),
      fetchWeekFailureCount(dbPool, start, end),
      computeTopicHeatScores(dbPool, start, end).catch(err => {
        console.error(`[weekly-report-generator] 话题热度评分失败（跳过）: ${err.message}`);
        return [];
      }),
      queryWeeklyROI(dbPool, start, end).catch(err => {
        console.error(`[weekly-report-generator] ROI 计算失败（跳过）: ${err.message}`);
        return [];
      }),
    ]);

    // 4. 保存话题反馈（用于下周选题参考），不阻塞主流程
    saveTopicFeedback(dbPool, weekKey, topicHeatData).catch(err => {
      console.error(`[weekly-report-generator] 保存话题反馈失败: ${err.message}`);
    });

    // 5. 生成周报文本
    const reportText = buildWeeklyReportText(weekKey, startStr, endStr, contentOutput, publishStats, engagementData, failureCount, topicHeatData, roiData);

    // 6. 写入 working_memory
    await saveWeeklyReportToWorkingMemory(dbPool, weekKey, reportText);

    // 7. 写入 system_reports（Dashboard 可见）
    const reportId = await saveWeeklyReportToSystemReports(dbPool, weekKey, startStr, endStr, reportText, {
      contentOutput, publishStats, engagementData, failureCount, topicHeatData, roiData, force,
    }).catch(err => {
      console.error(`[weekly-report-generator] 写入 system_reports 失败（不阻塞）: ${err.message}`);
      return null;
    });

    // 8. 标记本周已完成（幂等锁，在推送前写入，避免推送失败导致重复生成）
    if (!force) {
      await markThisWeekDone(dbPool, weekKey);
    }

    // 9. 飞书推送（推送失败不影响幂等锁）
    await sendFeishu(reportText).catch(err => {
      console.error(`[weekly-report-generator] 飞书推送失败（周报已存储）: ${err.message}`);
    });

    console.log(`[weekly-report-generator] 周报生成并推送完成 (${weekKey})${reportId ? `, system_reports id=${reportId}` : ''}`);
    return { generated: true, week: weekKey, skipped_window: false, skipped_dup: false, report_id: reportId };
  } catch (err) {
    console.error(`[weekly-report-generator] 周报生成失败: ${err.message}`);
    throw err;
  }
}
