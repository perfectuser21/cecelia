/**
 * Brain v2 Phase D Part 1.2 — drain 子系统抽出。
 *
 * 原在 tick.js L210-L213（state）+ L3273-L3387（drainTick / getDrainStatus / cancelDrain
 * / _getDrainState / _resetDrainState），瘦身抽出独立模块。
 *
 * 模块状态封装（caller 通过 getter 函数读取，不直接访问私有 let）：
 * - `_draining` / `_drainStartedAt` / `_postDrainCooldown` / `_postDrainCooldownTimer`
 *
 * tick.js 通过 re-export 维持既有 caller 兼容（drain.test.js / executor 不变）。
 */

import pool from './db.js';

// ─── 模块状态（私有）─────────────────────────────────────────────────────
let _draining = false;
let _drainStartedAt = null;
let _postDrainCooldown = false;
let _postDrainCooldownTimer = null;

// ─── Getter API（供 tick.js 等 caller 读取状态）────────────────────────
export function isDraining() {
  return _draining;
}
export function getDrainStartedAt() {
  return _drainStartedAt;
}
export function isPostDrainCooldown() {
  return _postDrainCooldown;
}

// ─── 日志：[drain] 前缀 + Asia/Shanghai 时间戳，与 tick.js tickLog 同风格 ─
function log(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  console.log(`[${ts}]`, ...args);
}

/**
 * Start graceful drain — stop dispatching new tasks, let in_progress finish.
 * When all in_progress tasks complete (checked via getDrainStatus), enter
 * post-drain cooldown (dispatch rate → 1 for 5 minutes).
 */
export async function drainTick() {
  if (_draining) {
    return { success: true, already_draining: true, draining: true, drain_started_at: _drainStartedAt };
  }

  _draining = true;
  _drainStartedAt = new Date().toISOString();
  log(`[tick] Drain mode activated at ${_drainStartedAt}`);

  // Count in_progress tasks for initial status (no auto-complete on activation)
  const inProgressResult = await pool.query(
    "SELECT id, title, started_at FROM tasks WHERE status = 'in_progress' ORDER BY started_at"
  );

  return {
    success: true,
    draining: true,
    drain_started_at: _drainStartedAt,
    in_progress_tasks: inProgressResult.rows.map((t) => ({
      id: t.id,
      title: t.title,
      started_at: t.started_at,
    })),
    remaining: inProgressResult.rows.length,
  };
}

/**
 * Get drain status — shows draining flag + in_progress tasks.
 * Auto-completes drain when no in_progress tasks remain (enter post-drain cooldown).
 */
export async function getDrainStatus() {
  if (!_draining) {
    return { draining: false, in_progress_tasks: [], remaining: 0 };
  }

  const inProgressResult = await pool.query(
    "SELECT id, title, status, started_at FROM tasks WHERE status = 'in_progress' ORDER BY started_at"
  );

  const tasks = inProgressResult.rows;

  // Auto-complete drain: if no in_progress tasks remain, enter post-drain cooldown
  // (NOT disableTick — that would kill the entire tick loop, causing system-wide stop)
  if (tasks.length === 0) {
    log('[tick] Drain complete — no in_progress tasks remain, entering post-drain cooldown (dispatch rate → 1)');
    const drainEnd = new Date().toISOString();
    const startedAt = _drainStartedAt;
    _draining = false;
    _drainStartedAt = null;

    // Set post-drain cooldown: dispatch rate limited to 1 for 5 minutes
    _postDrainCooldown = true;
    if (_postDrainCooldownTimer) clearTimeout(_postDrainCooldownTimer);
    _postDrainCooldownTimer = setTimeout(() => {
      _postDrainCooldown = false;
      _postDrainCooldownTimer = null;
      log('[tick] Post-drain cooldown expired — dispatch rate restored to normal');
    }, 5 * 60 * 1000); // 5 minutes
    if (_postDrainCooldownTimer.unref) _postDrainCooldownTimer.unref();

    return {
      draining: false,
      drain_completed: true,
      post_drain_cooldown: true,
      drain_started_at: startedAt,
      drain_ended_at: drainEnd,
      in_progress_tasks: [],
      remaining: 0,
    };
  }

  return {
    draining: true,
    drain_started_at: _drainStartedAt,
    in_progress_tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      started_at: t.started_at,
    })),
    remaining: tasks.length,
  };
}

/**
 * Cancel drain mode — resume normal dispatching.
 */
export function cancelDrain() {
  if (!_draining) {
    return { success: true, was_draining: false };
  }

  log('[tick] Drain mode cancelled, resuming normal dispatch');
  _draining = false;
  _drainStartedAt = null;
  return { success: true, was_draining: true };
}

// ─── 测试 hook ───────────────────────────────────────────────────────────
export function _getDrainState() {
  return { draining: _draining, drainStartedAt: _drainStartedAt, postDrainCooldown: _postDrainCooldown };
}

export function _resetDrainState() {
  _draining = false;
  _drainStartedAt = null;
  _postDrainCooldown = false;
  if (_postDrainCooldownTimer) {
    clearTimeout(_postDrainCooldownTimer);
    _postDrainCooldownTimer = null;
  }
}
