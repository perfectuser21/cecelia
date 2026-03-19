/** @module daily-reflection-scheduler
 * daily-reflection-scheduler.js
 *
 * 每日自检反思调度器
 *
 * 每次 Tick 末尾调用 triggerDailyReflection()，内部判断是否到达每日触发时间（04:00 UTC = 北京 12:00）。
 * 如果是，则分析最近 7 天的 dev_execution_logs 和未应用的 learnings，
 * 发现反复出现的问题时自动创建 self_fix 任务。
 */

/* global console */

// 每日触发时间（UTC 小时）— 04:00 UTC = 北京 12:00
// 错开 code-review 02:00 和 contract-scan 03:00
const DAILY_REFLECTION_HOUR_UTC = 4;

// 同一 error_message 出现 N 次以上视为反复问题
const RECURRING_THRESHOLD = 3;

// 分析窗口（天）
const ANALYSIS_WINDOW_DAYS = 7;

/**
 * 判断当前 UTC 时间是否在每日反思触发窗口内（04:00-04:05）
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {boolean}
 */
export function isInReflectionWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === DAILY_REFLECTION_HOUR_UTC && utcMinute < 5;
}

/**
 * 检查今天是否已经触发过每日反思（去重）
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasTodayReflection(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'dev'
       AND trigger_source = 'daily_reflection'
       AND title LIKE '[self-fix]%'
       AND created_at >= CURRENT_DATE::timestamptz
       AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
     LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * 查询最近 N 天的执行日志聚合统计
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ total: number, failed: number, failRate: string, topErrors: Array }>}
 */
export async function analyzeExecutionLogs(pool) {
  // 总量和失败数
  const { rows: statsRows } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM dev_execution_logs
     WHERE created_at >= NOW() - $1::interval`,
    [`${ANALYSIS_WINDOW_DAYS} days`]
  );

  const total = parseInt(statsRows[0].total, 10) || 0;
  const failed = parseInt(statsRows[0].failed, 10) || 0;
  const failRate = total > 0 ? ((failed / total) * 100).toFixed(1) + '%' : '0%';

  // 最常见失败原因（TOP 5）
  const { rows: topErrors } = await pool.query(
    `SELECT
       COALESCE(
         SUBSTRING(error_message FROM 1 FOR 120),
         '(unknown)'
       ) AS error_summary,
       COUNT(*) AS occurrences,
       array_agg(DISTINCT task_id) AS task_ids
     FROM dev_execution_logs
     WHERE status = 'failed'
       AND created_at >= NOW() - $1::interval
     GROUP BY error_summary
     ORDER BY occurrences DESC
     LIMIT 5`,
    [`${ANALYSIS_WINDOW_DAYS} days`]
  );

  return { total, failed, failRate, topErrors };
}

/**
 * 查询未应用的 learnings
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function getUnappliedLearnings(pool) {
  const { rows } = await pool.query(
    `SELECT id, title, category, content, created_at
     FROM learnings
     WHERE applied = false
       AND archived = false
     ORDER BY created_at DESC
     LIMIT 20`
  );
  return rows;
}

/**
 * 为反复出现的问题创建 self_fix 任务
 * @param {import('pg').Pool} pool
 * @param {{ error_summary: string, occurrences: number, task_ids: string[] }} errorPattern
 * @returns {Promise<{ created: boolean, task_id?: string, reason?: string }>}
 */
export async function createSelfFixTask(pool, errorPattern) {
  const today = new Date().toISOString().slice(0, 10);
  const title = `[self-fix] 修复反复出现的问题: ${errorPattern.error_summary.slice(0, 60)}`;

  // 去重：今天是否已为同一 error_summary 创建过
  const { rows: existing } = await pool.query(
    `SELECT id FROM tasks
     WHERE title = $1
       AND created_at >= CURRENT_DATE::timestamptz
       AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
     LIMIT 1`,
    [title]
  );

  if (existing.length > 0) {
    return { created: false, reason: 'already_today' };
  }

  const description = [
    `## 问题描述`,
    ``,
    `在最近 ${ANALYSIS_WINDOW_DAYS} 天的 dev_execution_logs 中发现同一错误反复出现 ${errorPattern.occurrences} 次。`,
    ``,
    `**错误摘要**: ${errorPattern.error_summary}`,
    `**出现次数**: ${errorPattern.occurrences}`,
    `**关联任务 ID**: ${(errorPattern.task_ids || []).slice(0, 5).join(', ')}`,
    `**发现日期**: ${today}`,
    ``,
    `## 修复要求`,
    ``,
    `1. 分析错误根因`,
    `2. 修复代码或配置`,
    `3. 添加防回归测试`,
    `4. 写 learning 文件记录经验`,
  ].join('\n');

  const { rows } = await pool.query(
    `INSERT INTO tasks (
       title, task_type, status, priority,
       description, created_by, trigger_source,
       payload, location
     )
     VALUES (
       $1, 'dev', 'queued', 'P1',
       $2, 'cecelia-brain', 'daily_reflection',
       $3, 'us'
     )
     RETURNING id`,
    [
      title,
      description,
      JSON.stringify({
        pattern: errorPattern.error_summary,
        occurrences: parseInt(errorPattern.occurrences, 10),
        task_ids: (errorPattern.task_ids || []).slice(0, 10),
        analysis_window_days: ANALYSIS_WINDOW_DAYS,
      }),
    ]
  );

  const task_id = rows[0].id;
  console.log(`[daily-reflection] Created self-fix task ${task_id}: ${errorPattern.error_summary.slice(0, 60)}`);
  return { created: true, task_id };
}

