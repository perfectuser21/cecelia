/**
 * credential-expiry-checker.js
 *
 * 凭据有效期检查器。读取各 Claude 账号的 OAuth token 过期时间，
 * 在过期前 4h 创建 Brain 告警任务，防止凭据静默失效造成 auth 级联故障。
 *
 * 集成点：tick.js 每 30 分钟调用 checkAndAlertExpiringCredentials()
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { createTask } from './actions.js';

const ALERT_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 小时
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
 * @param {import('pg').Pool} pool - DB 连接池（已传入，无需新建）
 * @returns {Promise<{ checked: number, alerted: number, skipped: number }>}
 */
export async function checkAndAlertExpiringCredentials(pool) {
  const { accounts, criticalAccounts } = checkCredentialExpiry();

  if (criticalAccounts.length === 0) {
    return { checked: accounts.length, alerted: 0, skipped: accounts.length };
  }

  let alerted = 0;

  for (const acc of criticalAccounts) {
    const remainingH = acc.remainingMs > 0
      ? Math.floor(acc.remainingMs / 3600000)
      : 0;
    const remainingM = acc.remainingMs > 0
      ? Math.floor((acc.remainingMs % 3600000) / 60000)
      : 0;

    const statusLabel = acc.status === 'expired' ? '已过期' : `还剩 ${remainingH}h${remainingM}m`;
    const title = `[P0][凭据告警] ${acc.account} OAuth token ${statusLabel}，需立即刷新`;

    // 检查是否已有相同的告警任务（避免重复）
    try {
      const existing = await pool.query(
        `SELECT id FROM tasks
         WHERE title LIKE $1
           AND status IN ('queued', 'in_progress')
           AND created_at > NOW() - INTERVAL '6 hours'
         LIMIT 1`,
        [`%${acc.account} OAuth token%`]
      );

      if (existing.rows.length > 0) {
        continue; // 已有未处理的告警，跳过
      }

      await createTask({
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

      alerted++;
      console.log(`[credential-checker] ⚠️ ${acc.account} token ${statusLabel}，已创建告警任务`);
    } catch (err) {
      console.error(`[credential-checker] 创建告警任务失败 (${acc.account}):`, err.message);
    }
  }

  return { checked: accounts.length, alerted, skipped: accounts.length - criticalAccounts.length };
}
