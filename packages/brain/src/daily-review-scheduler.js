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
import { createTask } from './actions.js';

// 每日触发时间（UTC 小时）
const DAILY_REVIEW_HOUR_UTC = 2;

// Fallback repo 列表（DB 不可用时使用）
const FALLBACK_REPOS = [
  '/Users/administrator/perfect21/cecelia',
  '/Users/administrator/perfect21/cecelia/workspace',
  '/Users/administrator/perfect21/cecelia/engine',
  '/Users/administrator/perfect21/zenithjoy/workspace',
  '/Users/administrator/perfect21/zenithjoy/creator',
  '/Users/administrator/perfect21/toutiao-publisher-system',
];

/** @module daily-review-scheduler
 * 查询所有有 repo_path 的活跃 project（去重）
 * @param {import('pg').Pool} pool
 * @returns {Promise<string[]>} repo_path 列表
 */
export async function getActiveRepoPaths(pool) {
  // 新 OKR 表：repo_path 存于 metadata 字段，UNION ALL 三张 okr_* 表（UUID 与旧 projects 相同）
  const { rows } = await pool.query(
    `SELECT DISTINCT metadata->>'repo_path' AS repo_path
     FROM (
       SELECT metadata FROM okr_projects WHERE metadata->>'repo_path' IS NOT NULL
         AND metadata->>'repo_path' != ''
       UNION ALL
       SELECT metadata FROM okr_scopes WHERE metadata->>'repo_path' IS NOT NULL
         AND metadata->>'repo_path' != ''
       UNION ALL
       SELECT metadata FROM okr_initiatives WHERE metadata->>'repo_path' IS NOT NULL
         AND metadata->>'repo_path' != ''
     ) sub
     WHERE metadata->>'repo_path' IS NOT NULL
       AND metadata->>'repo_path' != ''
     ORDER BY repo_path`
  );
  return rows.map(r => r.repo_path);
}

/**
 * 拉 20h 内所有 line_ledger，拼成一段纯文本摘要（供 arch_review/strategy_session
 * 任务的 prd_summary 注入，替代各自重新调研 24h 事实）。
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
export async function fetchAllLineLedgersDigest(pool) {
  const { rows } = await pool.query(
    `SELECT title, content FROM design_docs
     WHERE type = 'line_ledger' AND created_at >= NOW() - INTERVAL '20 hours'
     ORDER BY title`
  );
  if (rows.length === 0) return '';
  return rows.map((r) => `### ${r.title}\n${r.content}`).join('\n\n');
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
export async function createCodeReviewTask(pool, repoPath, taskCreator = createTask) {
  // 去重检查
  const alreadyExists = await hasTodayReview(pool, repoPath);
  if (alreadyExists) {
    return { created: false, reason: 'already_today', repo_path: repoPath };
  }

  const repoName = repoPath.split('/').pop() || repoPath;
  const today = new Date().toISOString().slice(0, 10);

  const created = await taskCreator({
    db: pool,
    source: 'scheduler',
    source_id: `daily-code-review:${repoPath}:${today}`,
    title: `[code-review] ${repoName} ${today}`,
    task_type: 'code_review',
    priority: 'P2',
    created_by: 'cecelia-brain',
    trigger_source: 'brain_auto',
    allow_unscoped: true,
    payload: { repo_path: repoPath, since_hours: 24, scope: 'daily' },
  });
  const task_id = created.task.id;
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

// 契约扫描触发时间（UTC 小时）— 03:00，错开 code-review 的 02:00
const CONTRACT_SCAN_HOUR_UTC = 3;

/** @module daily-review-scheduler
 * 判断当前 UTC 时间是否在契约扫描触发窗口内（03:00-03:05）
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {boolean}
 */
export function isInContractScanWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === CONTRACT_SCAN_HOUR_UTC && utcMinute < 5;
}

