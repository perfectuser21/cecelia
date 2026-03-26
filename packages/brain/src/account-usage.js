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
      };
    });

    const usageSummary = mapped.map(a =>
      `${a.id}=${a.pct}%/sonnet=${a.sevenDaySonnetPct}%/7d=${a.sevenDayPct}%${a.spendingCapped ? '/CAPPED' : ''}`
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
