import { homedir } from 'os';
import { join } from 'path';
import { getAccountUsage } from './account-usage.js';

const CACHE_TTL_MS = 60 * 1000;
const USABLE_THRESHOLD = 90;

// team1~5 auth.json 全在本机（07-21 拍板 a1c86e2e：t1=Pro 大池，跨机只发 token 不跨机执行）
//
// 导出为 Codex 账号的**单一来源**：llm-caller.js 的调用池由它派生。
// 曾经两处各写一份，llm-caller 只有 team1/team2 而这里有 5 个，导致 T3/T4/T5
// 三个满额度账号从未被调用，容量统计却按 5 个账号规划（2026-09-06 实测）。
// 加账号只改这一处；tests/gp/g5/step1-codex-account-pool-consistency 机械校验一致性。
export const CODEX_ACCOUNTS = [
  { vendor: 'codex', name: 'team1', home: join(homedir(), '.codex-team1') },
  { vendor: 'codex', name: 'team2', home: join(homedir(), '.codex-team2') },
  { vendor: 'codex', name: 'team3', home: join(homedir(), '.codex-team3') },
  { vendor: 'codex', name: 'team4', home: join(homedir(), '.codex-team4') },
  { vendor: 'codex', name: 'team5', home: join(homedir(), '.codex-team5') },
];

const GROK_ACCOUNTS = [
  { vendor: 'grok', name: 'grok', home: join(homedir(), '.grok') },
];

let _cachedSnapshot = null;
let _cachedAt = 0;

function buildVendorLedger(vendor, accounts, error = null) {
  const available = accounts.filter((account) => account.available);
  return {
    vendor,
    available_count: available.length,
    total_count: accounts.length,
    poller: error ? 'error' : 'ok',
    error,
    accounts,
  };
}

function buildCapacityDigest(snapshot) {
  const digest = { sampled_at: snapshot.sampled_at, sentinel: snapshot.sentinel, vendors: {} };
  for (const [vendor, ledger] of Object.entries(snapshot.vendors)) {
    digest.vendors[vendor] = {
      available_count: ledger.available_count,
      total_count: ledger.total_count,
      poller: ledger.poller,
    };
  }
  return digest;
}

/**
 * 一批账号 + 一份配额账本裁决 → vendor ledger。
 *
 * ── 为什么不再读本机凭据文件（2026-09-22 根因）─────────────────────────────
 * 原来 codex 读 `~/.codex-teamN/auth.json` 自己打 usage API、grok 用
 * `existsSync(~/.grok/auth.json)` 判在不在。而 Brain 跑在 us-vps 容器里，
 * `/root/.codex*` `/root/.grok*` **根本不存在**（ssh 实证）→ 两家 available_count
 * 恒 0 → chooseGuidedExecutor 在 vendor 层就把 codex/grok 整个排除。
 * 实证后果：7 天 61 次派单 61 次全落 claude，5 个 codex 号和 grok 一次没被选过；
 * 刀1 接进 capability-gate 的配额账本对这 6 个号根本没机会生效 ——
 * 闸门装在了一扇已经焊死的门后面。
 *
 * 现在改读 ops_model_accounts（生产唯一真配额来源），判据直接复用
 * account-quota-ledger 的 judgeAccount，**不另发明第二套** —— 同一个号在
 * vendor 层和选号层必须得出同一个结论，两套判据迟早对不上（#5472 的教训）。
 *
 * ⚠️ `unknown` 记作**可用**，这不是笔误：三态的全部意义就是别把「读不到数据」
 *    压成「没额度」（0819 三起事故的形状）。真正的否定事实只有 unusable。
 *    账本整体不可用时的 fail-open/fail-closed 由 loader 负责（15 分钟后转
 *    fail-closed，届时每个号都会拿到 unusable），这里忠实反映即可。
 */
function buildLedgerFromQuota(vendor, accounts, quotaSnapshot) {
  const rows = accounts.map((account) => {
    const v = quotaSnapshot?.verdictFor?.(account.name)
      ?? { verdict: 'unknown', reason: 'no_quota_snapshot', pct: null };
    return {
      ...account,
      available: v.verdict !== 'unusable',
      used_percent: v.pct ?? null,
      source: `ledger:${v.verdict}:${v.reason}`,
    };
  });
  return buildVendorLedger(vendor, rows, quotaSnapshot?.degradedReason ?? null);
}

/** 导出供单测直接喂裁决，不必起库。 */
export function buildCodexLedgerFromQuota(quotaSnapshot) {
  return buildLedgerFromQuota('codex', CODEX_ACCOUNTS, quotaSnapshot);
}

export function buildGrokLedgerFromQuota(quotaSnapshot) {
  return buildLedgerFromQuota('grok', GROK_ACCOUNTS, quotaSnapshot);
}

async function pollClaudeLedger() {
  const usage = await getAccountUsage();
  const accounts = Object.values(usage).map((row) => ({
    vendor: 'claude',
    name: row.account_id,
    available: !(row.spendingCapped || row.authFailed || row.extraUsed || (row.five_hour_pct ?? 100) >= USABLE_THRESHOLD),
    used_percent: row.five_hour_pct ?? 100,
    seven_day_pct: row.seven_day_pct ?? null,
    source: row.cached ? 'usage_cache' : 'usage_api',
  }));
  return buildVendorLedger('claude', accounts);
}

