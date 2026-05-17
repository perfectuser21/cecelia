/**
 * daily-publish-scheduler.js
 *
 * 每日自动发布调度器。
 *
 * 每次 Tick 末尾调用 triggerDailyPublish()，内部判断是否到达每日触发时间（UTC 03:00 = 北京时间 11:00）。
 * 如果是，则处理 content_publish_jobs 中的 pending 任务，按优先级为每个平台创建 content_publish task。
 *
 * 触发窗口：UTC 03:00 - 03:05（北京时间 11:00 - 11:05）
 * 优先级平台：douyin > xiaohongshu > wechat > kuaishou > weibo > toutiao > zhihu > shipinhao
 * 去重策略：working_memory key='daily_publish_triggered' + 当日幂等检查
 */

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 每日触发时间（UTC 小时）= 北京时间 11:00 */
const DAILY_PUBLISH_HOUR_UTC = 3;

/** 触发窗口分钟数 */
const TRIGGER_WINDOW_MINUTES = 5;

/** 平台优先级顺序（数组顺序即优先级，低索引优先） */
const PLATFORM_PRIORITY = [
  'douyin',
  'xiaohongshu',
  'wechat',
  'kuaishou',
  'weibo',
  'toutiao',
  'zhihu',
  'shipinhao',
];

/** working_memory key：今日发布触发记录 */
const WM_KEY = 'daily_publish_triggered';

// ─── 时间工具 ─────────────────────────────────────────────────────────────────

/**
 * 判断当前时间是否在每日发布触发窗口内。
 *
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {boolean}
 */
export function isInPublishTriggerWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const inHour = utcHour === DAILY_PUBLISH_HOUR_UTC;
  const inMinute = utcMinute < TRIGGER_WINDOW_MINUTES;
  return inHour && inMinute;
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

// ─── DB 工询 ──────────────────────────────────────────────────────────────────

/**
 * 检查今天是否已经触发过每日发布。
 *
 * @param {import('pg').Pool} pool
 * @param {Date} [now]
 * @returns {Promise<boolean>}
 */
export async function hasTodayPublish(pool, now = new Date()) {
  const today = toDateString(now);
  const { rows } = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [WM_KEY]
  );
  if (rows.length === 0) return false;
  const val = rows[0].value_json;
  return val?.date === today;
}

/**
 * 查询 content_publish_jobs 中状态为 pending 的任务，按优先级排序。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
async function fetchPendingJobs(pool) {
  const { rows } = await pool.query(
    `SELECT id, platform, content_type, payload, status, created_at
     FROM content_publish_jobs
     WHERE status = 'pending'
     ORDER BY created_at ASC`
  );
  return rows;
}

/**
 * 检查今日是否已有指定平台的 content_publish 任务（幂等保护）。
 *
 * @param {import('pg').Pool} pool
 * @param {string} platform
 * @param {string} today - YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
async function hasTodayPublishTask(pool, platform, today) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'content_publish'
       AND payload->>'platform' = $1
       AND DATE(created_at) = $2
       AND status IN ('queued', 'in_progress', 'completed')
     LIMIT 1`,
    [platform, today]
  );
  return rows.length > 0;
}

/**
 * 为一个 content_publish_job 创建 content_publish 任务。
 *
 * @param {import('pg').Pool} pool
 * @param {object} job - content_publish_jobs 行
 * @param {string} today - YYYY-MM-DD
 * @returns {Promise<string>} 创建的 task id
 */
async function createPublishTask(pool, job, today) {
  const payload = {
    platform: job.platform,
    content_type: job.content_type,
    publish_job_id: job.id,
    ...(job.payload || {}),
    trigger_source: 'daily_publish_scheduler',
    scheduled_date: today,
  };

  const { rows } = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, trigger_source, payload, created_at)
     VALUES ($1, 'content_publish', 'queued', $2, 'daily_publish_scheduler', $3, NOW())
     RETURNING id`,
    [
      `[每日发布] ${job.platform} — ${today}`,
      job.platform === 'douyin' || job.platform === 'xiaohongshu' || job.platform === 'wechat' ? 'P1' : 'P2',
      JSON.stringify(payload),
    ]
  );

  return rows[0]?.id;
}

/**
 * 将 content_publish_job 状态更新为 running（已派发）。
 *
 * @param {import('pg').Pool} pool
 * @param {string} jobId
 */
async function markJobRunning(pool, jobId) {
  await pool.query(
    `UPDATE content_publish_jobs SET status = 'running', updated_at = NOW() WHERE id = $1`,
    [jobId]
  );
}

/**
 * 记录今日已触发。
 *
 * @param {import('pg').Pool} pool
 * @param {string} today
 * @param {number} created
 * @param {string[]} platforms
 */
async function recordTodayTrigger(pool, today, created, platforms) {
  const val = JSON.stringify({ date: today, created, platforms, triggered_at: new Date().toISOString() });
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [WM_KEY, val]
  );
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 每日发布触发器。由 tick.js 在每次 Tick 末尾调用。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {Promise<{created: number, skipped: boolean, skipped_window: boolean, platforms: string[]}>}
 */
export async function triggerDailyPublish(pool, now = new Date()) {
  // 1. 判断是否在触发窗口内
  if (!isInPublishTriggerWindow(now)) {
    return { created: 0, skipped: false, skipped_window: true, platforms: [] };
  }

  // 2. 今日是否已触发（去重）
  if (await hasTodayPublish(pool, now)) {
    return { created: 0, skipped: true, skipped_window: false, platforms: [] };
  }

  const today = toDateString(now);

  // 3. 获取 pending jobs
  const pendingJobs = await fetchPendingJobs(pool);
  if (pendingJobs.length === 0) {
    console.log('[daily-publish-scheduler] 无 pending content_publish_jobs，跳过');
    await recordTodayTrigger(pool, today, 0, []);
    return { created: 0, skipped: false, skipped_window: false, platforms: [] };
  }

  // 4. 按优先级排序 jobs（PLATFORM_PRIORITY 中靠前的先处理）
  const sortedJobs = [...pendingJobs].sort((a, b) => {
    const ia = PLATFORM_PRIORITY.indexOf(a.platform);
    const ib = PLATFORM_PRIORITY.indexOf(b.platform);
    const ra = ia === -1 ? 999 : ia;
    const rb = ib === -1 ? 999 : ib;
    return ra - rb;
  });

  // 5. 为每个 job 创建 content_publish task（幂等保护）
  let created = 0;
  const createdPlatforms = [];

  for (const job of sortedJobs) {
    // 幂等：今日是否已有该平台任务
    const alreadyExists = await hasTodayPublishTask(pool, job.platform, today);
    if (alreadyExists) {
      console.log(`[daily-publish-scheduler] ${job.platform} 今日已有 content_publish 任务，跳过`);
      continue;
    }

    try {
      const taskId = await createPublishTask(pool, job, today);
      await markJobRunning(pool, job.id);
      created++;
      createdPlatforms.push(job.platform);
      console.log(`[daily-publish-scheduler] ${job.platform} → content_publish task 已创建 (${taskId})`);
    } catch (err) {
      console.error(`[daily-publish-scheduler] 创建 ${job.platform} 任务失败: ${err.message}`);
    }
  }

  // 6. 记录今日已触发
  await recordTodayTrigger(pool, today, created, createdPlatforms);

  console.log(`[daily-publish-scheduler] 每日发布调度完成：${created} 个平台任务已创建 (${createdPlatforms.join(', ')})`);
  return { created, skipped: false, skipped_window: false, platforms: createdPlatforms };
}
