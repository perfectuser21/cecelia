/**
 * credential-expiry-checker.js
 *
 * 凭据有效期检查器。读取各 Claude 账号的 OAuth token 过期时间，
 * 在过期前告警，防止凭据静默失效造成 auth 级联故障。
 *
 * 集成点：tick.js 每 30 分钟调用 checkAndAlertExpiringCredentials()
 *
 * 告警通道：直接调用 raise()（Feishu 推送），不创建需要 Claude API 的 research 任务。
 * 原因：凭据告警创建的 research 任务在 quota 耗尽时本身也会死亡，形成正反馈循环。
 *
 * 附加功能：recoverAuthQuarantinedTasks()
 *   当凭据已恢复健康，自动重排队因 auth 失败而被隔离的任务（非 pipeline_rescue）。
 *   防止凭据轮换后业务任务永久沉没在 quarantined 状态。
 *
 * 附加功能：cancelCredentialAlertTasks()
 *   批量取消所有 quarantined/queued 凭据告警任务（旧机制遗留）。
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { createTask } from './actions.js';

const ALERT_THRESHOLD_MS = 8 * 60 * 60 * 1000; // 8 小时（给更多响应窗口）
const CRITICAL_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 小时 — 触发升级 P0 告警
const ACCOUNTS = ['account1', 'account2', 'account3'];

/**
 * 读取单个账号的 OAuth token 状态
 * @param {string} account - 账号名（account1/account2/account3）
 * @returns {{ account, expiresAt, expiresAtMs, remainingMs, status, error? }}
 */
