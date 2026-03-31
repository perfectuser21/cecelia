/**
 * daily-report-generator.js
 *
 * 自动日报生成器。
 *
 * 每次 Tick 末尾调用 generateDailyReport()，内部判断是否到达每日触发时间（UTC 01:00 = 北京时间 09:00）。
 * 如果是，则查询昨日内容产出数据，生成日报并推送飞书。
 *
 * 触发窗口：UTC 01:00 - 01:05（北京时间 09:00 - 09:05）
 * 幂等机制：working_memory key='daily_report_triggered_{DATE}'
 * 日报存储：working_memory key='daily_report_{DATE}'
 */

import pool from './db.js';
import { sendFeishu } from './notifier.js';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 每日触发时间（UTC 小时）= 北京时间 09:00 */
const targetHour = 1; // UTC 01:00

/** 触发窗口分钟数 */
const TRIGGER_WINDOW_MINUTES = 5;

/** working_memory key 前缀：幂等触发记录 */
const WM_TRIGGER_KEY_PREFIX = 'daily_report_triggered_';

/** working_memory key 前缀：日报内容存储 */
const WM_REPORT_KEY_PREFIX = 'daily_report_';

// ─── 时间工具 ─────────────────────────────────────────────────────────────────

/**
 * 判断当前时间是否在日报触发窗口内（UTC 01:00 ± 5 分钟）。
 *
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {boolean}
 */
export function isInReportTriggerWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === targetHour && utcMinute < TRIGGER_WINDOW_MINUTES;
}

/**
 * 将 Date 转为 YYYY-MM-DD 字符串（UTC 日期）。
 *
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * 计算昨日 UTC 日期字符串。
 *
 * @param {Date} now
 * @returns {string}
 */
function getYesterdayString(now) {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return toDateString(yesterday);
}

// ─── 幂等检查 ─────────────────────────────────────────────────────────────────

/**
 * 检查今天是否已经生成过日报。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} today - YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
async function hasTodayReport(dbPool, today) {
  const key = WM_TRIGGER_KEY_PREFIX + today;
  const { rows } = await dbPool.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [key]
  );
  if (rows.length === 0) return false;
  return rows[0].value_json?.already_done === true;
}

/**
 * 记录今日已触发，防止重复生成。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} today - YYYY-MM-DD
 */
async function markTodayDone(dbPool, today) {
  const key = WM_TRIGGER_KEY_PREFIX + today;
  const val = JSON.stringify({ already_done: true, triggered_at: new Date().toISOString() });
  await dbPool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, val]
  );
}

// ─── 数据查询 ─────────────────────────────────────────────────────────────────

/**
 * 查询昨日 content-pipeline 完成任务。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} yesterday - YYYY-MM-DD
 * @returns {Promise<{count: number, keywords: string[]}>}
 */
async function fetchYesterdayContentOutput(dbPool, yesterday) {
  const { rows } = await dbPool.query(
    `SELECT id, payload
     FROM tasks
     WHERE task_type = 'content-pipeline'
       AND status = 'completed'
       AND DATE(completed_at) = $1`,
    [yesterday]
  );
  const keywords = rows
    .map(r => r.payload?.keyword)
    .filter(Boolean)
    .slice(0, 10);
  return { count: rows.length, keywords };
}

/**
 * 查询各平台昨日发布情况（成功/失败数）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} yesterday - YYYY-MM-DD
 * @returns {Promise<Array<{platform: string, success: number, failed: number}>>}
 */
async function fetchYesterdayPublishStats(dbPool, yesterday) {
  const { rows } = await dbPool.query(
    `SELECT platform,
            COUNT(CASE WHEN status = 'completed' THEN 1 END)::int AS success,
            COUNT(CASE WHEN status = 'failed' THEN 1 END)::int AS failed
     FROM content_publish_jobs
     WHERE DATE(created_at) = $1
     GROUP BY platform
     ORDER BY platform`,
    [yesterday]
  );
  return rows;
}

