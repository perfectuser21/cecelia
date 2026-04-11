/**
 * quota-guard.js
 * Quota 感知调度守卫 — 根据账号当前 5h 用量动态限制调度范围
 *
 * 规则（基于"最优账号"即余量最多的账号）：
 *   - 最优账号 five_hour_pct > 98% → allow=false，暂停全部调度
 *   - 最优账号 five_hour_pct > 90% → priorityFilter=['P0','P1']，仅派高优任务
 *   - 否则 → 正常调度，不限制
 *
 * 设计原则：
 *   - 以最优账号（pct 最低）为准，避免因单账号满载就封锁全局
 *   - 1 分钟缓存，避免每个 5s tick 都打 usage API
 *   - 检查失败默认放行，不阻断调度（fail-open）
 */

import { getAccountUsage } from './account-usage.js';

// 阈值（five_hour_pct 已用百分比）
const QUOTA_CRITICAL_PCT = 98; // 已用 > 98%（剩余 < 2%） → 暂停全部调度
const QUOTA_LOW_PCT = 90;      // 已用 > 90%（剩余 < 10%）→ 仅派 P0/P1

const CACHE_TTL_MS = 60 * 1000; // 1 分钟缓存

let _lastCheck = 0;
let _cachedResult = null;

/**
 * @typedef {Object} QuotaGuardResult
 * @property {boolean}        allow          - 是否允许派发（false = 暂停全部）
 * @property {string[]|null}  priorityFilter - null 不限制；数组仅允许这些优先级
 * @property {string}         reason         - 决策原因（日志用）
 * @property {number}         bestPct        - 最优账号已用百分比（0-100）
 */

/**
 * 检查当前 quota 状态，决定调度允许范围
 * 带 1 分钟本地缓存，不阻塞调度热路径
 *
 * @returns {Promise<QuotaGuardResult>}
 */
export async function checkQuotaGuard() {
  const now = Date.now();
  if (_cachedResult && (now - _lastCheck) < CACHE_TTL_MS) {
    return _cachedResult;
  }

  try {
    const usage = await getAccountUsage();
    const pcts = Object.values(usage)
      .map(u => u?.five_hour_pct ?? 0)
      .filter(p => typeof p === 'number' && !isNaN(p));

    if (pcts.length === 0) {
      const result = { allow: true, priorityFilter: null, reason: 'no_usage_data', bestPct: 0 };
      _lastCheck = now;
      _cachedResult = result;
      return result;
    }

    const bestPct = Math.min(...pcts); // 最低已用 = 余量最多

    let result;
    if (bestPct > QUOTA_CRITICAL_PCT) {
      result = { allow: false, priorityFilter: null, reason: 'quota_critical', bestPct };
      console.log(`[quota-guard] ⛔ 所有账号 quota > ${QUOTA_CRITICAL_PCT}%（最优=${bestPct.toFixed(1)}%），暂停全部调度`);
    } else if (bestPct > QUOTA_LOW_PCT) {
      result = { allow: true, priorityFilter: ['P0', 'P1'], reason: 'quota_low', bestPct };
      console.log(`[quota-guard] ⚠️ 所有账号 quota > ${QUOTA_LOW_PCT}%（最优=${bestPct.toFixed(1)}%），仅派 P0/P1`);
    } else {
      result = { allow: true, priorityFilter: null, reason: 'quota_ok', bestPct };
    }

    _lastCheck = now;
    _cachedResult = result;
    return result;
  } catch (err) {
    console.warn(`[quota-guard] 检查失败，默认放行: ${err.message}`);
    // fail-open：检查失败不阻断调度
    _lastCheck = now;
    _cachedResult = { allow: true, priorityFilter: null, reason: 'check_error', bestPct: 0 };
    return _cachedResult;
  }
}

/**
 * 手动清除缓存（测试 / 强制刷新用）
 */
export function clearQuotaGuardCache() {
  _lastCheck = 0;
  _cachedResult = null;
}
