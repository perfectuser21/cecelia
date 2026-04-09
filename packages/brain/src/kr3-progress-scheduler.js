/**
 * kr3-progress-scheduler.js
 *
 * KR3 微信小程序每日进度报告调度器。
 *
 * 每次 Tick 末尾调用 scheduleKR3ProgressReport()，内部判断是否到达每日触发时间。
 * 若是，查询 KR3 相关任务进度，输出结构化摘要日志。
 *
 * 触发时间：UTC 06:00（北京时间 14:00）
 * 幂等机制：同一天只输出一次报告
 *
 * 目标 KR: ZenithJoy KR3 — 微信小程序上线（基础功能可用，无重大bug）
 */

/** 每日触发小时（UTC）= 北京时间 14:00 */
const KR3_REPORT_HOUR_UTC = 6;

/** KR3 关键词（用于匹配任务 title） */
const KR3_TITLE_KEYWORDS = ['小程序', 'miniapp', 'kr3', 'KR3'];

/** 幂等：记录今日是否已输出报告 */
let _lastReportDate = null;

/**
 * 判断当前时间是否在 KR3 报告触发窗口内（UTC 06:00 ± 5 分钟）。
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInKR3ReportWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === KR3_REPORT_HOUR_UTC && utcMinute < 5;
}

/**
 * 查询 KR3 key result 进度（从 key_results 表）。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{title: string, progress_pct: number}|null>}
 */
async function getKR3KeyResult(pool) {
  const { rows } = await pool.query(`
    SELECT kr.id, kr.title, kr.progress_pct
    FROM key_results kr
    WHERE kr.title ILIKE '%小程序%'
       OR kr.title ILIKE '%KR3%'
    LIMIT 1
  `);
  return rows[0] || null;
}

/**
 * 查询 KR3 相关 dev 任务统计。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{total: number, completed: number, in_progress: number, queued: number, failed: number}>}
 */
async function getKR3TaskStats(pool) {
  const keywordConditions = KR3_TITLE_KEYWORDS.map(
    (kw, i) => `title ILIKE $${i + 1}`
  ).join(' OR ');
  const params = KR3_TITLE_KEYWORDS.map(kw => `%${kw}%`);

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed') AS completed,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       COUNT(*) FILTER (WHERE status = 'queued') AS queued,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COUNT(*) AS total
     FROM tasks
     WHERE (${keywordConditions})
       AND task_type = 'dev'`,
    params
  );
  const row = rows[0] || {};
  return {
    total: parseInt(row.total || 0, 10),
    completed: parseInt(row.completed || 0, 10),
    in_progress: parseInt(row.in_progress || 0, 10),
    queued: parseInt(row.queued || 0, 10),
    failed: parseInt(row.failed || 0, 10),
  };
}

/**
 * 每 Tick 调用：判断是否到达每日报告时间，若是则生成 KR3 进度摘要。
 *
 * @param {import('pg').Pool} pool
 * @param {object} [opts]
 * @param {boolean} [opts.force] - 跳过时间窗口检查，强制立即生成
 * @returns {Promise<{reported: boolean, inWindow: boolean, progress_pct?: number}>}
 */
export async function scheduleKR3ProgressReport(pool, { force = false } = {}) {
  const now = new Date();
  const inWindow = isInKR3ReportWindow(now);

  if (!inWindow && !force) {
    return { reported: false, inWindow: false };
  }

  // 幂等：同一天只报告一次
  const todayStr = now.toISOString().slice(0, 10);
  if (_lastReportDate === todayStr && !force) {
    return { reported: false, inWindow: true };
  }

  try {
    const [kr3, taskStats] = await Promise.all([
      getKR3KeyResult(pool),
      getKR3TaskStats(pool),
    ]);

    const progress = kr3?.progress_pct ?? '未知';
    const remaining = typeof progress === 'number' ? 100 - progress : '?';

    console.log('[kr3-progress] ===== KR3 每日进度报告 =====');
    console.log(`[kr3-progress] 时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (UTC+8)`);
    console.log(`[kr3-progress] 目标: ${kr3?.title || 'KR3 微信小程序上线'}`);
    console.log(`[kr3-progress] 当前进度: ${progress}% | 剩余: ${remaining}%`);
    console.log(`[kr3-progress] Dev 任务: 总${taskStats.total} | 完成${taskStats.completed} | 进行中${taskStats.in_progress} | 排队${taskStats.queued} | 失败${taskStats.failed}`);
    console.log('[kr3-progress] ===========================');

    _lastReportDate = todayStr;
    return { reported: true, inWindow, progress_pct: kr3?.progress_pct };
  } catch (err) {
    console.error('[kr3-progress] 进度报告生成失败:', err.message);
    return { reported: false, inWindow, error: err.message };
  }
}