/**
 * 查询各平台昨日数据回收（读取/点赞/评论）。
 * 从 content_publish 类型 tasks 的 payload 中提取。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} yesterday - YYYY-MM-DD
 * @returns {Promise<Array<{platform: string, views: number|null, likes: number|null, comments: number|null}>>}
 */
async function fetchYesterdayEngagementData(dbPool, yesterday) {
  const { rows } = await dbPool.query(
    `SELECT payload->>'platform' AS platform,
            payload->>'views' AS views,
            payload->>'likes' AS likes,
            payload->>'comments' AS comments
     FROM tasks
     WHERE task_type = 'content_publish'
       AND DATE(created_at) = $1
       AND payload->>'platform' IS NOT NULL`,
    [yesterday]
  );

  const platformMap = {};
  for (const row of rows) {
    const p = row.platform;
    if (!platformMap[p]) {
      platformMap[p] = { platform: p, views: null, likes: null, comments: null };
    }
    if (row.views !== null) platformMap[p].views = (platformMap[p].views || 0) + Number(row.views);
    if (row.likes !== null) platformMap[p].likes = (platformMap[p].likes || 0) + Number(row.likes);
    if (row.comments !== null) platformMap[p].comments = (platformMap[p].comments || 0) + Number(row.comments);
  }

  return Object.values(platformMap);
}

/**
 * 查询昨日异常数量（content_publish_jobs 失败数）。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} yesterday - YYYY-MM-DD
 * @returns {Promise<number>}
 */
async function fetchYesterdayFailureCount(dbPool, yesterday) {
  const { rows } = await dbPool.query(
    `SELECT COUNT(*)::int AS cnt
     FROM content_publish_jobs
     WHERE status = 'failed'
       AND DATE(created_at) = $1`,
    [yesterday]
  );
  return rows[0]?.cnt || 0;
}

// ─── 日报生成 ─────────────────────────────────────────────────────────────────

/**
 * 将数字转为友好展示（null 显示 N/A）。
 */
function fmt(val) {
  return val === null || val === undefined ? 'N/A' : String(val);
}

/**
 * 生成日报文本（包含四个板块：内容产出、发布情况、数据回收、异常告警）。
 *
 * @param {string} reportDate - 日报日期（今天 YYYY-MM-DD）
 * @param {string} yesterday - 昨日日期
 * @param {{count: number, keywords: string[]}} contentOutput
 * @param {Array<{platform: string, success: number, failed: number}>} publishStats
 * @param {Array<{platform: string, views: number|null, likes: number|null, comments: number|null}>} engagementData
 * @param {number} failureCount
 * @returns {string}
 */
function buildReportText(reportDate, yesterday, contentOutput, publishStats, engagementData, failureCount) {
  const lines = [];

  lines.push(`ZenithJoy 内容日报 ${reportDate}`);
  lines.push(`统计范围：${yesterday} 全天`);
  lines.push('');

  // ── 板块一：内容产出 ──────────────────────────────────────────────────────
  lines.push('== 内容产出 ==');
  if (contentOutput.count === 0) {
    lines.push('昨日无 content-pipeline 完成任务。');
  } else {
    lines.push(`完成任务数：${contentOutput.count} 条`);
    if (contentOutput.keywords.length > 0) {
      lines.push(`关键词：${contentOutput.keywords.join('、')}`);
    }
  }
  lines.push('');

  // ── 板块二：发布情况 ──────────────────────────────────────────────────────
  lines.push('== 发布情况 ==');
  if (publishStats.length === 0) {
    lines.push('昨日无发布任务。');
  } else {
    for (const stat of publishStats) {
      lines.push(`${stat.platform}：成功 ${stat.success} / 失败 ${stat.failed}`);
    }
  }
  lines.push('');

  // ── 板块三：数据回收 ──────────────────────────────────────────────────────
  lines.push('== 数据回收 ==');
  if (engagementData.length === 0) {
    lines.push('昨日无数据回收记录（payload 中无 views/likes/comments 字段）。');
  } else {
    for (const item of engagementData) {
      lines.push(`${item.platform}：阅读 ${fmt(item.views)} / 点赞 ${fmt(item.likes)} / 评论 ${fmt(item.comments)}`);
    }
  }
  lines.push('');

  // ── 板块四：异常告警 ──────────────────────────────────────────────────────
  lines.push('== 异常告警 ==');
  if (failureCount === 0) {
    lines.push('昨日无发布失败记录，一切正常。');
  } else {
    lines.push(`昨日 content_publish_jobs 失败 ${failureCount} 次，请及时排查。`);
  }
  lines.push('');

  lines.push(`---`);
  lines.push(`由 Cecelia Brain 自动生成 · ${new Date().toISOString()}`);

  return lines.join('\n');
}

