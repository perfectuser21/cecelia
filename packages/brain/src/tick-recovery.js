/**
 * Brain v2 Phase D2.3 — tick recovery / lifecycle 抽出。
 *
 * 原在 tick.js L348-L543（共 5 个函数 + 3 个相关常量），从主文件瘦身抽出独立模块。
 *
 * 职责：
 *   - initTickLoop()         Brain 启动时初始化 tick loop（含失败时启动后台 recovery timer）
 *   - tryRecoverTickLoop()   recovery timer 周期回调：尝试再次起 tick loop
 *   - enableTick()           DB 写 tick_enabled=true + startTickLoop()
 *   - disableTick(source)    DB 写 tick_enabled=false + stopTickLoop()
 *   - _recordRecoveryAttempt 写入 working_memory.recovery_attempts（尽力写）
 *
 * tick.js 通过 re-export 维持既有 caller 兼容（drain.js / startup-recovery.js /
 * tick-watchdog.js / routes/tick.js / workflows/index.js 都从 ./tick.js import）。
 *
 * 依赖来源：
 *   - getTickStatus / startTickLoop / stopTickLoop 通过 ./tick.js 兼容路径取（D2.2 / D2.4
 *     抽分后 tick.js 仍 re-export 这些符号，本模块不依赖抽分顺序）。
 *   - tickState 直取 ./tick-state.js（loopTimer / recoveryTimer 状态）。
 *   - startTickWatchdog / initAlertness / pool 直取各自模块。
 */

import pool from './db.js';
import { tickState } from './tick-state.js';
import { initAlertness } from './alertness/index.js';
import { startTickWatchdog } from './tick-watchdog.js';
// D1.7b 教训：循环 import 在 vite 下触发 TDZ 假阴性。startTickLoop/stopTickLoop 走 tick-loop.js
// 直接路径（D2.2 已 merge）；getTickStatus 仍在 tick.js 内为 hoisted function declaration 循环安全
import { getTickStatus } from './tick.js';
import { startTickLoop, stopTickLoop } from './tick-loop.js';

const TICK_ENABLED_KEY = 'tick_enabled';

// Tick 自动恢复：Brain 重启时若 tick 已 disabled 超过此时长，自动 enable
const TICK_AUTO_RECOVER_MINUTES = parseInt(process.env.TICK_AUTO_RECOVER_MINUTES || '60', 10);

// 后台恢复配置（initTickLoop 所有重试耗尽后使用）
const INIT_RECOVERY_INTERVAL_MS = parseInt(
  process.env.CECELIA_INIT_RECOVERY_INTERVAL_MS || String(5 * 60 * 1000),
  10
);

// 本模块本地 tickLog（与 tick.js 同风格）
function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  console.log(`[${ts}]`, ...args);
}

/**
 * 记录恢复尝试到 working_memory recovery_attempts（尽力写入，失败不影响主流程）
 * @param {boolean} success - 本次恢复是否成功
 * @param {string} [errMessage] - 失败时的错误信息
 */
async function _recordRecoveryAttempt(success, errMessage) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      ['recovery_attempts']
    );
    const existing = result.rows[0]?.value_json || { attempts: [], total_attempts: 0, last_success_at: null };
    const attempts = Array.isArray(existing.attempts) ? existing.attempts : [];
    attempts.push({
      ts: new Date().toISOString(),
      success,
      error: success ? undefined : errMessage
    });
    const updated = {
      attempts: attempts.slice(-50), // 只保留最近50条
      total_attempts: (existing.total_attempts || 0) + 1,
      last_success_at: success ? new Date().toISOString() : existing.last_success_at,
      last_attempt_at: new Date().toISOString()
    };
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['recovery_attempts', updated]);
  } catch {
    // 尽力写入，失败不阻断恢复流程
  }
}

/**
 * 尝试一次恢复启动 tick loop（被后台 timer 调用）
 * 成功时清除 recovery timer；失败时记录并等待下次 timer 触发
 */
