/**
 * account-usage.js
 * Claude Max 账号用量查询与智能调度选择
 *
 * 功能：
 * - 调用 Anthropic OAuth usage API 查询各账号5小时/7天用量
 * - 缓存到 PostgreSQL（TTL 3分钟）
 * - 三阶段降级链：Sonnet → Opus → Haiku → MiniMax(null)
 * - Spending Cap 已废弃：三阶段降级链根据实时用量数据自己路由，不再需要 spending_cap 阻塞
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import pool from './db.js';

const ACCOUNTS = ['account1', 'account2', 'account3'];
const CACHE_TTL_MINUTES = 3;
const USAGE_THRESHOLD = 80;       // 5h 超过此百分比则跳过
const SONNET_7D_THRESHOLD = 100;  // sonnet 7d 满载阈值（≥ 此值时不可用 Sonnet，尝试 Opus）
const OPUS_7D_THRESHOLD = 95;     // 7d all-models Opus 满载阈值（≥ 此值时降级 Haiku）
const HAIKU_7D_THRESHOLD = 100;   // 7d all-models 完全满载阈值（≥ 此值时跳过账号）
const ANTHROPIC_USAGE_API = 'https://api.anthropic.com/api/oauth/usage';

// 模型 ID → quota tier 映射
const MODEL_TIER_MAP = {
  'claude-opus-4-6':            'opus',
  'claude-sonnet-4-6':          'sonnet',
  'claude-haiku-4-5-20251001':  'haiku',
  'claude-haiku-4-5':           'haiku',
};

// 默认降级瀑布（无 cascade 时使用 Sonnet→Haiku）
const DEFAULT_CASCADE = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

/**
 * 判断指定账号是否可以为给定 tier 提供服务
 * @param {Object} account - 账号使用量数据
 * @param {string} tier - 'sonnet'|'opus'|'haiku'
 * @returns {boolean}
 */
function isAccountEligibleForTier(account, tier) {
  if (account.spendingCapped) return false;
  if (account.authFailed) return false;
  if (account.extraUsed) return false;
  if (account.pct >= USAGE_THRESHOLD) return false; // 5h 超限

  switch (tier) {
    case 'sonnet':
      // Sonnet：7d_Sonnet 未满
      return account.sevenDaySonnetPct < SONNET_7D_THRESHOLD;
    case 'opus':
      // Opus：7d_total < 95%（Opus 耗 token 多，以总量衡量）
      return account.sevenDayPct < OPUS_7D_THRESHOLD;
    case 'haiku':
      // Haiku：7d_total 未完全耗尽
      return account.sevenDayPct < HAIKU_7D_THRESHOLD;
    default:
      return false;
  }
}

// ─── Spending Cap 账号级标记 ────────────────────────────────────────────────

/**
 * 内存 Map：accountId → { resetTime: ISO string, setAt: ISO string }
 * 撞 spending cap 的账号在此 Map 中记录，选账号时跳过。
 */
const _spendingCapMap = new Map();

/**
 * 标记账号撞到 spending cap（内存 + 持久化到 DB）
 * @param {string} accountId - 账号 ID（如 'account1'）
 * @param {string|null} resetTimeISO - cap 解除时间（ISO 8601），null 表示 2h 后
 */
export function markSpendingCap(accountId, resetTimeISO = null) {
  const resetTime = resetTimeISO || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  _spendingCapMap.set(accountId, { resetTime, setAt: new Date().toISOString() });
  console.log(`[account-usage] markSpendingCap: ${accountId} capped until ${resetTime}`);
  // 持久化到 DB（fire-and-forget，不阻塞调用方）
  pool.query(
    `INSERT INTO account_usage_cache (account_id, is_spending_capped, spending_cap_resets_at)
     VALUES ($1, true, $2)
     ON CONFLICT (account_id) DO UPDATE SET
       is_spending_capped     = true,
       spending_cap_resets_at = EXCLUDED.spending_cap_resets_at`,
    [accountId, resetTime]
  ).catch(err => console.warn(`[account-usage] markSpendingCap DB 写入失败: ${err.message}`));
}

/**
 * 检查账号是否处于 spending cap 状态（自动清除过期记录）
 */
