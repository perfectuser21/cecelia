/**
 * Brain v2 Phase D Part 1.3 — tick watchdog 抽出。
 *
 * 原在 tick.js L223-L224（state + interval const）+ L605-L666（startTickWatchdog
 * / stopTickWatchdog），瘦身抽出独立模块。
 *
 * Watchdog 职责：独立 timer 周期检测 tick 健康。若 tick 被非 manual 源（drain/alertness）
 * 关闭则自动恢复。manual 关闭被尊重不恢复。
 *
 * 模块状态封装（caller 通过 isTickWatchdogActive() getter 读取）：
 * - `_tickWatchdogTimer` 私有
 *
 * tick.js 通过 re-export 维持既有 caller 兼容。
 */

import pool from './db.js';

export const TICK_WATCHDOG_INTERVAL_MS = parseInt(
  process.env.CECELIA_TICK_WATCHDOG_INTERVAL_MS || String(5 * 60 * 1000),
  10
); // 5 minutes

const TICK_ENABLED_KEY = 'tick_enabled';

let _tickWatchdogTimer = null;

/**
 * Getter API — 供 tick.js 等 caller 读取 watchdog 是否在跑。
 */
export function isTickWatchdogActive() {
  return _tickWatchdogTimer !== null;
}

// 日志：[tick-watchdog] 前缀 + Asia/Shanghai 时间戳，与 tick.js tickLog 同风格。
function log(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  console.log(`[${ts}]`, ...args);
}

/**
 * Start tick watchdog — independent timer that periodically checks tick health.
 * If tick is disabled by a non-manual source (drain/alertness), auto-recovers.
 * Only manual disables are respected; all other disables are transient.
 */
export function startTickWatchdog() {
  if (_tickWatchdogTimer) {
    log('[tick-watchdog] Already running, skipping start');
    return;
  }

  _tickWatchdogTimer = setInterval(async () => {
    try {
      const tickMem = await pool.query(
        `SELECT value_json FROM working_memory WHERE key = $1`,
        [TICK_ENABLED_KEY]
      );
      const tickData = tickMem.rows[0]?.value_json || {};

      if (tickData.enabled === false) {
        const source = tickData.source || 'unknown';

        // Only auto-recover non-manual disables
        if (source === 'manual') {
          // Manual disable — respect it, do not auto-recover
          return;
        }

        console.warn(`[tick-watchdog] Tick is disabled (source: ${source}), auto-recovering...`);

        // 动态 import enableTick 避免与 tick.js 的循环 import 在加载阶段触发
        const { enableTick } = await import('./tick.js');
        await enableTick();

        // Log recovery event
        try {
          await pool.query(
            `INSERT INTO cecelia_events (event_type, source, payload)
             VALUES ('tick_watchdog_recover', 'tick_watchdog', $1)`,
            [JSON.stringify({
              reason: 'tick_disabled_by_non_manual_source',
              original_source: source,
              disabled_at: tickData.disabled_at || null,
              recovered_at: new Date().toISOString(),
            })]
          );
        } catch { /* event logging is best-effort */ }
      }
    } catch (err) {
      console.error('[tick-watchdog] Error checking tick status:', err.message);
    }
  }, TICK_WATCHDOG_INTERVAL_MS);

  if (_tickWatchdogTimer.unref) {
    _tickWatchdogTimer.unref();
  }

  log(`[tick-watchdog] Started (interval: ${TICK_WATCHDOG_INTERVAL_MS}ms)`);
}

/**
 * Stop tick watchdog timer.
 */
export function stopTickWatchdog() {
  if (_tickWatchdogTimer) {
    clearInterval(_tickWatchdogTimer);
    _tickWatchdogTimer = null;
    log('[tick-watchdog] Stopped');
  }
}