/**
 * 每日自检反思调度入口（Tick 末尾调用）
 * 非触发时间直接跳过，触发时间分析执行日志和 learnings，发现问题时创建 self_fix 任务
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {Promise<{ triggered: boolean, skipped_window: boolean, skipped_today: boolean, findings: object|null }>}
 */
export async function triggerDailyReflection(pool, now = new Date()) {
  // 非触发时间直接跳过
  if (!isInReflectionWindow(now)) {
    return { triggered: false, skipped_window: true, skipped_today: false, findings: null };
  }

  // 去重：今天已跑过就不跑
  try {
    const alreadyRan = await hasTodayReflection(pool);
    if (alreadyRan) {
      return { triggered: false, skipped_window: false, skipped_today: true, findings: null };
    }
  } catch (err) {
    console.warn('[daily-reflection] 去重检查失败（继续执行）:', err.message);
  }

  console.log('[daily-reflection] 开始每日自检反思…');

  // 1. 分析执行日志
  let logAnalysis = { total: 0, failed: 0, failRate: '0%', topErrors: [] };
  try {
    logAnalysis = await analyzeExecutionLogs(pool);
  } catch (err) {
    console.warn('[daily-reflection] 执行日志分析失败:', err.message);
  }

  // 2. 查询未应用的 learnings
  let unappliedLearnings = [];
  try {
    unappliedLearnings = await getUnappliedLearnings(pool);
  } catch (err) {
    console.warn('[daily-reflection] learnings 查询失败:', err.message);
  }

  // 3. 为反复问题创建 self_fix 任务
  let selfFixCreated = 0;
  const selfFixResults = [];
  for (const errorPattern of logAnalysis.topErrors) {
    if (parseInt(errorPattern.occurrences, 10) >= RECURRING_THRESHOLD) {
      try {
        const result = await createSelfFixTask(pool, errorPattern);
        selfFixResults.push(result);
        if (result.created) selfFixCreated++;
      } catch (err) {
        console.warn(`[daily-reflection] self-fix 任务创建失败: ${err.message}`);
      }
    }
  }

  const findings = {
    execution_logs: {
      total: logAnalysis.total,
      failed: logAnalysis.failed,
      fail_rate: logAnalysis.failRate,
      top_errors_count: logAnalysis.topErrors.length,
    },
    unapplied_learnings: unappliedLearnings.length,
    self_fix_tasks_created: selfFixCreated,
  };

  console.log(
    `[daily-reflection] 完成: ` +
    `日志总量=${logAnalysis.total}, 失败率=${logAnalysis.failRate}, ` +
    `未应用learnings=${unappliedLearnings.length}, ` +
    `创建self-fix任务=${selfFixCreated}`
  );

  return { triggered: true, skipped_window: false, skipped_today: false, findings };
}