async function tryRecoverTickLoop() {
  // 如果 tick loop 已经在运行，停止恢复
  if (tickState.loopTimer) {
    tickLog('[tick-loop] Recovery: tick loop already running, clearing recovery timer');
    if (tickState.recoveryTimer) {
      clearInterval(tickState.recoveryTimer);
      tickState.recoveryTimer = null;
    }
    return;
  }

  // staging 隔离硬关：hard-off 时 recovery 也绝不拉起 loop（否则硬关只关一半）
  if (process.env.CECELIA_TICK_HARD_OFF === '1') {
    tickLog('[tick-loop] Recovery skipped: CECELIA_TICK_HARD_OFF=1（env 硬关，staging 隔离）');
    if (tickState.recoveryTimer) {
      clearInterval(tickState.recoveryTimer);
      tickState.recoveryTimer = null;
    }
    return;
  }

  // Preview Brain 隔离：BRAIN_PREVIEW=1 时绝不拉起 tick loop（防双派发）
  if (process.env.BRAIN_PREVIEW === '1' || process.env.BRAIN_PREVIEW === 'true') {
    tickLog('[tick-loop] Recovery skipped: BRAIN_PREVIEW=1（Preview 模式）');
    if (tickState.recoveryTimer) {
      clearInterval(tickState.recoveryTimer);
      tickState.recoveryTimer = null;
    }
    return;
  }

  tickLog('[tick-loop] Recovery: attempting to start tick loop...');

  try {
    const { ensureEventsTable } = await import('./event-bus.js');
    await ensureEventsTable();

    // Production compose defaults CECELIA_TICK_ENABLED=true. It may auto-enable a
    // transient disable, but must not override the persisted manual operator intent.
    const envEnabled = process.env.CECELIA_TICK_ENABLED;
    const status = await getTickStatus();
    if (!status.enabled) {
      const tickMem = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [TICK_ENABLED_KEY]
      );
      const disableSource = tickMem.rows[0]?.value_json?.source || 'unknown';
      if (disableSource === 'manual') {
        tickLog('[tick-loop] Recovery skipped: tick was disabled manually');
        if (tickState.recoveryTimer) {
          clearInterval(tickState.recoveryTimer);
          tickState.recoveryTimer = null;
        }
        await _recordRecoveryAttempt(false, 'tick_disabled_manually');
        return;
      }
    }

    if (envEnabled === 'true') {
      await enableTick();
    } else {
      if (status.enabled) {
        startTickLoop();
      } else {
        tickLog('[tick-loop] Recovery: tick disabled in DB, skipping');
        await _recordRecoveryAttempt(false, 'tick_disabled_in_db');
        return;
      }
    }

    // 成功：清除恢复 timer 并记录
    tickLog('[tick-loop] Recovery: tick loop started successfully, clearing recovery timer');
    if (tickState.recoveryTimer) {
      clearInterval(tickState.recoveryTimer);
      tickState.recoveryTimer = null;
    }
    await _recordRecoveryAttempt(true);
  } catch (err) {
    console.error(`[tick-loop] Recovery attempt failed: ${err.message}`);
    await _recordRecoveryAttempt(false, err.message);
  }
}

/**
 * Initialize tick loop on server startup
 * Checks DB state and starts loop if tick is enabled.
 * If initialization fails, starts a background recovery timer that retries
 * every INIT_RECOVERY_INTERVAL_MS until tick loop is successfully started.
 */
