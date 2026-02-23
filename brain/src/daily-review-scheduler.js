/** @module daily-review-scheduler
 * daily-review-scheduler.js
 *
 * 每日代码审查调度器
 *
 * 每次 Tick 末尾调用 triggerDailyReview()，内部判断是否到达每日触发时间（02:00 UTC）。
 * 如果是，则为所有活跃 repo 创建 code_review task（去重：同一天同一 repo 只创建一次）。
 *
 * 活跃 repo 来源：
 *   1. projects 表中有 repo_path 且非 null 的记录（去重）
 *   2. 如果 DB 查询失败，fallback 到硬编码列表
 */

/* global console */

// 每日触发时间（UTC 小时）
const DAILY_REVIEW_HOUR_UTC = 2;

// Fallback repo 列表（DB 不可用时使用）
const FALLBACK_REPOS = [
  '/home/xx/perfect21/cecelia/core',
  '/home/xx/perfect21/cecelia/workspace',
  '/home/xx/perfect21/cecelia/engine',
  '/home/xx/perfect21/zenithjoy/workspace',
  '/home/xx/perfect21/zenithjoy/creator',
  '/home/xx/perfect21/toutiao-publisher-system',
];

/** @module daily-review-scheduler
 * 查询所有有 repo_path 的活跃 project（去重）
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>} repo_path 列表
 */
export async function getActiveRepoPaths(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT repo_path
     FROM projects
     WHERE repo_path IS NOT NULL
       AND repo_path != ''
     ORDER BY repo_path`
  );
  return rows.map(r => r.repo_path);
}

/** @module daily-review-scheduler
 * 检查今天是否已经为某个 repo 创建过 code_review task
 * @param {import('pg').Pool} pool
 * @param {string} repoPath
 * @returns {Promise<boolean>}
 */
export async function hasTodayReview(pool, repoPath) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'code_review'
       AND payload->>'repo_path' = $1
       AND created_at >= CURRENT_DATE::timestamptz
       AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
     LIMIT 1`,
    [repoPath]
  );
  return rows.length > 0;
}

/** @module daily-review-scheduler
 * 为单个 repo 创建 code_review task（幂等）
 * @param {import('pg').Pool} pool
 * @param {string} repoPath
 * @returns {Promise<{ created: boolean, task_id?: string, reason?: string }>}
 */
export async function createCodeReviewTask(pool, repoPath) {
  // 去重检查
  const alreadyExists = await hasTodayReview(pool, repoPath);
  if (alreadyExists) {
    return { created: false, reason: 'already_today', repo_path: repoPath };
  }

  const repoName = repoPath.split('/').pop() || repoPath;
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO tasks (
       title, task_type, status, priority,
       created_by, payload, trigger_source, location
     )
     VALUES (
       $1, 'code_review', 'queued', 'P2',
       'cecelia-brain', $2, 'brain_auto', 'us'
     )
     RETURNING id`,
    [
      `[code-review] ${repoName} ${today}`,
      JSON.stringify({ repo_path: repoPath, since_hours: 24, scope: 'daily' }),
    ]
  );

  const task_id = rows[0].id;
  console.log(`[daily-review] Created code_review task ${task_id} for repo=${repoName}`);
  return { created: true, task_id, repo_path: repoPath };
}

/** @module daily-review-scheduler
 * 判断当前 UTC 时间是否在每日触发窗口内（02:00-02:05）
 * 每 5 分钟 tick 一次，窗口宽度 = 1 tick 时间
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {boolean}
 */
export function isInDailyWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === DAILY_REVIEW_HOUR_UTC && utcMinute < 5;
}

/** @module daily-review-scheduler
 * 每日代码审查调度入口（Tick 末尾调用）
 * 非触发时间直接跳过，触发时间为每个活跃 repo 创建 code_review task
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {Promise<{ triggered: number, skipped: number, skipped_window: boolean, results: Array }>}
 */
export async function triggerDailyReview(pool, now = new Date()) {
  // 非触发时间直接跳过
  if (!isInDailyWindow(now)) {
    return { triggered: 0, skipped: 0, skipped_window: true, results: [] };
  }

  let triggered = 0;
  let skipped = 0;
  const results = [];

  try {
    // 读取活跃 repo 列表
    let repoPaths = await getActiveRepoPaths(pool);
    if (repoPaths.length === 0) {
      console.log('[daily-review] No repos in DB, using fallback list');
      repoPaths = FALLBACK_REPOS;
    }

    for (const repoPath of repoPaths) {
      const result = await createCodeReviewTask(pool, repoPath);
      results.push(result);
      if (result.created) {
        triggered++;
      } else {
        skipped++;
      }
    }
  } catch (err) {
    console.error('[daily-review] triggerDailyReview error:', err.message);
  }

  if (triggered > 0) {
    console.log(`[daily-review] Triggered ${triggered} code_review tasks, skipped ${skipped}`);
  }

  return { triggered, skipped, skipped_window: false, results };
}