export function isSpendingCapped(accountId) {
  const cap = _spendingCapMap.get(accountId);
  if (!cap) return false;
  if (new Date(cap.resetTime) <= new Date()) {
    _spendingCapMap.delete(accountId);
    console.log(`[account-usage] ${accountId}: spending cap 已过期，自动解除`);
    // 清除 DB 标记（fire-and-forget）
    pool.query(
      `UPDATE account_usage_cache SET is_spending_capped = false, spending_cap_resets_at = NULL
       WHERE account_id = $1`,
      [accountId]
    ).catch(err => console.warn(`[account-usage] isSpendingCapped DB 清除失败: ${err.message}`));
    return false;
  }
  return true;
}

/**
 * Brain 启动时从 DB 恢复 spending cap 状态
 * 读取所有未过期的 spending cap 记录，恢复内存 Map
 */
export async function loadSpendingCapsFromDB() {
  try {
    const res = await pool.query(
      `SELECT account_id, spending_cap_resets_at FROM account_usage_cache
       WHERE is_spending_capped = true
         AND spending_cap_resets_at > NOW()`
    );
    for (const row of res.rows) {
      _spendingCapMap.set(row.account_id, {
        resetTime: new Date(row.spending_cap_resets_at).toISOString(),
        setAt: new Date().toISOString(),
      });
      console.log(`[account-usage] loadSpendingCapsFromDB: 恢复 ${row.account_id} capped until ${row.spending_cap_resets_at}`);
    }
    if (res.rows.length === 0) {
      console.log('[account-usage] loadSpendingCapsFromDB: 无待恢复的 spending cap 记录');
    }
  } catch (err) {
    console.warn(`[account-usage] loadSpendingCapsFromDB 失败: ${err.message}`);
  }
}

/**
 * 检查是否所有账号都处于 spending cap 状态
 */
export function isAllAccountsSpendingCapped() {
  return ACCOUNTS.every(id => isSpendingCapped(id));
}

/**
 * 获取所有账号的 spending cap 状态（用于日志/API）
 */
export function getSpendingCapStatus() {
  return ACCOUNTS.map(id => {
    const cap = _spendingCapMap.get(id);
    const capped = isSpendingCapped(id);
    return { accountId: id, capped, resetTime: capped ? cap?.resetTime : null };
  });
}

// ─── Auth Failure 账号级熔断 ─────────────────────────────────────────────────

/**
 * 内存 Map：accountId → { resetTime: ISO string, setAt: ISO string, failureCount: number }
 * auth 失败（401）的账号在此 Map 中记录，选账号时跳过，防止级联 quarantine。
 */
const _authFailureMap = new Map();

/**
 * 内存 Map：accountId → number
 * 跟踪各账号连续 auth 失败次数，用于指数退避计算。
 * 凭据恢复（proactiveTokenCheck 确认 token 有效）时重置。
 */
const _authFailureCountMap = new Map();

/**
 * 计算指数退避熔断时长（小时）
 * 第 1 次: 2h，第 2 次: 4h，第 3 次: 8h，第 4+ 次: 24h（封顶）
 */
function _authBackoffHours(failureCount) {
  return Math.min(Math.pow(2, failureCount), 24);
}

/**
 * 标记账号 auth 失败（内存 + 持久化到 DB）
 * 连续失败时自动指数退避：2h → 4h → 8h → 24h（封顶）
 * @param {string} accountId - 账号 ID（如 'account3'）
 * @param {string|null} resetTimeISO - 恢复时间（ISO 8601），null 表示按退避策略计算
 */
export function markAuthFailure(accountId, resetTimeISO = null) {
  const failureCount = (_authFailureCountMap.get(accountId) || 0) + 1;
  _authFailureCountMap.set(accountId, failureCount);

  const backoffHours = _authBackoffHours(failureCount);
  const resetTime = resetTimeISO || new Date(Date.now() + backoffHours * 60 * 60 * 1000).toISOString();
  _authFailureMap.set(accountId, { resetTime, setAt: new Date().toISOString(), failureCount });
  console.log(`[account-usage] [auth-circuit-breaker] markAuthFailure: ${accountId} excluded ${backoffHours}h (attempt ${failureCount}) until ${resetTime}`);
  pool.query(
    `INSERT INTO account_usage_cache (account_id, is_auth_failed, auth_fail_resets_at)
     VALUES ($1, true, $2)
     ON CONFLICT (account_id) DO UPDATE SET
       is_auth_failed       = true,
       auth_fail_resets_at  = EXCLUDED.auth_fail_resets_at`,
    [accountId, resetTime]
  ).catch(err => console.warn(`[account-usage] markAuthFailure DB 写入失败: ${err.message}`));
}

