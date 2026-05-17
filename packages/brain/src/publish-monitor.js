/**
 * publish-monitor.js
 *
 * 发布队列监控器。
 *
 * 每次 Tick 调用 monitorPublishQueue()：
 *   1. 自动重试 failed 的 content_publish 任务（retry_count < MAX_RETRY）
 *   2. 统计今日发布状态，写入 working_memory key='daily_publish_stats'
 *
 * 设计原则：
 *   - fire-and-forget 友好：内部捕获所有异常，不抛出
 *   - 幂等：多次调用结果一致
 */

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 最大重试次数（超过则不再重试，需人工介入） */
const MAX_RETRY = 3;

/** 重试退避基数（秒）。第 N 次重试等待 RETRY_BACKOFF_BASE_SEC * 2^(N-1) 秒，最长 30 分钟 */
const RETRY_BACKOFF_BASE_SEC = 30;

/** rate_limit 退避倍数（相对于标准退避） */
const RATE_LIMIT_BACKOFF_MULTIPLIER = 2;

/** working_memory key：今日发布统计 */
const STATS_KEY = 'daily_publish_stats';

// ─── failure_type 分类 ────────────────────────────────────────────────────────

/** 发布失败类型枚举 */
export const PUBLISH_FAILURE_TYPE = {
  AUTH_FAIL: 'auth_fail',       // 认证失败 → 不重试，直接告警
  RATE_LIMIT: 'rate_limit',     // 限流 → 2x 退避重试
  NETWORK: 'network',           // 网络错误 → 标准退避重试
  CONTENT_REJECT: 'content_reject', // 内容违规审核拒绝 → 不重试，直接告警
  UNKNOWN: 'unknown',           // 未识别 → 标准退避重试
};

const AUTH_FAIL_PATTERNS = [
  /unauthorized|access\s+denied|forbidden/i,
  /auth.*fail|login.*fail/i,
  /登录.*失败|账号.*失效|账号.*封禁/,
  /token.*invalid|invalid.*token|token.*expired|expired.*token/i,
  /凭据.*失效|credential.*invalid|invalid.*credential/i,
  /not\s+authorized|authentication\s+failed/i,
];

const RATE_LIMIT_PATTERNS = [
  /rate\s+limit|ratelimit/i,
  /too\s+many\s+requests/i,
  /429/,
  /频率|限流|请求.*过.*多/,
  /quota\s+exceeded|daily\s+limit|hourly\s+limit/i,
];

const CONTENT_REJECT_PATTERNS = [
  /content.*reject|reject.*content/i,
  /审核.*不通过|违规|内容.*违禁/,
  /community.*guideline|policy.*violation/i,
  /内容.*不符|不符合.*规范/,
  /sensitive.*content|inappropriate.*content/i,
];

const NETWORK_PATTERNS = [
  /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH|ECONNRESET/i,
  /connection\s+refused|connection\s+reset|connection\s+timeout/i,
  /network\s+error|socket\s+hang\s+up/i,
  /service\s+unavailable|bad\s+gateway|gateway\s+timeout/i,
  /timeout|超时|网络.*错误|连接.*失败/,
];

/**
 * 从 error_message 识别发布失败类型。
 * 优先级：auth_fail > content_reject > rate_limit > network > unknown
 *
 * @param {string|null|undefined} errorMessage
 * @returns {string} PUBLISH_FAILURE_TYPE 之一
 */
export function classifyPublishFailure(errorMessage) {
  if (!errorMessage) return PUBLISH_FAILURE_TYPE.UNKNOWN;
  const msg = String(errorMessage);

  if (AUTH_FAIL_PATTERNS.some(p => p.test(msg))) return PUBLISH_FAILURE_TYPE.AUTH_FAIL;
  if (CONTENT_REJECT_PATTERNS.some(p => p.test(msg))) return PUBLISH_FAILURE_TYPE.CONTENT_REJECT;
  if (RATE_LIMIT_PATTERNS.some(p => p.test(msg))) return PUBLISH_FAILURE_TYPE.RATE_LIMIT;
  if (NETWORK_PATTERNS.some(p => p.test(msg))) return PUBLISH_FAILURE_TYPE.NETWORK;

  return PUBLISH_FAILURE_TYPE.UNKNOWN;
}

// ─── DB 查询 ──────────────────────────────────────────────────────────────────