/** @module daily-review-scheduler
 * 检查今天是否已经触发过契约扫描（去重，避免同一天多次运行）
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasTodayContractScan(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'dev'
       AND created_by = 'contract-scan'
       AND created_at >= CURRENT_DATE::timestamptz
       AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
     LIMIT 1`
  );
  return rows.length > 0;
}

/** @module daily-review-scheduler
 * 每日契约扫描调度入口（Tick 末尾调用，fire-and-forget）
 * 非触发时间直接跳过；触发时间异步运行 run-contract-scan.mjs
 * 结果（未覆盖的契约）由脚本直接写回 Brain 任务队列，无需等待。
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 可注入时间（测试用）
 * @param {Function} [spawnFn] - 可注入 spawn 函数（测试用）
 * @returns {Promise<{ skipped_window: boolean, skipped_today: boolean, triggered: boolean }>}
 */
export async function triggerContractScan(pool, now = new Date(), spawnFn = null) {
  if (!isInContractScanWindow(now)) {
    return { skipped_window: true, skipped_today: false, triggered: false };
  }

  try {
    const alreadyRan = await hasTodayContractScan(pool);
    if (alreadyRan) {
      return { skipped_window: false, skipped_today: true, triggered: false };
    }
  } catch (err) {
    console.warn('[contract-scan] 去重检查失败（继续执行）:', err.message);
  }

  // fire-and-forget：异步启动扫描脚本，不阻塞 tick
  const { fileURLToPath } = await import('url');
  const { dirname, resolve } = await import('path');
  const { spawn } = await import('child_process');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const scriptPath = resolve(__dirname, '../../scripts/run-contract-scan.mjs');

  const spawnImpl = spawnFn || spawn;
  const child = spawnImpl('node', [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  if (child.unref) child.unref();

  console.log(`[contract-scan] 启动每日契约扫描（fire-and-forget），script=${scriptPath}`);
  return { skipped_window: false, skipped_today: false, triggered: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// arch_review 调度器（每 4 小时）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 判断当前 UTC 时间是否在 arch_review 触发窗口内（每4小时：0/4/8/12/16/20 UTC，前5分钟）
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {boolean}
 */
export function isInArchReviewWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour % 4 === 0 && utcMinute < 5;
}

/**
 * 检查过去 4 小时内是否已创建过 arch_review 任务（去重）
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasRecentArchReview(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'arch_review'
       AND created_at >= NOW() - INTERVAL '4 hours'
     LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * 检查上次 arch_review 之后是否有至少 1 个 dev 任务完成（guard 条件）
 * 若从未执行过 arch_review，则视为满足条件（直接允许触发）
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasCompletedDevTaskSinceLastArchReview(pool) {
  const { rows: reviewRows } = await pool.query(
    `SELECT created_at FROM tasks
     WHERE task_type = 'arch_review'
     ORDER BY created_at DESC
     LIMIT 1`
  );

  if (reviewRows.length === 0) {
    return true;
  }

  const lastReviewTime = reviewRows[0].created_at;

  const { rows: devRows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'dev'
       AND status = 'completed'
       AND updated_at > $1
     LIMIT 1`,
    [lastReviewTime]
  );

  return devRows.length > 0;
}

/**
 * arch_review 定时调度入口（每 4 小时，Tick 末尾调用）
 * guard: 上次 review 后至少有 1 个 dev 任务完成
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {Promise<{ triggered: boolean, skipped_window: boolean, skipped_recent: boolean, skipped_guard: boolean }>}
 */
export async function triggerArchReview(pool, now = new Date(), taskCreator = createTask) {
  if (!isInArchReviewWindow(now)) {
    return { triggered: false, skipped_window: true, skipped_recent: false, skipped_guard: false };
  }

  try {
    const alreadyRecent = await hasRecentArchReview(pool);
    if (alreadyRecent) {
      return { triggered: false, skipped_window: false, skipped_recent: true, skipped_guard: false };
    }
  } catch (err) {
    console.warn('[arch-review] 去重检查失败（继续执行）:', err.message);
  }

  try {
    const guardPassed = await hasCompletedDevTaskSinceLastArchReview(pool);
    if (!guardPassed) {
      console.log('[arch-review] Guard 未通过：上次 review 后无 dev 任务完成，跳过');
      return { triggered: false, skipped_window: false, skipped_recent: false, skipped_guard: true };
    }
  } catch (err) {
    console.warn('[arch-review] Guard 检查失败（继续执行）:', err.message);
  }

  try {
    const timestamp = now.toISOString().slice(0, 16).replace('T', ' ');
    const lineLedgerDigest = await fetchAllLineLedgersDigest(pool).catch(() => '');
    const digestSuffix = lineLedgerDigest
      ? ('\n\n## 各线 24h 账本（line_ledger 摘要）\n' + lineLedgerDigest)
      : '';
    const created = await taskCreator({
      db: pool,
      source: 'scheduler',
      source_id: `arch-review:${now.toISOString().slice(0, 13)}`,
      title: `[arch-review] 定时架构巡检 ${timestamp} UTC`,
      task_type: 'arch_review',
      priority: 'P2',
      created_by: 'cecelia-brain',
      trigger_source: 'brain_auto',
      allow_unscoped: true,
      payload: {
        scope: 'scheduled',
        trigger: '4h',
        prd_summary: `架构巡检：扫描 ${timestamp} UTC 时点的 drift / 未收敛模式 / 依赖异常，输出 4A/4B 报告供复盘。${digestSuffix}`,
      },
    });
    const task_id = created.task.id;
    console.log(`[arch-review] Created arch_review task ${task_id}`);
    return { triggered: true, skipped_window: false, skipped_recent: false, skipped_guard: false, task_id };
  } catch (err) {
    console.error('[arch-review] 创建任务失败:', err.message);
    return { triggered: false, skipped_window: false, skipped_recent: false, skipped_guard: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// ci_patrol 调度器（每日北京 08:00 = UTC 00:00，等 03:00 刀A + 04:30 刀B nightly 跑完）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 判断当前 UTC 时间是否在 ci_patrol 每日触发窗口内（00:00-00:05 UTC）
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {boolean}
 */
export function isInCiPatrolWindow(now = new Date()) {
  return now.getUTCHours() === 0 && now.getUTCMinutes() < 5;
}

/**
 * 检查今天是否已创建过 ci_patrol 任务（当日去重）
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasTodayCiPatrol(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'ci_patrol'
       AND created_at >= CURRENT_DATE::timestamptz
       AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
     LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * ci_patrol 定时调度入口（每日，scheduler-jobs 60s 轮询调用，自带窗口+当日去重）
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 可注入时间（测试用）
 * @returns {Promise<{ triggered: boolean, skipped_window: boolean, skipped_recent: boolean }>}
 */
export async function triggerCiPatrol(pool, now = new Date(), taskCreator = createTask) {
  if (!isInCiPatrolWindow(now)) {
    return { triggered: false, skipped_window: true, skipped_recent: false };
  }

  try {
    if (await hasTodayCiPatrol(pool)) {
      return { triggered: false, skipped_window: false, skipped_recent: true };
    }
  } catch (err) {
    console.warn('[ci-patrol] 去重检查失败（继续执行）:', err.message);
  }

  try {
    const today = now.toISOString().slice(0, 10);
    const created = await taskCreator({
      db: pool,
      source: 'scheduler',
      source_id: `ci-patrol:${today}`,
      title: `[ci-patrol] CI/CD 巡检日报 ${today}`,
      task_type: 'ci_patrol',
      priority: 'P2',
      created_by: 'cecelia-brain',
      trigger_source: 'brain_auto',
      allow_unscoped: true,
      payload: {
        scope: 'scheduled', trigger: 'daily', date: today,
        prd_summary: '每日 CI/CD 巡检：按 line 报 4 硬伤（没写/写了没进CI/假绿/正在红），产出日报到 AI Notes + 棘轮 guard。',
      },
    });
    const task_id = created.task.id;
    console.log(`[ci-patrol] Created ci_patrol task ${task_id}`);
    return { triggered: true, skipped_window: false, skipped_recent: false, task_id };
  } catch (err) {
    console.error('[ci-patrol] 创建任务失败:', err.message);
    return { triggered: false, skipped_window: false, skipped_recent: false, error: err.message };
  }
}
