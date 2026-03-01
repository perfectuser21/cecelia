/**
 * account-usage.js
 * Claude Max 账号用量查询与智能调度选择
 *
 * 功能：
 * - 调用 Anthropic OAuth usage API 查询各账号5小时/7天用量
 * - 缓存到 PostgreSQL（TTL 3分钟）
 * - 选择用量最低的账号进行任务派发
 * - 所有账号满载时自动降级到 MiniMax
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import pool from './db.js';

const ACCOUNTS = ['account1', 'account2', 'account3'];
const CACHE_TTL_MINUTES = 3;
const USAGE_THRESHOLD = 80; // 超过此百分比则跳过该账号
const ANTHROPIC_USAGE_API = 'https://api.anthropic.com/api/oauth/usage';

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
    // 检查是否过期
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
      signal: AbortSignal.timeout(8000), // 8秒超时
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

/**
 * 将用量数据写入缓存
 */
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

/**
 * 获取缓存中的用量（未过期）
 */
async function getCached(accountId) {
  const res = await pool.query(
    `SELECT * FROM account_usage_cache
     WHERE account_id = $1
       AND fetched_at > NOW() - INTERVAL '${CACHE_TTL_MINUTES} minutes'`,
    [accountId]
  );
  return res.rows[0] || null;
}

/**
 * 获取缓存（允许过期）用于降级
 */
async function getStaleCached(accountId) {
  const res = await pool.query(
    'SELECT * FROM account_usage_cache WHERE account_id = $1',
    [accountId]
  );
  return res.rows[0] || null;
}

/**
 * 查询所有账号用量（带缓存）
 *
 * @param {boolean} forceRefresh - 强制忽略缓存，重新从 API 获取
 * @returns {Object} { account1: {...}, account2: {...}, account3: {...} }
 */
export async function getAccountUsage(forceRefresh = false) {
  const results = {};

  for (const accountId of ACCOUNTS) {
    // 优先使用有效缓存
    if (!forceRefresh) {
      const cached = await getCached(accountId);
      if (cached) {
        results[accountId] = cached;
        continue;
      }
    }

    // 调用 API 获取最新数据
    const data = await fetchUsageFromAPI(accountId);
    if (data) {
      results[accountId] = await upsertCache(accountId, data);
    } else {
      // API 失败：使用旧缓存（即使过期）
      const stale = await getStaleCached(accountId);
      if (stale) {
        console.warn(`[account-usage] ${accountId}: 使用过期缓存（API 不可用）`);
        results[accountId] = stale;
      } else {
        // 完全无数据：默认0%，不阻塞调度
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

/**
 * 从 Anthropic 账号中选择用量最低的账号
 *
 * @returns {string|null} 账号 ID（如 'account2'）或 null（所有账号满载，降级 MiniMax）
 */
// 若账号在此分钟数内重置，视其用量为 0（优先消耗即将重置的额度）
const RESET_SOON_MINUTES = 30;

/**
 * 计算有效用量百分比：
 * - 若账号将在 RESET_SOON_MINUTES 内重置 → effectivePct = 0（优先使用）
 * - 否则 effectivePct = 实际用量
 */
function effectivePct(pct, resetsAt) {
  if (!resetsAt) return pct;
  const minutesUntilReset = (new Date(resetsAt) - Date.now()) / 60000;
  return minutesUntilReset <= RESET_SOON_MINUTES ? 0 : pct;
}

export async function selectBestAccount() {
  try {
    const usage = await getAccountUsage();

    // 按有效用量排序：30min 内重置的账号 effectivePct=0 优先；过滤掉实际用量 >= 80% 的账号
    // 次级排序：5h ePct 相同时，按 seven_day_pct 升序（周用量低的优先，确保所有账号均被使用）
    const available = ACCOUNTS
      .map(id => {
        const u = usage[id];
        const pct = u?.five_hour_pct ?? 0;
        const ePct = effectivePct(pct, u?.resets_at);
        const sevenDayPct = u?.seven_day_pct ?? 0;
        return { id, pct, ePct, sevenDayPct };
      })
      .filter(a => a.pct < USAGE_THRESHOLD)
      .sort((a, b) => a.ePct - b.ePct || a.sevenDayPct - b.sevenDayPct);

    if (available.length === 0) {
      // 所有账号满载
      const usageSummary = ACCOUNTS.map(id => `${id}=${usage[id]?.five_hour_pct ?? '?'}%`).join(', ');
      console.log(`[account-usage] 所有 Anthropic 账号满载（>=${USAGE_THRESHOLD}%）: ${usageSummary} → 降级到 MiniMax`);
      return null;
    }

    const selected = available[0];
    const usageSummary = ACCOUNTS.map(id => `${id}=${usage[id]?.five_hour_pct ?? '?'}%`).join(', ');
    const resetNote = selected.ePct === 0 && selected.pct > 0 ? '（即将重置）' : '';
    console.log(`[account-usage] 选择 ${selected.id}（${selected.pct}%${resetNote}），当前用量: ${usageSummary}`);
    return selected.id;
  } catch (err) {
    console.error(`[account-usage] selectBestAccount 异常: ${err.message}`);
    return null; // 降级，不阻塞派发
  }
}