// 账本装载器懒建：模块顶层不碰 pool，单测才能不起库直接 import 纯函数。
let _quotaLoader = null;
async function loadQuotaSnapshot() {
  try {
    if (!_quotaLoader) {
      const [{ createQuotaLedgerLoader }, { default: pool }] = await Promise.all([
        import('./orchestrator/preflight/account-quota-ledger.js'),
        import('./db.js'),
      ]);
      _quotaLoader = createQuotaLedgerLoader({ pool });
    }
    return await _quotaLoader();
  } catch (error) {
    // 装载器自身起不来（db 模块导入失败等）。**绝不能让 vendor 塌成「一个号都没有」**——
    // 那会把「读不到配额」和「这家压根没号」混为一谈，正是本次要修的同一类塌陷
    // （查询层面的失败由 loader 自己管，15 分钟后转 fail-closed，轮不到这里）。
    // 退回 unknown 弃权，但把降级原因留在 poller/error 上，别让它悄悄过去。
    return {
      degraded: true,
      degradedReason: `quota_loader_unavailable:${String(error?.message ?? error).slice(0, 120)}`,
      verdictFor: () => ({ verdict: 'unknown', reason: 'quota_loader_unavailable', pct: null }),
    };
  }
}

async function pollCodexLedger() {
  return buildCodexLedgerFromQuota(await loadQuotaSnapshot());
}

async function pollGrokLedger() {
  return buildGrokLedgerFromQuota(await loadQuotaSnapshot());
}

export function chooseGuidedExecutor(taskType, budgetState, snapshot) {
  if (!snapshot?.vendors) return null;
  const vendors = snapshot?.vendors || {};
  const claudeAvailable = (vendors.claude?.available_count || 0) > 0;
  const codexAvailable = (vendors.codex?.available_count || 0) > 0;
  const grokAvailable = (vendors.grok?.available_count || 0) > 0;
  const prefersCodex = budgetState === 'tight' || budgetState === 'critical';
  const primary = prefersCodex ? 'codex' : 'claude';
  const fallback = prefersCodex ? 'claude' : 'codex';

  if (primary === 'claude' && claudeAvailable) {
    return { executor: 'claude', level: 'L1_primary_claude', reason: 'primary_vendor_available' };
  }
  if (primary === 'codex' && codexAvailable) {
    return { executor: 'codex', level: 'L2_primary_codex', reason: 'primary_vendor_available' };
  }
  if (fallback === 'claude' && claudeAvailable) {
    return { executor: 'claude', level: 'L3_cross_vendor_fallback', reason: 'primary_vendor_unavailable' };
  }
  if (fallback === 'codex' && codexAvailable) {
    return { executor: 'codex', level: 'L3_cross_vendor_fallback', reason: 'primary_vendor_unavailable' };
  }
  if (grokAvailable) {
    return { executor: 'grok', level: 'L4_grok_fallback', reason: 'all_metered_vendors_unavailable' };
  }

  return {
    executor: primary,
    level: 'L4_fail_open',
    reason: 'llm_capacity_exhausted_fail_open',
  };
}

export async function getLlmCapacitySnapshot(opts = {}) {
  const forceRefresh = opts.forceRefresh === true;
  const now = Date.now();
  if (!forceRefresh && _cachedSnapshot && (now - _cachedAt) < CACHE_TTL_MS) {
    return _cachedSnapshot;
  }

  const errors = [];
  const vendors = {};

  try {
    vendors.claude = await pollClaudeLedger();
  } catch (error) {
    errors.push(`claude:${error.message}`);
    vendors.claude = buildVendorLedger('claude', [], error.message);
  }

  try {
    vendors.codex = await pollCodexLedger();
  } catch (error) {
    errors.push(`codex:${error.message}`);
    vendors.codex = buildVendorLedger('codex', [], error.message);
  }

  try {
    vendors.grok = await pollGrokLedger();
  } catch (error) {
    errors.push(`grok:${error.message}`);
    vendors.grok = buildVendorLedger('grok', [], error.message);
  }

  const anyAvailable = Object.values(vendors).some((ledger) => ledger.available_count > 0);
  const sentinel = errors.length > 0 ? 'degraded' : (anyAvailable ? 'ok' : 'exhausted');
  const snapshot = {
    sampled_at: new Date().toISOString(),
    cache_ttl_ms: CACHE_TTL_MS,
    healthy: sentinel === 'ok',
    sentinel,
    errors,
    vendors,
  };

  _cachedSnapshot = snapshot;
  _cachedAt = now;
  return snapshot;
}

export function summarizeLlmCapacity(snapshot) {
  if (!snapshot) return null;
  return buildCapacityDigest(snapshot);
}

export function clearLlmCapacityCache() {
  _cachedSnapshot = null;
  _cachedAt = 0;
}