/**
 * 检查账号是否处于 auth 失败熔断状态（自动清除过期记录）
 */
export function isAuthFailed(accountId) {
  const entry = _authFailureMap.get(accountId);
  if (!entry) return false;
  if (new Date(entry.resetTime) <= new Date()) {
    _authFailureMap.delete(accountId);
    console.log(`[account-usage] [auth-circuit-breaker] ${accountId}: auth 失败窗口已过期，自动恢复（退避计数保留至凭据验证）`);
    pool.query(
      `UPDATE account_usage_cache SET is_auth_failed = false, auth_fail_resets_at = NULL
       WHERE account_id = $1`,
      [accountId]
    ).catch(err => console.warn(`[account-usage] isAuthFailed DB 清除失败: ${err.message}`));
    return false;
  }
  return true;
}

/**
 * 重置账号的 auth 失败退避计数（凭据已确认恢复时调用）
 * @param {string} accountId
 */
export function resetAuthFailureCount(accountId) {
  if (_authFailureCountMap.has(accountId)) {
    _authFailureCountMap.delete(accountId);
    console.log(`[account-usage] [auth-circuit-breaker] ${accountId}: 退避计数已重置（凭据已恢复）`);
  }
}

/**
 * Brain 启动时从 DB 恢复 auth 失败状态
 */
export async function loadAuthFailuresFromDB() {
  try {
    const res = await pool.query(
      `SELECT account_id, auth_fail_resets_at FROM account_usage_cache
       WHERE is_auth_failed = true
         AND auth_fail_resets_at > NOW()`
    );
    for (const row of res.rows) {
      _authFailureMap.set(row.account_id, {
        resetTime: new Date(row.auth_fail_resets_at).toISOString(),
        setAt: new Date().toISOString(),
      });
      console.log(`[account-usage] [auth-circuit-breaker] loadAuthFailuresFromDB: 恢复 ${row.account_id} excluded until ${row.auth_fail_resets_at}`);
    }
    if (res.rows.length === 0) {
      console.log('[account-usage] loadAuthFailuresFromDB: 无待恢复的 auth 失败记录');
    }
  } catch (err) {
    console.warn(`[account-usage] loadAuthFailuresFromDB 失败: ${err.message}`);
  }
}

// ─── Proactive Token Expiry Check ─────────────────────────────────────────────

const EXPIRY_WARN_MINUTES = 30; // 提前告警阈值（分钟）
const _expiryAlertedAccounts = new Set(); // 防重复告警

/**
 * 读取账号 OAuth token 的过期信息（不缓存，直接读文件）
 * @param {string} accountId
 * @returns {{ isExpired: boolean, expiresAt: number|null, minsRemaining: number|null }}
 */
function getTokenExpiryInfo(accountId) {
  try {
    const path = `${homedir()}/.claude-${accountId}/.credentials.json`;
    const creds = JSON.parse(readFileSync(path, 'utf8'));
    const expiresAt = creds.claudeAiOauth?.expiresAt;
    if (!expiresAt) return { isExpired: false, expiresAt: null, minsRemaining: null };
    const minsRemaining = (expiresAt - Date.now()) / 60000;
    return { isExpired: minsRemaining <= 0, expiresAt, minsRemaining };
  } catch {
    return { isExpired: false, expiresAt: null, minsRemaining: null };
  }
}

/**
 * 主动检测所有账号 OAuth token 过期状态，无需等待 401 回调：
 * - token 已过期 → 立即 markAuthFailure()，阻止派发
 * - token < 30min 过期 → 触发 P1 告警（每个账号只告警一次）
 * - token 有效 + 之前已 markAuthFailure → 清除熔断（token 已刷新）
 */
