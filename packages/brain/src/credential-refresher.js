/**
 * credential-refresher.js
 *
 * Brain 凭据刷新器 — Claude OAuth token 的唯一主动刷新方（single owner）
 *
 * 设计原则：
 * - 全局 lockfile（/tmp/claude-token-refresh.lock）与 cron 脚本共享，
 *   保证任意时刻只有一个刷新进程在运行（Brain OR cron，不会同时）
 * - 原子写：先写 .tmp 再 rename，防止写到一半被其他进程读到损坏的 JSON
 * - 邮箱校验：刷新后验证返回账号邮箱，防止 token 交叉污染
 * - 每账号独立刷新，任一账号失败不影响其余
 *
 * 集成点：tick.js 凭据检查块（每 30 分钟）调用 refreshExpiringCredentials()
 *
 * 分工：
 *   credential-expiry-checker.js — 监控 + 告警（不刷新）
 *   credential-refresher.js      — 主动刷新（本文件）
 *   account-usage.js proactiveTokenCheck — 熔断状态管理（不刷新）
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmdirSync, statSync } from 'fs';
import { homedir } from 'os';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const LOCK_DIR = '/tmp/claude-token-refresh.lock';
const REFRESH_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 剩余 < 3h 时刷新
const LOCK_STALE_MS = 60 * 1000;                  // 超过 60s 的锁视为僵尸锁

const ACCOUNTS = [
  { id: 'account1', email: 'alexperfectapi01@gmail.com' },
  { id: 'account2', email: 'chalexlch@gmail.com' },
  { id: 'account3', email: 'zenithjoy21xx@gmail.com' },
];

// ─── Lock ────────────────────────────────────────────────────────────────────

function acquireLock() {
  // 清除僵尸锁
  try {
    if (existsSync(LOCK_DIR)) {
      const { mtimeMs } = statSync(LOCK_DIR);
      if (Date.now() - mtimeMs > LOCK_STALE_MS) {
        rmdirSync(LOCK_DIR);
        console.log('[credential-refresher] 清除僵尸锁');
      }
    }
  } catch { /* ignore */ }

  try {
    mkdirSync(LOCK_DIR);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try { rmdirSync(LOCK_DIR); } catch { /* ignore */ }
}

// ─── Per-account refresh ─────────────────────────────────────────────────────

/**
 * 刷新单个账号的 OAuth token
 * @param {{ id: string, email: string }} account
 * @returns {Promise<{ account: string, status: 'ok'|'skip'|'error'|'mismatch', detail: string }>}
 */
async function refreshAccount(account) {
  const credsPath = `${homedir()}/.claude-${account.id}/.credentials.json`;

  if (!existsSync(credsPath)) {
    return { account: account.id, status: 'error', detail: 'credentials.json missing' };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(credsPath, 'utf8'));
  } catch (err) {
    return { account: account.id, status: 'error', detail: `parse error: ${err.message}` };
  }

  const oauth = data?.claudeAiOauth;
  if (!oauth?.refreshToken) {
    return { account: account.id, status: 'error', detail: 'no refreshToken' };
  }

  // 检查是否需要刷新
  const remainingMs = oauth.expiresAt - Date.now();
  if (remainingMs > REFRESH_THRESHOLD_MS) {
    const h = (remainingMs / 3600000).toFixed(1);
    return { account: account.id, status: 'skip', detail: `${h}h remaining` };
  }

  // 调用 Anthropic OAuth refresh endpoint
  let tokenData;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: oauth.refreshToken,
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { account: account.id, status: 'error', detail: `API ${res.status}: ${text.slice(0, 120)}` };
    }

    tokenData = await res.json();
  } catch (err) {
    return { account: account.id, status: 'error', detail: err.message };
  }

  // 验证邮箱匹配，防止 token 交叉污染
  const actualEmail = tokenData.account?.email_address || '';
  if (account.email && actualEmail && actualEmail !== account.email) {
    return {
      account: account.id,
      status: 'mismatch',
      detail: `expected ${account.email} got ${actualEmail}`,
    };
  }

  // 构建新 credentials（保留原有 subscriptionType / rateLimitTier）
  const newData = {
    claudeAiOauth: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      scopes: tokenData.scope ? tokenData.scope.split(' ') : (oauth.scopes ?? []),
      subscriptionType: oauth.subscriptionType || 'max',
      rateLimitTier: oauth.rateLimitTier || '',
    },
  };

  // 原子写：先写 .tmp 再 rename
  const tmpPath = credsPath + '.tmp';
  try {
    writeFileSync(tmpPath, JSON.stringify(newData, null, 2), { mode: 0o600 });
    renameSync(tmpPath, credsPath);
  } catch (err) {
    return { account: account.id, status: 'error', detail: `write failed: ${err.message}` };
  }

  return {
    account: account.id,
    status: 'ok',
    detail: `${actualEmail || 'ok'} expires_in=${tokenData.expires_in}s`,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 刷新所有即将过期的账号 token
 *
 * 使用全局 lockfile 保证与 cron 脚本互斥，避免竞态导致 refresh token 失效。
 *
 * @returns {Promise<{ locked: boolean, results: Array<{account,status,detail}> }>}
 */
export async function refreshExpiringCredentials() {
  if (!acquireLock()) {
    console.log('[credential-refresher] 另一个刷新进程正在运行，跳过本次');
    return { locked: false, results: [] };
  }

  const results = [];
  try {
    for (const account of ACCOUNTS) {
      const result = await refreshAccount(account);
      results.push(result);
      const emoji = { ok: '✅', skip: '⏭️', mismatch: '⚠️', error: '❌' }[result.status] ?? '?';
      console.log(`[credential-refresher] ${emoji} ${result.account}: ${result.detail}`);
    }
  } finally {
    releaseLock();
  }

  return { locked: true, results };
}
