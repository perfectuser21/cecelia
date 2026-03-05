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
const OPUS_THRESHOLD = 95;        // 7d all-models 超过此百分比视为 Opus 满载
const ANTHROPIC_USAGE_API = 'https://api.anthropic.com/api/oauth/usage';

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
  const resets_at            = data.five_hour?.resets_at || null;
  const seven_day_resets_at  = data.seven_day?.resets_at || null;
  const extra_used           = (data.extra_usage?.utilization ?? 0) >= 100;

  await pool.query(
    `INSERT INTO account_usage_cache
       (account_id, five_hour_pct, seven_day_pct, seven_day_sonnet_pct,
        resets_at, seven_day_resets_at, extra_used, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       five_hour_pct        = EXCLUDED.five_hour_pct,
       seven_day_pct        = EXCLUDED.seven_day_pct,
       seven_day_sonnet_pct = EXCLUDED.seven_day_sonnet_pct,
       resets_at            = EXCLUDED.resets_at,
       seven_day_resets_at  = EXCLUDED.seven_day_resets_at,
       extra_used           = EXCLUDED.extra_used,
       fetched_at           = NOW()`,
    [accountId, five_hour_pct, seven_day_pct, seven_day_sonnet_pct,
     resets_at, seven_day_resets_at, extra_used]
  );

  return {
    account_id: accountId,
    five_hour_pct,
    seven_day_pct,
    seven_day_sonnet_pct,
    resets_at,
    seven_day_resets_at,
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
 * @param {string} options.model - 请求的模型类型：'haiku'|'sonnet'|'opus'|undefined
 *   - 'haiku': Haiku 独立配额模式（只看 5h，不看 sonnet/opus 7d）
 *   - undefined/其他: 三阶段降级链（Sonnet → Opus → Haiku → MiniMax）
 *
 * 所有模式统一过滤 spending cap（账号级限制，跟模型无关）。
 *
 * @returns {{ accountId: string, model: string }|null}
 *   accountId: 选中的账号 ID
 *   model: 'sonnet'|'opus'|'haiku'
 *   null → 所有账号不可用，调用方降级到 MiniMax
 */
export async function selectBestAccount(options = {}) {
  const requestedModel = options.model;
  try {
    const usage = await getAccountUsage();

    const mapped = ACCOUNTS.map(id => {
      const u = usage[id];
      const pct = u?.five_hour_pct ?? 0;
      const ePct = effectivePct(pct, u?.resets_at);
      return {
        id,
        pct,
        ePct,
        sevenDayPct: u?.seven_day_pct ?? 0,
        sevenDaySonnetPct: u?.seven_day_sonnet_pct ?? 0,
        extraUsed: u?.extra_used ?? false,
        spendingCapped: isSpendingCapped(id),
      };
    });

    const usageSummary = mapped.map(a =>
      `${a.id}=${a.pct}%/sonnet=${a.sevenDaySonnetPct}%/7d=${a.sevenDayPct}%${a.spendingCapped ? '/CAPPED' : ''}`
    ).join(', ');

    // ── Haiku 独立模式：只看 5h + spending cap ──
    if (requestedModel === 'haiku') {
      const haikuCandidates = mapped
        .filter(a => !a.spendingCapped && !a.extraUsed && a.pct < USAGE_THRESHOLD)
        .sort((a, b) => a.ePct - b.ePct || a.sevenDayPct - b.sevenDayPct);

      if (haikuCandidates.length > 0) {
        const sel = haikuCandidates[0];
        console.log(`[account-usage] Haiku 独立模式: 选 ${sel.id}（5h=${sel.pct}%） | ${usageSummary}`);
        return { accountId: sel.id, model: 'haiku' };
      }
      console.log(`[account-usage] Haiku 独立模式: 所有账号不可用 → null | ${usageSummary}`);
      return null;
    }

    // ── 三阶段降级链（默认模式）──

    // 阶段1 Sonnet
    const sonnetCandidates = mapped
      .filter(a => !a.spendingCapped && !a.extraUsed && a.pct < USAGE_THRESHOLD && a.sevenDaySonnetPct < 100)
      .sort((a, b) => a.sevenDaySonnetPct - b.sevenDaySonnetPct || a.ePct - b.ePct || a.sevenDayPct - b.sevenDayPct);

    if (sonnetCandidates.length > 0) {
      const sel = sonnetCandidates[0];
      const resetNote = sel.ePct === 0 && sel.pct > 0 ? '（即将重置）' : '';
      console.log(`[account-usage] Sonnet 阶段: 选 ${sel.id}（5h=${sel.pct}%${resetNote} sonnet7d=${sel.sevenDaySonnetPct}%） | ${usageSummary}`);
      return { accountId: sel.id, model: 'sonnet' };
    }

    // 阶段2 Opus
    const opusCandidates = mapped
      .filter(a => !a.spendingCapped && a.pct < USAGE_THRESHOLD && a.sevenDayPct < OPUS_THRESHOLD)
      .sort((a, b) => a.sevenDayPct - b.sevenDayPct || a.ePct - b.ePct);

    if (opusCandidates.length > 0) {
      const sel = opusCandidates[0];
      console.log(`[account-usage] Opus 阶段（Sonnet 全满）: 选 ${sel.id}（5h=${sel.pct}% 7d=${sel.sevenDayPct}%） | ${usageSummary}`);
      return { accountId: sel.id, model: 'opus' };
    }

    // 阶段3 Haiku
    const haikuFallback = mapped
      .filter(a => !a.spendingCapped && a.pct < USAGE_THRESHOLD)
      .sort((a, b) => a.ePct - b.ePct || a.sevenDayPct - b.sevenDayPct);

    if (haikuFallback.length > 0) {
      const sel = haikuFallback[0];
      console.log(`[account-usage] Haiku 阶段（Sonnet+Opus 全满）: 选 ${sel.id}（5h=${sel.pct}%） | ${usageSummary}`);
      return { accountId: sel.id, model: 'haiku' };
    }

    // 兜底 MiniMax
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
