/**
 * codex-account-usage.cjs
 * Codex 账号用量查询与智能调度选择
 *
 * 通过 wham/usage API 查询 5 个 Codex 账号的用量，
 * 选择 used_percent 最低的账号执行任务。
 * 内存缓存 3 分钟，无需数据库。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// BRIDGE_ACCOUNTS 环境变量：逗号分隔的账号列表（如 "team3,team4"）
// 未设置时默认 team1-5（向后兼容）
const ACCOUNTS = process.env.BRIDGE_ACCOUNTS
  ? process.env.BRIDGE_ACCOUNTS.split(',').map(s => s.trim()).filter(Boolean)
  : ['team1', 'team2', 'team3', 'team4', 'team5'];
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const USAGE_THRESHOLD = 80; // 5h used_percent 超过此值则降级
const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

// 内存缓存
const _cache = new Map();

/**
 * 读取 Codex 账号的 auth.json
 * @param {string} accountId - team1..team5
 * @returns {{ accessToken: string, accountId: string } | null}
 */
function getCodexAuth(accountId) {
  try {
    const authPath = path.join(os.homedir(), `.codex-${accountId}`, 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const accessToken = auth.tokens?.access_token;
    const chatgptAccountId = auth.tokens?.account_id;
    if (!accessToken || !chatgptAccountId) {
      console.warn(`[codex-usage] ${accountId}: auth.json 缺少 access_token 或 account_id`);
      return null;
    }
    return { accessToken, accountId: chatgptAccountId };
  } catch (err) {
    console.warn(`[codex-usage] ${accountId}: 读取 auth.json 失败 - ${err.message}`);
    return null;
  }
}

/**
 * 从 wham/usage API 获取单个账号的用量数据
 * @param {string} accountId - team1..team5
 * @returns {Object|null} 用量数据
 */
async function fetchUsageFromAPI(accountId) {
  const auth = getCodexAuth(accountId);
  if (!auth) return null;

  try {
    const res = await fetch(WHAM_USAGE_URL, {
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
        'ChatGPT-Account-Id': auth.accountId,
        'Accept': 'application/json',
        'User-Agent': 'codex-bridge/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[codex-usage] ${accountId}: API 返回 ${res.status}`);
      if (res.status === 401) {
        return { error: 'token_expired', status: 401 };
      }
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.warn(`[codex-usage] ${accountId}: API 调用失败 - ${err.message}`);
    return null;
  }
}

/**
 * 解析 wham/usage 响应，提取关键指标
 * @param {Object} data - API 响应
 * @returns {{ primaryUsedPct: number, primaryResetSeconds: number, secondaryUsedPct: number, codeReviewUsedPct: number }}
 */
function parseUsageData(data) {
  if (!data || data.error) {
    return {
      primaryUsedPct: 100, // 不可用时视为满载
      primaryResetSeconds: 0,
      secondaryUsedPct: 100,
      codeReviewUsedPct: 100,
      tokenExpired: data?.error === 'token_expired',
    };
  }

  const primary = data.rate_limit?.primary_window || {};
  const secondary = data.rate_limit?.secondary_window || {};
  const codeReview = data.code_review_rate_limit?.primary_window || {};

  return {
    primaryUsedPct: primary.used_percent ?? 0,
    primaryResetSeconds: primary.reset_after_seconds ?? 0,
    secondaryUsedPct: secondary.used_percent ?? 0,
    codeReviewUsedPct: codeReview.used_percent ?? 0,
    tokenExpired: false,
  };
}

/**
 * 获取单个账号的用量（带缓存）
 */
async function getAccountUsageSingle(accountId, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = _cache.get(accountId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const raw = await fetchUsageFromAPI(accountId);
  const parsed = parseUsageData(raw);
  parsed.accountId = accountId;

  _cache.set(accountId, { data: parsed, fetchedAt: Date.now() });
  return parsed;
}

/**
 * 获取所有账号的用量
 * @param {boolean} forceRefresh
 * @returns {Object} { team1: {...}, team2: {...}, ... }
 */
async function getAllAccountUsage(forceRefresh = false) {
  const results = {};
  for (const id of ACCOUNTS) {
    results[id] = await getAccountUsageSingle(id, forceRefresh);
  }
  return results;
}

/**
 * 选择最空闲的 Codex 账号
 * @param {Object} options
 * @param {string} [options.taskType] - 'general' | 'code_review'
 * @returns {{ accountId: string, codexHome: string, usedPct: number } | null}
 */
async function selectBestCodexAccount(options = {}) {
  const { taskType = 'general' } = options;

  try {
    const usage = await getAllAccountUsage();

    const candidates = ACCOUNTS.map(id => {
      const u = usage[id];
      const pct = taskType === 'code_review' ? u.codeReviewUsedPct : u.primaryUsedPct;
      return {
        id,
        pct,
        secondaryPct: u.secondaryUsedPct,
        resetSeconds: u.primaryResetSeconds,
        tokenExpired: u.tokenExpired,
      };
    });

    const usageSummary = candidates.map(c =>
      `${c.id}=${c.pct}%${c.tokenExpired ? '/EXPIRED' : ''}`
    ).join(', ');

    // 过滤掉 token 过期和超阈值的
    const available = candidates
      .filter(c => !c.tokenExpired && c.pct < USAGE_THRESHOLD)
      .sort((a, b) => a.pct - b.pct || a.secondaryPct - b.secondaryPct);

    if (available.length > 0) {
      const sel = available[0];
      const codexHome = path.join(os.homedir(), `.codex-${sel.id}`);
      console.log(`[codex-usage] 选 ${sel.id}（${sel.pct}%） | ${usageSummary}`);
      return { accountId: sel.id, codexHome, usedPct: sel.pct };
    }

    // 所有账号超阈值，选最低的继续用（降级）
    const fallback = candidates
      .filter(c => !c.tokenExpired)
      .sort((a, b) => a.pct - b.pct);

    if (fallback.length > 0) {
      const sel = fallback[0];
      const codexHome = path.join(os.homedir(), `.codex-${sel.id}`);
      console.warn(`[codex-usage] ⚠️ 所有账号超 ${USAGE_THRESHOLD}%，降级选 ${sel.id}（${sel.pct}%） | ${usageSummary}`);
      return { accountId: sel.id, codexHome, usedPct: sel.pct };
    }

    console.error(`[codex-usage] ❌ 所有账号不可用（token 均过期） | ${usageSummary}`);
    return null;
  } catch (err) {
    console.error(`[codex-usage] selectBestCodexAccount 异常: ${err.message}`);
    return null;
  }
}

module.exports = {
  ACCOUNTS,
  getCodexAuth,
  getAllAccountUsage,
  selectBestCodexAccount,
  parseUsageData,
};