function readAccountCredential(account) {
  const credPath = `${homedir()}/.claude-${account}/.credentials.json`;
  if (!existsSync(credPath)) {
    return { account, status: 'missing', error: 'credentials file not found' };
  }

  try {
    const raw = JSON.parse(readFileSync(credPath, 'utf8'));
    const oauthData = raw?.claudeAiOauth;
    if (!oauthData?.expiresAt) {
      return { account, status: 'unknown', error: 'no expiresAt field' };
    }

    const expiresAtMs = oauthData.expiresAt;
    const remainingMs = expiresAtMs - Date.now();
    const expiresAt = new Date(expiresAtMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    let status;
    if (remainingMs < 0) {
      status = 'expired';
    } else if (remainingMs < ALERT_THRESHOLD_MS) {
      status = 'expiring_soon';
    } else {
      status = 'ok';
    }

    return { account, expiresAt, expiresAtMs, remainingMs, status };
  } catch (err) {
    return { account, status: 'error', error: err.message };
  }
}

/**
 * 检查所有账号凭据状态
 * @returns {{ accounts: Array, alertNeeded: boolean, criticalAccounts: Array }}
 */
export function checkCredentialExpiry() {
  const accounts = ACCOUNTS.map(readAccountCredential);
  const criticalAccounts = accounts.filter(a => a.status === 'expiring_soon' || a.status === 'expired');
  return {
    accounts,
    alertNeeded: criticalAccounts.length > 0,
    criticalAccounts,
  };
}

/**
 * 检查凭据并在需要时创建 Brain 告警任务
 *
 * 告警通道：使用 raise()（Feishu 推送），不再创建 research 任务。
 * 去重：同账号同级别 1h 内只告警一次（内存去重）。
 *
 * @param {import('pg').Pool} pool - DB 连接池（保留参数，兼容调用方）
 * @returns {Promise<{ checked: number, alerted: number, skipped: number }>}
 */

// 内存去重：dedupKey（`${account}_${level}`）→ 上次告警时间戳
const _alertDedup = new Map();
const ALERT_DEDUP_MS = 60 * 60 * 1000; // 1 小时内同账号同级别不重复推送

/** 测试用：清除告警去重缓存（仅供 test 调用） */
export function _resetAlertDedup() { _alertDedup.clear(); }

export async function checkAndAlertExpiringCredentials(_pool) {
  const { accounts, criticalAccounts } = checkCredentialExpiry();

  if (criticalAccounts.length === 0) {
    return { checked: accounts.length, alerted: 0, skipped: accounts.length };
  }

  console.log(`[credential-checker] 发现 ${criticalAccounts.length} 个账号凭据即将过期: ${criticalAccounts.map(a => `${a.account}(${a.status})`).join(', ')}`);

  const { raise } = await import('./alerting.js');
  let alerted = 0;

  for (const acc of criticalAccounts) {
    const remainingH = acc.remainingMs > 0
      ? Math.floor(acc.remainingMs / 3600000)
      : 0;
    const remainingM = acc.remainingMs > 0
      ? Math.floor((acc.remainingMs % 3600000) / 60000)
      : 0;

    const isCritical = acc.remainingMs > 0 && acc.remainingMs < CRITICAL_THRESHOLD_MS;
    const isExpired = acc.status === 'expired';
    const statusLabel = isExpired ? '已过期' : `还剩 ${remainingH}h${remainingM}m`;
    const level = (isCritical || isExpired) ? 'P0' : 'P1';
    const dedupKey = `${acc.account}_${level}`;

    // 去重检查
    const lastAlert = _alertDedup.get(dedupKey);
    if (lastAlert && (Date.now() - lastAlert) < ALERT_DEDUP_MS) {
      console.log(`[credential-checker] ⏭️ ${acc.account} ${level} 告警已在 1h 内发送，跳过`);
      continue;
    }

    try {
      const msg = isCritical || isExpired
        ? `🚨 [凭据紧急] ${acc.account} OAuth token ${statusLabel}，需立即刷新！（过期时间：${acc.expiresAt}）`
        : `⚠️ [凭据告警] ${acc.account} OAuth token ${statusLabel}，需尽快刷新（过期时间：${acc.expiresAt}）`;

      await raise(level, `credential_expiry_${acc.account}`, msg);
      _alertDedup.set(dedupKey, Date.now());
      alerted++;
      console.log(`[credential-checker] ${level === 'P0' ? '🚨' : '⚠️'} ${acc.account} token ${statusLabel}，已通过 raise() 发送 ${level} 告警`);
    } catch (err) {
      console.error(`[credential-checker] raise() 告警失败 (${acc.account}):`, err.message);
    }
  }

  return { checked: accounts.length, alerted, skipped: accounts.length - criticalAccounts.length };
}

// ============================================================
// 凭据告警任务清理
// ============================================================

/**
 * 批量取消 quarantined/queued 的凭据告警任务
 *
 * 背景：旧机制通过创建 research 任务触发告警，这些任务在 quota 耗尽时会堆积在
 * quarantined 状态。改用 raise() 后这些历史任务已无用，统一 cancel 清理。
 *
 * 幂等：每次 tick 调用安全，已 cancel 的任务不会被重复处理。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ cancelled: number, taskIds: string[] }>}
 */
export async function cancelCredentialAlertTasks(pool) {
  try {
    const result = await pool.query(`
      UPDATE tasks
      SET status = 'cancelled',
          updated_at = NOW(),
          metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{cancel_reason}',
            '"credential_alert_channel_migrated_to_raise"'
          )
      WHERE (
        tags @> ARRAY['credential-alert']::text[]
        OR title LIKE '%凭据告警%'
        OR title LIKE '%credential-alert%'
      )
        AND status IN ('quarantined', 'queued')
      RETURNING id
    `);
    if (result.rowCount > 0) {
      console.log(`[credential-checker] 🧹 批量取消 ${result.rowCount} 个凭据告警任务（已迁移至 raise() 通道）`);
    }
    return { cancelled: result.rowCount, taskIds: result.rows.map(r => r.id) };
  } catch (err) {
    console.error('[credential-checker] cancelCredentialAlertTasks 失败 (non-fatal):', err.message);
    return { cancelled: 0, taskIds: [] };
  }
}

// ============================================================
// 凭据恢复机制
// ============================================================

// 凭据恢复时，最多追溯多久之前的 auth 失败任务
const RECOVERY_LOOKBACK_HOURS = 48;

// 不恢复的任务类型（这些任务即使 auth 恢复也不应重新排队）
const SKIP_TASK_TYPES = ['pipeline_rescue'];

/**
 * 凭据恢复后自动重排队 auth 隔离任务
 *
 * 逻辑：
 * 1. 检查所有账号凭据是否健康（无过期、无 is_auth_failed）
 * 2. 若健康，查找 RECOVERY_LOOKBACK_HOURS 内因 auth 失败被 quarantined 的任务
 * 3. 排除 pipeline_rescue（这些对应旧 worktree，无需恢复）
 * 4. 排除 retry_count >= max_retries 的任务
 * 5. 将符合条件的任务重置为 queued
 *
 * @param {import('pg').Pool} pool - DB 连接池
 * @returns {Promise<{ skipped: string, recovered: number, taskIds: string[] }>}
 */
export async function recoverAuthQuarantinedTasks(pool) {
  // Step 1: 检查本地凭据文件是否健康
  const { criticalAccounts } = checkCredentialExpiry();
  if (criticalAccounts.length > 0) {
    const names = criticalAccounts.map(a => a.account).join(', ');
    return { skipped: `credentials not healthy (${names})`, recovered: 0, taskIds: [] };
  }

  // Step 2: 检查 DB 中 is_auth_failed 熔断状态
  let dbAuthFailed = false;
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as cnt FROM account_usage_cache WHERE is_auth_failed = true`
    );
    dbAuthFailed = parseInt(result.rows[0]?.cnt || '0', 10) > 0;
  } catch {
    // account_usage_cache 不存在时降级跳过 DB 检查
  }

  if (dbAuthFailed) {
    return { skipped: 'db auth_failed circuit still open', recovered: 0, taskIds: [] };
  }

  // Step 3: 查找需要恢复的任务
  const skipTypesPlaceholders = SKIP_TASK_TYPES.map((_, i) => `$${i + 1}`).join(', ');
  let candidateRows;
  try {
    const result = await pool.query(
      `SELECT id, title, retry_count, max_retries
       FROM tasks
       WHERE status = 'quarantined'
         AND payload->>'failure_class' = 'auth'
         AND task_type NOT IN (${skipTypesPlaceholders})
         AND updated_at > NOW() - INTERVAL '${RECOVERY_LOOKBACK_HOURS} hours'
       ORDER BY updated_at DESC`,
      SKIP_TASK_TYPES
    );
    candidateRows = result.rows;
  } catch (err) {
    console.error('[credential-recovery] 查询候选任务失败:', err.message);
    return { skipped: `query failed: ${err.message}`, recovered: 0, taskIds: [] };
  }

  if (candidateRows.length === 0) {
    return { skipped: 'no quarantined auth tasks found', recovered: 0, taskIds: [] };
  }

  // Step 4 & 5: 过滤并重排队
  const eligible = candidateRows.filter(row => {
    const retryCount = parseInt(row.retry_count || '0', 10);
    const maxRetries = parseInt(row.max_retries || '3', 10);
    return retryCount < maxRetries;
  });

  if (eligible.length === 0) {
    return { skipped: 'all candidates exceeded max_retries', recovered: 0, taskIds: [] };
  }

  const ids = eligible.map(r => r.id);
  const idPlaceholders = ids.map((_, i) => `$${i + 1}`).join(', ');

  try {
    await pool.query(
      `UPDATE tasks
       SET status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           payload = (COALESCE(payload, '{}'::jsonb) - 'failure_class') || '{"recovery_source":"credential_recovery"}'::jsonb,
           updated_at = NOW()
       WHERE id IN (${idPlaceholders})`,
      ids
    );

    console.log(`[credential-recovery] ✅ 凭据恢复：${eligible.length} 个 auth 任务已重排队`);
    for (const row of eligible) {
      console.log(`[credential-recovery]   → ${row.id.slice(0, 8)} ${row.title.slice(0, 60)}`);
    }

    return { skipped: null, recovered: eligible.length, taskIds: ids };
  } catch (err) {
    console.error('[credential-recovery] 重排队失败:', err.message);
    return { skipped: `update failed: ${err.message}`, recovered: 0, taskIds: [] };
  }
}

// ============================================================
// 认证层健康度实时探针
// ============================================================

/**
 * 近4小时 auth 失败次数超过此阈值时触发 P1 告警
 * 任何单个账号超阈值即告警（不是总量）
 * 阈值设为 3：account3 故障时实际失败率约 3/UTC-hour，原值 5 从未触发
 */
const AUTH_FAIL_RATE_THRESHOLD = 3;

/**
 * scanAuthLayerHealth — 认证层健康度实时探针
 *
 * 补充 proactiveTokenCheck（检查 token 文件过期时间）的不足：
 * 后者无法感知"token 虽未过期，但 executor 运行时认证失败率爆增"的场景。
 *
 * 逻辑：
 * 1. 查询 tasks 表，统计过去 4 小时内 failure_class = 'auth' 的任务，按 dispatched_account 分组
 * 2. 任意账号近4小时 auth 失败 ≥ AUTH_FAIL_RATE_THRESHOLD → 创建 P1 告警任务
 * 3. 6 小时内已有同账号告警任务（未处理）则跳过重复告警
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ scanned: number, alerted: number, accounts: Array }>}
 */
export async function scanAuthLayerHealth(pool) {
  let failStats;
  try {
    const result = await pool.query(`
      SELECT
        payload->>'dispatched_account' AS account,
        COUNT(*) AS fail_count
      FROM tasks
      WHERE payload->>'failure_class' = 'auth'
        AND updated_at > NOW() - INTERVAL '4 hours'
      GROUP BY payload->>'dispatched_account'
      HAVING COUNT(*) >= $1
    `, [AUTH_FAIL_RATE_THRESHOLD]);
    failStats = result.rows;
  } catch (err) {
    console.error('[auth-layer-probe] 查询失败 (non-fatal):', err.message);
    return { scanned: 0, alerted: 0, accounts: [] };
  }

  if (failStats.length === 0) {
    return { scanned: ACCOUNTS.length, alerted: 0, accounts: [] };
  }

  let alerted = 0;
  const alertedAccounts = [];

  for (const row of failStats) {
    const account = row.account || 'unknown';
    const failCount = parseInt(row.fail_count, 10);

    try {
      // 防重：6 小时内已有未处理的同账号速率告警任务
      const existing = await pool.query(
        `SELECT id FROM tasks
         WHERE title LIKE $1
           AND status IN ('queued', 'in_progress')
           AND created_at > NOW() - INTERVAL '6 hours'
         LIMIT 1`,
        [`%[auth-rate-alert]%${account}%`]
      );
      if (existing.rows.length > 0) {
        continue;
      }

      await createTask({
        title: `[P1][auth-rate-alert] ${account} 近4小时 auth 失败 ${failCount} 次，超过阈值 ${AUTH_FAIL_RATE_THRESHOLD}`,
        description: `认证层健康度探针触发告警：\n\n账号 ${account} 在过去 4 小时内出现 ${failCount} 次 auth 失败（阈值 ${AUTH_FAIL_RATE_THRESHOLD}）。\n\n这通常表示：\n- OAuth token 已过期但熔断未及时触发\n- Executor 运行时凭据无效（codex provider key 问题）\n- 网络原因导致认证服务不可达\n\n建议：\n1. 检查 /api/brain/credentials/health 确认熔断状态\n2. 检查 ~/.claude-${account}/.credentials.json 中 expiresAt\n3. 必要时从 1Password 同步最新 token`,
        task_type: 'research',
        priority: 'P1',
        tags: ['auth-layer-alert', 'auto-generated', account],
        payload: {
          auth_rate_alert: true,
          account,
          fail_count_4h: failCount,
          threshold: AUTH_FAIL_RATE_THRESHOLD,
          alert_reason: 'auth_fail_rate_exceeded',
        },
      });

      alerted++;
      alertedAccounts.push({ account, fail_count: failCount });
      console.log(`[auth-layer-probe] ⚠️ ${account} 近4小时 auth 失败 ${failCount} 次，已创建 P1 告警`);
    } catch (err) {
      console.error(`[auth-layer-probe] 创建告警任务失败 (${account}):`, err.message);
    }
  }

  return { scanned: ACCOUNTS.length, alerted, accounts: alertedAccounts };
}

// ============================================================
// 救援风暴清理（Rescue Storm Cleanup）
// ============================================================

/**
 * cleanupDuplicateRescueTasks — 清理 auth 故障导致的重复 pipeline_rescue 任务
 *
 * 背景：当 auth 故障期间，同一个 worktree 分支的 rescue 任务反复失败，
 * watchdog 每次都创建新的 pipeline_rescue，导致同一分支可能有 3-7 条
 * quarantined rescue 任务堆积（救援风暴）。
 *
 * 逻辑：
 * 1. 仅在凭据全部健康时运行（复用 credential 守卫）
 * 2. 查找同 branch 有 ≥ 2 条 quarantined pipeline_rescue 任务的分支
 * 3. 每个分支保留 updated_at 最新的一条，其余标记为 cancelled
 * 4. 记录 cleanup_reason: 'duplicate_rescue_after_auth_outage' 便于追溯
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ skipped: string|null, cancelled: number, branches: number }>}
 */
export async function cleanupDuplicateRescueTasks(pool) {
  // 守卫：凭据不健康时跳过，避免清理正在恢复中的任务
  const { criticalAccounts } = checkCredentialExpiry();
  if (criticalAccounts.length > 0) {
    const names = criticalAccounts.map(a => a.account).join(', ');
    return { skipped: `credentials not healthy (${names})`, cancelled: 0, branches: 0 };
  }

  // Step 1: 找出同分支有重复 quarantined pipeline_rescue 任务的分支
  let duplicateBranches;
  try {
    const result = await pool.query(`
      SELECT
        payload->>'branch' AS branch,
        COUNT(*) AS task_count
      FROM tasks
      WHERE status = 'quarantined'
        AND task_type = 'pipeline_rescue'
        AND payload->>'branch' IS NOT NULL
      GROUP BY payload->>'branch'
      HAVING COUNT(*) > 1
    `);
    duplicateBranches = result.rows;
  } catch (err) {
    console.error('[rescue-cleanup] 查询重复分支失败 (non-fatal):', err.message);
    return { skipped: `query failed: ${err.message}`, cancelled: 0, branches: 0 };
  }

  if (duplicateBranches.length === 0) {
    return { skipped: null, cancelled: 0, branches: 0 };
  }

  let totalCancelled = 0;

  for (const { branch } of duplicateBranches) {
    try {
      // Step 2: 获取该分支所有 quarantined rescue 任务，按 updated_at 降序排列
      const tasksResult = await pool.query(`
        SELECT id, updated_at
        FROM tasks
        WHERE status = 'quarantined'
          AND task_type = 'pipeline_rescue'
          AND payload->>'branch' = $1
        ORDER BY updated_at DESC
      `, [branch]);

      const tasks = tasksResult.rows;
      if (tasks.length <= 1) continue;

      // 保留最新的（tasks[0]），取消其余
      const toCancel = tasks.slice(1).map(t => t.id);
      const placeholders = toCancel.map((_, i) => `$${i + 1}`).join(', ');

      await pool.query(`
        UPDATE tasks
        SET status = 'cancelled',
            payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
              'cleanup_reason', 'duplicate_rescue_after_auth_outage',
              'kept_task_id', $${toCancel.length + 1},
              'cancelled_by', 'rescue_storm_cleanup',
              'cancelled_at', NOW()::text
            ),
            updated_at = NOW()
        WHERE id IN (${placeholders})
      `, [...toCancel, tasks[0].id]);

      totalCancelled += toCancel.length;
      console.log(`[rescue-cleanup] 分支 ${branch.slice(0, 30)}: 保留 ${tasks[0].id.slice(0, 8)}，取消 ${toCancel.length} 条重复`);
    } catch (err) {
      console.error(`[rescue-cleanup] 处理分支 ${branch} 失败 (non-fatal):`, err.message);
    }
  }

  if (totalCancelled > 0) {
    console.log(`[rescue-cleanup] ✅ 救援风暴清理完成：${duplicateBranches.length} 个分支，取消 ${totalCancelled} 条重复任务`);
  }

  return { skipped: null, cancelled: totalCancelled, branches: duplicateBranches.length };
}
