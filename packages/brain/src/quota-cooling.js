/**
 * Quota Cooling — 全局 quota 冷却状态管理
 *
 * 与 billing pause（executor.js）并列的轻量冷却机制：
 * - billing pause: 由 quota_exhausted 回调触发，有明确 resetTime
 * - quota cooling: 更通用的冷却窗口，可由其他信号触发
 *
 * 冷却期内 dispatchNextTask() 会立即返回 {skipped: true, reason: 'quota_cooling'}
 *
 * 持久化层（migration 152）：
 * - brain_state 表存储 global_quota_cooldown_until TIMESTAMPTZ
 * - setGlobalQuotaCooldown(pool, durationMs) 同步写内存 + 异步写 DB
 * - loadQuotaCoolingFromDb(pool) 在 Brain 启动时从 DB 恢复状态
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

// ============================================================
// DB 持久化层（migration 152: brain_state singleton）
// ============================================================

/**
 * 设置全局 quota 冷却（持久化到 DB + 更新内存）
 *
 * @param {import('pg').Pool} pool - PostgreSQL pool
 * @param {number} durationMs - 冷却时长（毫秒）
 * @param {string} [reason] - 冷却原因
 * @returns {Promise<void>}
 */
async function setGlobalQuotaCooldown(pool, durationMs, reason = 'quota_cooling') {
  const until = new Date(Date.now() + durationMs).toISOString();

  // 1. 立即更新内存状态（保持 isGlobalQuotaCooling() 同步可用）
  setQuotaCooling(until, reason);

  // 2. 异步持久化到 DB
  try {
    await pool.query(
      `UPDATE brain_state
          SET global_quota_cooldown_until = $1,
              updated_at = NOW()
        WHERE id = 'singleton'`,
      [until],
    );
  } catch (err) {
    console.error(`[quota-cooling] setGlobalQuotaCooldown DB write failed: ${err.message}`);
    throw err;
  }
}

/**
 * 从 DB 加载 quota 冷却状态（Brain 启动时调用，恢复重启前的冷却窗口）
 *
 * @param {import('pg').Pool} pool - PostgreSQL pool
 * @returns {Promise<void>}
 */
async function loadQuotaCoolingFromDb(pool) {
  try {
    const result = await pool.query(
      `SELECT global_quota_cooldown_until
         FROM brain_state
        WHERE id = 'singleton'`,
    );
    const row = result.rows[0];
    if (!row) return;

    const until = row.global_quota_cooldown_until;
    if (!until) return;

    const untilDate = new Date(until);
    if (untilDate <= new Date()) {
      // 冷却已过期，无需恢复
      console.log('[quota-cooling] loadQuotaCoolingFromDb: cooldown expired, skipping restore');
      return;
    }

    // 恢复内存状态
    setQuotaCooling(untilDate.toISOString(), 'quota_cooling_restored');
    console.log(`[quota-cooling] loadQuotaCoolingFromDb: restored cooldown until ${untilDate.toISOString()}`);
  } catch (err) {
    // 非致命：DB 读取失败不阻断启动
    console.warn(`[quota-cooling] loadQuotaCoolingFromDb failed (non-fatal): ${err.message}`);
  }
}

export {
  setQuotaCooling,
  clearQuotaCooling,
  isGlobalQuotaCooling,
  getQuotaCoolingState,
  setGlobalQuotaCooldown,
  loadQuotaCoolingFromDb,
};