// ─── 日报写入 working_memory ──────────────────────────────────────────────────

/**
 * 将日报文本写入 working_memory，key 格式为 daily_report_{YYYY-MM-DD}。
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} date - YYYY-MM-DD（日报日期，即今天）
 * @param {string} reportText
 */
async function saveReportToWorkingMemory(dbPool, date, reportText) {
  const key = WM_REPORT_KEY_PREFIX + date;
  const val = JSON.stringify({ date, report: reportText, generated_at: new Date().toISOString() });
  await dbPool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [key, val]
  );
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 每日内容日报生成器。由 tick.js 在每次 Tick 末尾调用。
 *
 * @param {import('pg').Pool} [dbPool] - PostgreSQL 连接池（默认使用 db.js 的 pool）
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {Promise<{generated: boolean, date: string, skipped_window: boolean, skipped_dup: boolean}>}
 */
export async function generateDailyReport(dbPool = pool, now = new Date()) {
  // 1. 判断是否在触发窗口内（UTC 01:00 ± 5 分钟）
  if (!isInReportTriggerWindow(now)) {
    return { generated: false, date: toDateString(now), skipped_window: true, skipped_dup: false };
  }

  const today = toDateString(now);
  const yesterday = getYesterdayString(now);

  // 2. 幂等：今日是否已生成（同一天内重复触发只执行一次）
  if (await hasTodayReport(dbPool, today)) {
    return { generated: false, date: today, skipped_window: false, skipped_dup: true };
  }

  console.log(`[daily-report-generator] 开始生成 ${today} 日报，统计范围：${yesterday}`);

  try {
    // 3. 并发查询四类数据
    const [contentOutput, publishStats, engagementData, failureCount] = await Promise.all([
      fetchYesterdayContentOutput(dbPool, yesterday),
      fetchYesterdayPublishStats(dbPool, yesterday),
      fetchYesterdayEngagementData(dbPool, yesterday),
      fetchYesterdayFailureCount(dbPool, yesterday),
    ]);

    // 4. 生成日报文本（包含四个板块：内容产出、发布情况、数据回收、异常告警）
    const reportText = buildReportText(today, yesterday, contentOutput, publishStats, engagementData, failureCount);

    // 5. 写入 working_memory，key=daily_report_{YYYY-MM-DD}
    await saveReportToWorkingMemory(dbPool, today, reportText);

    // 6. 标记今日已完成（幂等锁，在推送前写入，避免推送失败导致重复生成）
    await markTodayDone(dbPool, today);

    // 7. 飞书推送（通过 notifier.js，不重复实现飞书推送逻辑；推送失败不影响幂等锁）
    await sendFeishu(reportText).catch(err => {
      console.error(`[daily-report-generator] 飞书推送失败（日报已存储）: ${err.message}`);
    });

    console.log(`[daily-report-generator] 日报生成并推送完成 (${today})`);
    return { generated: true, date: today, skipped_window: false, skipped_dup: false };
  } catch (err) {
    console.error(`[daily-report-generator] 日报生成失败: ${err.message}`);
    throw err;
  }
}