/**
 * 查询需要重试的 failed content_publish tasks。
 * 条件：status='failed' AND retry_count < MAX_RETRY AND 今日创建
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
async function fetchRetryableTasks(pool) {
  const { rows } = await pool.query(
    `SELECT id, title, retry_count, payload, error_message
     FROM tasks
     WHERE task_type = 'content_publish'
       AND status = 'failed'
       AND retry_count < $1
       AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
     ORDER BY retry_count ASC, created_at ASC`,
    [MAX_RETRY]
  );
  return rows;
}

/**
 * 检查同 pipeline_id + platform 是否已有 completed 的发布任务（幂等保护）。
 * 若已成功发布，重试无意义且会导致重复发帖。
 *
 * @param {import('pg').Pool} pool
 * @param {object} task - 包含 payload 字段的任务行
 * @returns {Promise<boolean>} true = 已成功发布，无需重试
 */
async function isAlreadyPublished(pool, task) {
  const pipelineId = task.payload?.pipeline_id;
  const platform = task.payload?.platform;

  // 无 pipeline_id 时无法判断，保守允许重试
  if (!pipelineId || !platform) return false;

  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE task_type = 'content_publish'
       AND status = 'completed'
       AND payload->>'pipeline_id' = $1
       AND payload->>'platform' = $2
     LIMIT 1`,
    [pipelineId, platform]
  );
  return rows.length > 0;
}

/**
 * 将 failure_type 写入 task payload（不改变状态），用于不重试的失败类型。
 *
 * @param {import('pg').Pool} pool
 * @param {string} taskId
 * @param {string} failureType
 */
async function persistFailureType(pool, taskId, failureType) {
  await pool.query(
    `UPDATE tasks
     SET payload    = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [taskId, JSON.stringify({ failure_type: failureType })]
  );
}

/**
 * 计算退避秒数（含 failure_type 倍数）。
 *
 * @param {number} currentRetry
 * @param {string} failureType
 * @returns {number}
 */
export function calcPublishBackoffSec(currentRetry, failureType) {
  const multiplier = failureType === PUBLISH_FAILURE_TYPE.RATE_LIMIT ? RATE_LIMIT_BACKOFF_MULTIPLIER : 1;
  return Math.min(RETRY_BACKOFF_BASE_SEC * multiplier * Math.pow(2, currentRetry), 1800);
}

/**
 * 重置 task 为 queued 状态并增加 retry_count，写入退避时间和 failure_type。
 *
 * @param {import('pg').Pool} pool
 * @param {string} taskId
 * @param {number} currentRetry
 * @param {string} [failureType]
 */
async function retryTask(pool, taskId, currentRetry, failureType = PUBLISH_FAILURE_TYPE.UNKNOWN) {
  const backoffSec = calcPublishBackoffSec(currentRetry, failureType);
  const nextRunAt = new Date(Date.now() + backoffSec * 1000).toISOString();

  await pool.query(
    `UPDATE tasks
     SET status = 'queued',
         claimed_by = NULL,
         claimed_at = NULL,
         retry_count = $2,
         started_at = NULL,
         updated_at = NOW(),
         payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb
     WHERE id = $1`,
    [taskId, currentRetry + 1, JSON.stringify({ next_run_at: nextRunAt, failure_type: failureType })]
  );
}

/**
 * 统计今日 content_publish tasks 的各状态数量。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<object>} { queued, in_progress, completed, failed, total, platforms }
 */
async function fetchTodayStats(pool) {
  const { rows } = await pool.query(
    `SELECT
       status,
       payload->>'platform' AS platform,
       COUNT(*) AS cnt
     FROM tasks
     WHERE task_type = 'content_publish'
       AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
     GROUP BY status, payload->>'platform'`
  );

  const stats = { queued: 0, in_progress: 0, completed: 0, failed: 0, total: 0 };
  const platformMap = {};

  for (const row of rows) {
    const n = parseInt(row.cnt, 10);
    stats[row.status] = (stats[row.status] || 0) + n;
    stats.total += n;

    const p = row.platform;
    if (p) {
      if (!platformMap[p]) platformMap[p] = { queued: 0, in_progress: 0, completed: 0, failed: 0 };
      platformMap[p][row.status] = (platformMap[p][row.status] || 0) + n;
    }
  }

  const completedCount = stats.completed || 0;
  const totalDone = completedCount + (stats.failed || 0);
  stats.success_rate = totalDone > 0 ? Math.round((completedCount / totalDone) * 100) : null;
  stats.coverage = Object.keys(platformMap).filter(p => platformMap[p].completed > 0).length;
  stats.platforms = platformMap;
  stats.date = new Date().toISOString().slice(0, 10);

  return stats;
}

