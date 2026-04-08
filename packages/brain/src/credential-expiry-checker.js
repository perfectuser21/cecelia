/**
 * credential-expiry-checker.js
 *
 * 凭据有效期检查器。读取各 Claude 账号的 OAuth token 过期时间，
 * 在过期前 4h 创建 Brain 告警任务，防止凭据静默失效造成 auth 级联故障。
 *
 * 集成点：tick.js 每 30 分钟调用 checkAndAlertExpiringCredentials()
 *
 * 附加功能：recoverAuthQuarantinedTasks()
 *   当凭据已恢复健康，自动重排队因 auth 失败而被隔离的任务（非 pipeline_rescue）。
 *   防止凭据轮换后业务任务永久沉没在 quarantined 状态。
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
 * 两层告警机制：
 * 1. 常规告警（< 8h）: 6h 去重窗口，同账号不重复创建
 * 2. 紧急升级告警（< 3h）: 2h 去重窗口，以 [URGENT] 前缀绕过常规去重，确保临期不漏报
 *
 * @param {import('pg').Pool} pool - DB 连接池（已传入，无需新建）
 * @returns {Promise<{ checked: number, alerted: number, skipped: number }>}
 */
export async function checkAndAlertExpiringCredentials(pool) {
  const { accounts, criticalAccounts } = checkCredentialExpiry();

  if (criticalAccounts.length === 0) {
    return { checked: accounts.length, alerted: 0, skipped: accounts.length };
  }

  console.log(`[credential-checker] 发现 ${criticalAccounts.length} 个账号凭据即将过期: ${criticalAccounts.map(a => `${a.account}(${a.status})`).join(', ')}`);

  let alerted = 0;

  for (const acc of criticalAccounts) {
    const remainingH = acc.remainingMs > 0
      ? Math.floor(acc.remainingMs / 3600000)
      : 0;
    const remainingM = acc.remainingMs > 0
      ? Math.floor((acc.remainingMs % 3600000) / 60000)
      : 0;

    const isCritical = acc.remainingMs > 0 && acc.remainingMs < CRITICAL_THRESHOLD_MS;
    const statusLabel = acc.status === 'expired' ? '已过期' : `还剩 ${remainingH}h${remainingM}m`;

    try {
      // 紧急升级告警：< 3h 时使用 [URGENT] 前缀 + 2h 去重窗口
      if (isCritical) {
        const urgentTitle = `[P0][URGENT][凭据告警] ${acc.account} OAuth token ${statusLabel}，需立即刷新`;
        const urgentExisting = await pool.query(
          `SELECT id FROM tasks
           WHERE title LIKE $1
             AND status IN ('queued', 'in_progress')
             AND created_at > NOW() - INTERVAL '2 hours'
           LIMIT 1`,
          [`%[URGENT][凭据告警] ${acc.account}%`]
        );

        if (urgentExisting.rows.length === 0) {
          const result = await createTask({
            title: urgentTitle,
            description: `🚨 紧急凭据告警：${acc.account} 的 OAuth token ${statusLabel}（过期时间：${acc.expiresAt}）。\n\n需要立即手动刷新：\n1. 在对应账号目录下重新登录 claude\n2. 或从 1Password CS Vault 同步最新 token\n\n距离过期不足 ${remainingH}h${remainingM}m，任务将开始失败！`,
            task_type: 'research',
            priority: 'P0',
            tags: ['credential-alert', 'credential-urgent', 'auto-generated', acc.account],
            payload: {
              credential_alert: true,
              credential_urgent: true,
              account: acc.account,
              expires_at: acc.expiresAt,
              remaining_ms: acc.remainingMs,
              alert_reason: 'critical_expiry',
            },
          });
          if (!result.deduplicated) {
            alerted++;
            console.log(`[credential-checker] 🚨 URGENT ${acc.account} token ${statusLabel}，已创建紧急 P0 告警`);
          } else {
            console.log(`[credential-checker] ⏭️ ${acc.account} 紧急告警已存在（dedup），跳过`);
          }
          continue;
        } else {
          console.log(`[credential-checker] ⏭️ ${acc.account} 紧急告警已存在（2h window），跳过`);
          continue;
        }
      }

      // 常规告警：6h 去重窗口（queued/in_progress）+ 也排除 24h 内已完成的告警
      const existing = await pool.query(
        `SELECT id, status FROM tasks
         WHERE title LIKE $1
           AND (
             (status IN ('queued', 'in_progress'))
             OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours')
           )
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [`%${acc.account} OAuth token%`]
      );

      if (existing.rows.length > 0) {
        console.log(`[credential-checker] ⏭️ ${acc.account} 告警已存在（status: ${existing.rows[0].status}），跳过`);
        continue;
      }

      const title = `[P0][凭据告警] ${acc.account} OAuth token ${statusLabel}，需立即刷新`;
      const result = await createTask({
        title,
        description: `凭据告警：${acc.account} 的 OAuth token ${statusLabel}（过期时间：${acc.expiresAt}）。\n\n需要手动刷新：在对应账号目录下重新登录 claude，或从 1Password 同步最新 token。`,
        task_type: 'research',
        priority: acc.status === 'expired' ? 'P0' : 'P1',
        tags: ['credential-alert', 'auto-generated', acc.account],
        payload: {
          credential_alert: true,
          account: acc.account,
          expires_at: acc.expiresAt,
          remaining_ms: acc.remainingMs,
          alert_reason: acc.status,
        },
      });

      if (!result.deduplicated) {
        alerted++;
        console.log(`[credential-checker] ⚠️ ${acc.account} token ${statusLabel}，已创建告警任务`);
      } else {
        console.log(`[credential-checker] ⏭️ ${acc.account} 告警已存在（createTask dedup），跳过`);
      }
    } catch (err) {
      console.error(`[credential-checker] 创建告警任务失败 (${acc.account}):`, err.message);
    }
  }

  return { checked: accounts.length, alerted, skipped: accounts.length - criticalAccounts.length };
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
 * 近1小时 auth 失败次数超过此阈值时触发 P1 告警
 * 任何单个账号超阈值即告警（不是总量）
 */
const AUTH_FAIL_RATE_THRESHOLD = 5;

/**
 * scanAuthLayerHealth — 认证层健康度实时探针
 *
 * 补充 proactiveTokenCheck（检查 token 文件过期时间）的不足：
 * 后者无法感知"token 虽未过期，但 executor 运行时认证失败率爆增"的场景。
 *
 * 逻辑：
 * 1. 查询 tasks 表，统计过去 1 小时内 failure_class = 'auth' 的任务，按 dispatched_account 分组
 * 2. 任意账号近1小时 auth 失败 ≥ AUTH_FAIL_RATE_THRESHOLD → 创建 P1 告警任务
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
        AND updated_at > NOW() - INTERVAL '1 hour'
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
        title: `[P1][auth-rate-alert] ${account} 近1小时 auth 失败 ${failCount} 次，超过阈值 ${AUTH_FAIL_RATE_THRESHOLD}`,
        description: `认证层健康度探针触发告警：\n\n账号 ${account} 在过去 1 小时内出现 ${failCount} 次 auth 失败（阈值 ${AUTH_FAIL_RATE_THRESHOLD}）。\n\n这通常表示：\n- OAuth token 已过期但熔断未及时触发\n- Executor 运行时凭据无效（codex provider key 问题）\n- 网络原因导致认证服务不可达\n\n建议：\n1. 检查 /api/brain/credentials/health 确认熔断状态\n2. 检查 ~/.claude-${account}/.credentials.json 中 expiresAt\n3. 必要时从 1Password 同步最新 token`,
        task_type: 'research',
        priority: 'P1',
        tags: ['auth-layer-alert', 'auto-generated', account],
        payload: {
          auth_rate_alert: true,
          account,
          fail_count_1h: failCount,
          threshold: AUTH_FAIL_RATE_THRESHOLD,
          alert_reason: 'auth_fail_rate_exceeded',
        },
      });

      alerted++;
      alertedAccounts.push({ account, fail_count: failCount });
      console.log(`[auth-layer-probe] ⚠️ ${account} 近1小时 auth 失败 ${failCount} 次，已创建 P1 告警`);
    } catch (err) {
      console.error(`[auth-layer-probe] 创建告警任务失败 (${account}):`, err.message);
    }
  }

  return { scanned: ACCOUNTS.length, alerted, accounts: alertedAccounts };
}