export async function proactiveTokenCheck() {
  for (const accountId of ACCOUNTS) {
    const { isExpired, minsRemaining } = getTokenExpiryInfo(accountId);

    if (isExpired) {
      if (!isAuthFailed(accountId)) {
        markAuthFailure(accountId, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
        console.log(`[account-usage] [proactive-check] ${accountId}: token 已过期，标记 auth-failed（24h 熔断）`);
        try {
          const { raise } = await import('./alerting.js');
          raise('P1', `token_expired_${accountId}`, `🔑 ${accountId} OAuth token 已过期 — 新任务已暂停派发，请刷新凭证`).catch(() => {});
        } catch { /* 告警失败不阻断主流程 */ }
      }
    } else if (minsRemaining !== null && minsRemaining < EXPIRY_WARN_MINUTES) {
      if (!_expiryAlertedAccounts.has(accountId)) {
        _expiryAlertedAccounts.add(accountId);
        console.log(`[account-usage] [proactive-check] ${accountId}: token 将在 ${Math.floor(minsRemaining)} 分钟后过期`);
        try {
          const { raise } = await import('./alerting.js');
          raise('P1', `token_expiring_soon_${accountId}`, `⏰ ${accountId} OAuth token 将在 ${Math.floor(minsRemaining)} 分钟后过期 — 请提前刷新凭证`).catch(() => {});
        } catch { /* 告警失败不阻断主流程 */ }
      }
    } else {
      // token 有效：清除过期告警标记；若 auth-failed 是因过期设置的则清除熔断和退避计数
      _expiryAlertedAccounts.delete(accountId);
      if (isAuthFailed(accountId)) {
        _authFailureMap.delete(accountId);
        resetAuthFailureCount(accountId);
        pool.query(
          `UPDATE account_usage_cache SET is_auth_failed = false, auth_fail_resets_at = NULL WHERE account_id = $1`,
          [accountId]
        ).catch(err => console.warn(`[account-usage] proactiveTokenCheck 清除 auth-failed 失败: ${err.message}`));
        console.log(`[account-usage] [proactive-check] ${accountId}: token 已刷新，清除 auth-failed 熔断`);
      }
    }
  }
}

// ─── OAuth Token ─────────────────────────────────────────────────────────────

/**
 * 读取账号的 OAuth accessToken
 */
function getAccessToken(accountId) {
  try {
    const path = `${homedir()}/.claude-${accountId}/.credentials.json`;
    const creds = JSON.parse(readFileSync(path, 'utf8'));
    const token = creds.claudeAiOauth?.accessToken;
    if (!token) {
      console.warn(`[account-usage] ${accountId}: credentials.json 缺少 accessToken`);
      return null;
    }
    const expiresAt = creds.claudeAiOauth?.expiresAt;
    if (expiresAt && Date.now() > expiresAt) {
      console.warn(`[account-usage] ${accountId}: accessToken 已过期`);
    }
    return token;
  } catch (err) {
    console.warn(`[account-usage] ${accountId}: 读取 credentials 失败 - ${err.message}`);
    return null;
  }
}

// ─── Anthropic API ────────────────────────────────────────────────────────────

/**
 * 从 Anthropic API 获取单个账号的用量数据
 */
async function fetchUsageFromAPI(accountId) {
  const token = getAccessToken(accountId);
  if (!token) return null;

  try {
    const res = await fetch(ANTHROPIC_USAGE_API, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'claude-code/2.0.31',
        'anthropic-beta': 'oauth-2025-04-20',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[account-usage] ${accountId}: API 返回 ${res.status}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn(`[account-usage] ${accountId}: API 调用失败 - ${err.message}`);
    return null;
  }
}

// ─── Cache ────────────────────────────────────────────────────────────────────

async function upsertCache(accountId, data) {
  const five_hour_pct        = data.five_hour?.utilization ?? 0;
  const seven_day_pct        = data.seven_day?.utilization ?? 0;
  const seven_day_sonnet_pct = data.seven_day_sonnet?.utilization ?? 0;
  const resets_at                  = data.five_hour?.resets_at || null;
  const seven_day_resets_at        = data.seven_day?.resets_at || null;
  const seven_day_sonnet_resets_at = data.seven_day_sonnet?.resets_at || null;
  const extra_used                 = (data.extra_usage?.utilization ?? 0) >= 100;

  await pool.query(
    `INSERT INTO account_usage_cache
       (account_id, five_hour_pct, seven_day_pct, seven_day_sonnet_pct,
        resets_at, seven_day_resets_at, seven_day_sonnet_resets_at, extra_used, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       five_hour_pct              = EXCLUDED.five_hour_pct,
       seven_day_pct              = EXCLUDED.seven_day_pct,
       seven_day_sonnet_pct       = EXCLUDED.seven_day_sonnet_pct,
       resets_at                  = EXCLUDED.resets_at,
       seven_day_resets_at        = EXCLUDED.seven_day_resets_at,
       seven_day_sonnet_resets_at = EXCLUDED.seven_day_sonnet_resets_at,
       extra_used                 = EXCLUDED.extra_used,
       fetched_at                 = NOW()`,
    [accountId, five_hour_pct, seven_day_pct, seven_day_sonnet_pct,
     resets_at, seven_day_resets_at, seven_day_sonnet_resets_at, extra_used]
  );

  return {
    account_id: accountId,
    five_hour_pct,
    seven_day_pct,
    seven_day_sonnet_pct,
    resets_at,
    seven_day_resets_at,
    seven_day_sonnet_resets_at,
    extra_used,
  };
}

async function getCached(accountId) {
  const res = await pool.query(
    `SELECT * FROM account_usage_cache
     WHERE account_id = $1
       AND fetched_at > NOW() - INTERVAL '${CACHE_TTL_MINUTES} minutes'`,
    [accountId]
  );
  return res.rows[0] || null;
}

async function getStaleCached(accountId) {
  const res = await pool.query(
    'SELECT * FROM account_usage_cache WHERE account_id = $1',
    [accountId]
  );
  return res.rows[0] || null;
}

/**
 * 查询所有账号用量（带缓存）
 * @param {boolean} forceRefresh - 强制忽略缓存，重新从 API 获取
 * @returns {Object} { account1: {...}, account2: {...}, account3: {...} }
 */
export async function getAccountUsage(forceRefresh = false) {
  const results = {};

  for (const accountId of ACCOUNTS) {
    if (!forceRefresh) {
      const cached = await getCached(accountId);
      if (cached) {
        results[accountId] = cached;
        continue;
      }
    }

    const data = await fetchUsageFromAPI(accountId);
    if (data) {
      results[accountId] = await upsertCache(accountId, data);
    } else {
      const stale = await getStaleCached(accountId);
      if (stale) {
        console.warn(`[account-usage] ${accountId}: 使用过期缓存（API 不可用）`);
        results[accountId] = stale;
      } else {
        results[accountId] = {
          account_id: accountId,
          five_hour_pct: 0,
          seven_day_pct: 0,
          seven_day_sonnet_pct: 0,
          resets_at: null,
          seven_day_resets_at: null,
          seven_day_sonnet_resets_at: null,
          extra_used: false,
        };
      }
    }
  }

  return results;
}

// ─── 账号选择 ─────────────────────────────────────────────────────────────────

// 若账号在此分钟数内重置，视其用量为 0（优先消耗即将重置的额度）
const RESET_SOON_MINUTES = 30;

function effectivePct(pct, resetsAt) {
  if (!resetsAt) return pct;
  const minutesUntilReset = (new Date(resetsAt) - Date.now()) / 60000;
  return minutesUntilReset <= RESET_SOON_MINUTES ? 0 : pct;
}

/**
 * 统一账号选择入口（唯一入口，所有 LLM 调用共用）
 *
 * @param {Object} options
 * @param {string} [options.model] - 旧接口兼容：'haiku' 时走 Haiku 独立模式
 * @param {string[]} [options.cascade] - 瀑布降级顺序，完整模型 ID 数组
 *   例：['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
 *   未提供时使用 DEFAULT_CASCADE（Sonnet → Haiku）
 *   cascade 中无 Anthropic 模型时（如只有 MiniMax）返回 null 触发 MiniMax 降级
 *
 * 配额规则（按 tier）：
 *   - sonnet：five_hour_pct < 80 AND seven_day_sonnet_pct < 100
 *   - opus：five_hour_pct < 80 AND seven_day_pct < 95
 *   - haiku：five_hour_pct < 80 AND seven_day_pct < 100
 *
 * @returns {{ accountId: string, model: string, modelId: string }|null}
 *   accountId: 选中的账号 ID
 *   model: 'sonnet'|'opus'|'haiku'（短名）
 *   modelId: 完整模型 ID（如 'claude-sonnet-4-6'）
 *   null → 所有账号不可用，调用方降级到 MiniMax
 */
export async function selectBestAccount(options = {}) {
  await proactiveTokenCheck();
  const { model: requestedModel, cascade: requestedCascade } = options;
  try {
    const usage = await getAccountUsage();

    const SEVEN_DAY_MS = 7 * 24 * 3600 * 1000;
    const now = Date.now();
    const mapped = ACCOUNTS.map(id => {
      const u = usage[id];
      const pct = u?.five_hour_pct ?? 0;
      const ePct = effectivePct(pct, u?.resets_at);
      const sevenDayPct = u?.seven_day_pct ?? 0;
      const sevenDaySonnetPct = u?.seven_day_sonnet_pct ?? 0;
      // 进度对齐（deficit）计算：window_start = resets_at - 7d，elapsed = now - window_start
      let sevenDayDeficit = 0;
      let sevenDaySonnetDeficit = 0;
      if (u?.seven_day_resets_at) {
        const resetsAtMs = new Date(u.seven_day_resets_at).getTime();
        const windowStart = resetsAtMs - SEVEN_DAY_MS;
        const elapsedMs = now - windowStart;
        const targetPct = Math.max(0, Math.min(100, (elapsedMs / SEVEN_DAY_MS) * 100));
        sevenDayDeficit = targetPct - sevenDayPct;
        sevenDaySonnetDeficit = targetPct - sevenDaySonnetPct;
      }
      return {
        id,
        pct,
        ePct,
        sevenDayPct,
        sevenDaySonnetPct,
        sevenDayDeficit,
        sevenDaySonnetDeficit,
        extraUsed: u?.extra_used ?? false,
        spendingCapped: isSpendingCapped(id),
        authFailed: isAuthFailed(id),
      };
    });

    const usageSummary = mapped.map(a =>
      `${a.id}=${a.pct}%/sonnet=${a.sevenDaySonnetPct}%/7d=${a.sevenDayPct}%${a.spendingCapped ? '/CAPPED' : ''}${a.authFailed ? '/AUTH_FAILED' : ''}`
    ).join(', ');

    // ── 旧接口：Haiku 独立模式（向后兼容）──
    if (requestedModel === 'haiku') {
      const candidates = mapped
        .filter(a => isAccountEligibleForTier(a, 'haiku'))
        .sort((a, b) => b.sevenDayDeficit - a.sevenDayDeficit || a.ePct - b.ePct);

      if (candidates.length > 0) {
        const sel = candidates[0];
        console.log(`[account-usage] Haiku 独立模式: 选 ${sel.id}（5h=${sel.pct}%） | ${usageSummary}`);
        return { accountId: sel.id, model: 'haiku', modelId: 'claude-haiku-4-5-20251001' };
      }
      console.log(`[account-usage] Haiku 独立模式: 所有账号不可用 → null | ${usageSummary}`);
      return null;
    }

    // ── 瀑布降级链：按 cascade 顺序逐个模型尝试 ──
    const cascade = requestedCascade || DEFAULT_CASCADE;

    for (const modelId of cascade) {
      const tier = MODEL_TIER_MAP[modelId];
      if (!tier) {
        // 非 Anthropic 模型（MiniMax 等），返回 null 触发调用方降级
        console.log(`[account-usage] cascade 中遇到 ${modelId}（非 Anthropic），返回 null | ${usageSummary}`);
        return null;
      }

      // 找出所有可用此 tier 的账号，按进度对齐（deficit）从高到低排序（最落后的先用）
      const candidates = mapped
        .filter(a => isAccountEligibleForTier(a, tier))
        .sort((a, b) => {
          if (tier === 'sonnet') return b.sevenDaySonnetDeficit - a.sevenDaySonnetDeficit || a.ePct - b.ePct;
          return b.sevenDayDeficit - a.sevenDayDeficit || a.ePct - b.ePct;
        });

      if (candidates.length > 0) {
        const sel = candidates[0];
        const resetNote = sel.ePct === 0 && sel.pct > 0 ? '（即将重置）' : '';
        console.log(
          `[account-usage] 选 ${sel.id} model=${modelId}（tier=${tier}, 5h=${sel.pct}%${resetNote}, ` +
          `sonnet7d=${sel.sevenDaySonnetPct}%, 7d=${sel.sevenDayPct}%） | ${usageSummary}`
        );
        return { accountId: sel.id, model: tier, modelId };
      }

      console.log(`[account-usage] ${modelId}（${tier}）全账号不可用，尝试下一梯队 | ${usageSummary}`);
    }

    // 全部 cascade 耗尽
    console.log(`[account-usage] 所有账号不可用 → 降级到 MiniMax | ${usageSummary}`);
    return null;
  } catch (err) {
    console.error(`[account-usage] selectBestAccount 异常: ${err.message}`);
    return null;
  }
}

/**
 * @deprecated 使用 selectBestAccount({ model: 'haiku' }) 代替
 * 兼容别名，返回格式保持 string|null（向后兼容）
 */
export async function selectBestAccountForHaiku() {
  const result = await selectBestAccount({ model: 'haiku' });
  return result ? result.accountId : null;
}