async function initTickLoop() {
  // Preview Brain 隔离：BRAIN_PREVIEW=1 时克隆 DB tick_enabled=true，若不拦截会造成并发双派发。
  // 必须在 alertness / watchdog / startTickLoop 之前早返。
  if (process.env.BRAIN_PREVIEW === '1' || process.env.BRAIN_PREVIEW === 'true') {
    tickLog('[tick-loop] BRAIN_PREVIEW=1 — Preview 模式，跳过 tick loop 启动');
    return { success: true, enabled: false, loop_running: false, preview: true };
  }
  // BRAIN_DEPLOY_CANARY=1：蓝绿部署的 green canary 只验证镜像健康，绝不跑 tick——
  // 否则 green 与 blue 连同一 DB 会 double-dispatch 抢任务（issue f38f989f）。
  // 必须在 auto-enable / alertness / watchdog 之前早返。
  if (process.env.BRAIN_DEPLOY_CANARY === '1') {
    tickLog('[tick-loop] BRAIN_DEPLOY_CANARY=1 — canary 模式，跳过 tick loop 启动');
    return { success: true, enabled: false, loop_running: false, canary: true };
  }
  // staging 隔离硬关（2026-07-06）：CECELIA_TICK_HARD_OFF=1 = 绝不启动 loop/watchdog/auto-recover，
  // 无论 DB 怎么说。真实事故：staging 容器 tick 越权跑，任务调度打到生产 bridge(3457)。
  // （CECELIA_TICK_ENABLED=false 保持原语义"不自动开启"，CI real-env 依赖 API 动态 enableTick。）
  if (process.env.CECELIA_TICK_HARD_OFF === '1') {
    tickLog('[tick-loop] CECELIA_TICK_HARD_OFF=1 — env 硬关（staging 隔离），跳过 tick loop/watchdog 启动');
    return { success: true, enabled: false, loop_running: false, env_hard_off: true };
  }
  try {
    // Initialize alertness system
    try {
      await initAlertness();
      tickLog(`[tick-loop] Alertness system initialized`);
    } catch (alertErr) {
      console.error('[tick-loop] Alertness init failed:', alertErr.message);
    }

    // Ensure EventBus table exists
    const { ensureEventsTable } = await import('./event-bus.js');
    await ensureEventsTable();

    // Restore drain state persisted before a possible restart (07-19 bug fix —
    // draining was purely in-memory, Gate3 deploy restarts silently cleared it).
    try {
      const { restoreDrainState } = await import('./drain.js');
      await restoreDrainState();
    } catch (drainErr) {
      console.error('[tick-loop] restoreDrainState failed (non-fatal):', drainErr.message);
    }

    const envEnabled = process.env.CECELIA_TICK_ENABLED;
    const status = await getTickStatus();
    if (status.enabled) {
      tickLog('[tick-loop] Tick is enabled in DB, starting loop on startup');
      startTickLoop();
    } else {
      // Check if tick has been disabled for too long — auto-recover
      const tickMem = await pool.query(
        `SELECT value_json FROM working_memory WHERE key = $1`,
        [TICK_ENABLED_KEY]
      );
      const tickData = tickMem.rows[0]?.value_json || {};
      const disabledAt = tickData.disabled_at ? new Date(tickData.disabled_at) : null;
      const minutesDisabled = disabledAt
        ? (Date.now() - disabledAt.getTime()) / (1000 * 60)
        : Infinity; // no timestamp = unknown, treat as expired
      const disableSource = tickData.source || 'unknown';

      if (disableSource === 'manual') {
        tickLog('[tick-loop] Tick was disabled manually, preserving disabled state on startup');
      } else if (envEnabled === 'true') {
        tickLog('[tick-loop] CECELIA_TICK_ENABLED=true, auto-enabling non-manual tick');
        await enableTick();
      } else if (minutesDisabled >= TICK_AUTO_RECOVER_MINUTES) {
        console.warn(`[tick-loop] Tick disabled for ${Math.round(minutesDisabled)}min (>= ${TICK_AUTO_RECOVER_MINUTES}min threshold), auto-recovering`);
        await enableTick();
        // Write P1 alert event
        try {
          await pool.query(
            `INSERT INTO cecelia_events (event_type, source, payload)
             VALUES ('tick_auto_recover', 'tick', $1)`,
            [JSON.stringify({
              reason: 'tick_was_disabled_too_long',
              disabled_at: disabledAt?.toISOString() || null,
              minutes_disabled: Math.round(minutesDisabled),
              auto_recovered: true,
            })]
          );
        } catch { /* event logging is best-effort */ }
        tickLog('[tick-loop] tick_auto_recover: tick re-enabled after extended disable period');
      } else {
        tickLog(`[tick-loop] Tick is disabled in DB (${Math.round(minutesDisabled)}min, threshold ${TICK_AUTO_RECOVER_MINUTES}min), not starting loop`);
      }
    }

    // Start tick watchdog — independent timer that checks every 5 minutes
    // If tick is disabled by non-manual source (drain/alertness), auto-recover
    startTickWatchdog();
  } catch (err) {
    console.error('[tick-loop] Failed to init tick loop:', err.message);

    // 启动后台恢复 timer（每 INIT_RECOVERY_INTERVAL_MS 重试一次）
    if (!tickState.recoveryTimer) {
      tickLog(`[tick-loop] Starting background recovery timer (interval: ${INIT_RECOVERY_INTERVAL_MS}ms)`);
      tickState.recoveryTimer = setInterval(tryRecoverTickLoop, INIT_RECOVERY_INTERVAL_MS);
      // 允许进程在没有其他活跃引用时正常退出
      if (tickState.recoveryTimer.unref) {
        tickState.recoveryTimer.unref();
      }
    }
  }
}

/**
 * Enable automatic tick
 */
async function enableTick() {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_ENABLED_KEY, { enabled: true }]);

  startTickLoop();

  return { success: true, enabled: true, loop_running: true };
}

/**
 * Disable automatic tick
 * @param {string} source - 'manual' | 'drain' | 'alertness' — watchdog 只恢复非 manual 的
 */
async function disableTick(source = 'manual') {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_ENABLED_KEY, { enabled: false, disabled_at: new Date().toISOString(), source }]);

  stopTickLoop();

  return { success: true, enabled: false, loop_running: false, source };
}

export {
  _recordRecoveryAttempt,
  tryRecoverTickLoop,
  initTickLoop,
  enableTick,
  disableTick,
};