/**
 * 将统计写入 working_memory，同时 upsert publish_success_daily（每平台每天一行）。
 *
 * @param {import('pg').Pool} pool
 * @param {object} stats
 */
async function writeStats(pool, stats) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [STATS_KEY, JSON.stringify(stats)]
  );

  // 按平台写每日快照
  const date = stats.date || new Date().toISOString().slice(0, 10);
  const platformMap = stats.platforms || {};

  for (const [platform, ps] of Object.entries(platformMap)) {
    const total = (ps.queued || 0) + (ps.in_progress || 0) + (ps.completed || 0) + (ps.failed || 0);
    const completed = ps.completed || 0;
    const failed = ps.failed || 0;
    const totalDone = completed + failed;
    const successRate = totalDone > 0 ? Number(((completed / totalDone) * 100).toFixed(2)) : null;

    await pool.query(
      `INSERT INTO publish_success_daily (platform, date, total, completed, failed, success_rate)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (platform, date) DO UPDATE
         SET total        = EXCLUDED.total,
             completed    = EXCLUDED.completed,
             failed       = EXCLUDED.failed,
             success_rate = EXCLUDED.success_rate`,
      [platform, date, total, completed, failed, successRate]
    );
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 每 tick 调用的发布队列监控器。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{retried: number, stats: object}>}
 */
export async function monitorPublishQueue(pool) {
  let retried = 0;
  let stats = {};

  try {
    // 1. 自动重试失败任务
    const retryable = await fetchRetryableTasks(pool);
    for (const task of retryable) {
      try {
        const platform = task.payload?.platform || 'unknown';
        const failureType = classifyPublishFailure(task.error_message);

        // auth_fail / content_reject：写入 failure_type，不重试，直接告警
        if (failureType === PUBLISH_FAILURE_TYPE.AUTH_FAIL || failureType === PUBLISH_FAILURE_TYPE.CONTENT_REJECT) {
          await persistFailureType(pool, task.id, failureType);
          console.error(
            `[publish-monitor][ALERT] ${platform} 任务 ${task.id} failure_type=${failureType}，跳过重试，需人工介入。error=${String(task.error_message || '').slice(0, 200)}`
          );
          continue;
        }

        // 幂等保护：若同 pipeline_id+platform 已有 completed 记录，跳过重试直接标记完成
        const alreadyDone = await isAlreadyPublished(pool, task);
        if (alreadyDone) {
          await pool.query(
            `UPDATE tasks SET status = 'completed', updated_at = NOW()
             WHERE id = $1 AND status = 'failed'`,
            [task.id]
          );
          console.log(`[publish-monitor] 跳过重试 ${platform}：pipeline_id=${task.payload?.pipeline_id} 已在该平台成功发布，直接标记 completed`);
          continue;
        }

        await retryTask(pool, task.id, task.retry_count, failureType);
        retried++;
        const backoffSec = calcPublishBackoffSec(task.retry_count, failureType);
        console.log(`[publish-monitor] 重试 content_publish: ${platform} (retry ${task.retry_count + 1}/${MAX_RETRY}, failure_type=${failureType}, 退避 ${backoffSec}s)`);
      } catch (err) {
        console.error(`[publish-monitor] 重试任务 ${task.id} 失败: ${err.message}`);
      }
    }

    // 2. 统计今日状态
    stats = await fetchTodayStats(pool);

    // 3. 写入 working_memory
    await writeStats(pool, stats);

    if (stats.total > 0) {
      const rate = stats.success_rate !== null ? `${stats.success_rate}%` : 'N/A';
      console.log(`[publish-monitor] 今日发布统计: 总数=${stats.total} 完成=${stats.completed} 成功率=${rate} 覆盖平台=${stats.coverage}`);
    }
  } catch (err) {
    console.error(`[publish-monitor] 监控异常: ${err.message}`);
  }

  return { retried, stats };
}

/**
 * 从 working_memory 读取最新发布统计（供 API 调用）。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<object|null>}
 */
export async function getPublishStats(pool) {
  const { rows } = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [STATS_KEY]
  );
  return rows[0]?.value_json || null;
}
