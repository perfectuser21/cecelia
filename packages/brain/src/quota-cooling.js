/**
 * Quota Cooling — 全局 quota 冷却状态管理
 *
 * 与 billing pause（executor.js）并列的轻量冷却机制：
 * - billing pause: 由 quota_exhausted 回调触发，有明确 resetTime
 * - quota cooling: 更通用的冷却窗口，可由其他信号触发
 *
 * 冷却期内 dispatchNextTask() 会立即返回 {skipped: true, reason: 'quota_cooling'}
 */

/** @type {{ until: string, reason: string, setAt: string } | null} */
let _quotaCoolingState = null;

/**
 * 设置全局 quota 冷却状态
 * @param {string} untilISO - 冷却结束时间（ISO 8601）
 * @param {string} [reason] - 冷却原因
 */
function setQuotaCooling(untilISO, reason = 'quota_cooling') {
  const wasActive = isGlobalQuotaCooling();
  _quotaCoolingState = {
    until: untilISO,
    reason,
    setAt: new Date().toISOString(),
  };
  if (!wasActive) {
    console.log(`[quota-cooling] quota cooling until: ${untilISO} (${reason})`);
  }
}

/**
 * 手动清除 quota 冷却状态
 */
function clearQuotaCooling() {
  const was = _quotaCoolingState;
  _quotaCoolingState = null;
  if (was) {
    console.log(`[quota-cooling] quota cooling cleared (was until: ${was.until})`);
  }
  return { cleared: !!was, previous: was };
}

/**
 * 检查当前是否处于全局 quota 冷却期
 * 若冷却已过期则自动清除
 * @returns {boolean}
 */
function isGlobalQuotaCooling() {
  if (!_quotaCoolingState) return false;

  if (new Date(_quotaCoolingState.until) <= new Date()) {
    console.log(`[quota-cooling] quota cooling auto-cleared (expired)`);
    _quotaCoolingState = null;
    return false;
  }

  return true;
}

/**
 * 获取当前冷却状态（供日志/API 使用）
 * @returns {{ active: boolean, until?: string, reason?: string, setAt?: string }}
 */
function getQuotaCoolingState() {
  if (!isGlobalQuotaCooling()) return { active: false };
  return { active: true, ..._quotaCoolingState };
}

export {
  setQuotaCooling,
  clearQuotaCooling,
  isGlobalQuotaCooling,
  getQuotaCoolingState,
};
