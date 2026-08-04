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

// working_memory 持久化 key（07-19 bug fix：draining 此前纯内存，Brain 容器
// 重启——最常见是 Gate3 部署触发——会静默清零，用户明确要求的"停止后台自动
// 派发"因此反复失效。持久化到 working_memory，与 tick_enabled 同款模式，
// Brain 启动时靠 restoreDrainState() 读回内存态。auto-complete / cancelDrain
// 时同步清库，避免"已经不需要 drain 了"却在下次重启时被误恢复。）
const DRAIN_STATE_KEY = 'tick_draining';

// restore 时的过期上限（Issue cc28d1af 根因D，2026-08-04 一夜 4 次实证）：
// 部署链 swap 后的无条件 drain-cancel 会在端口切换窗口 curl 静默失败，残留的
// drain 行被新容器无条件恢复 → 派发瘫痪到有人发现。drain 的合法生命周期 =
// pre-swap 等待（120s 超时）+ swap 数分钟；超过 15 分钟的必是残留，不恢复并清库。
export const DRAIN_RESTORE_MAX_AGE_MS = 15 * 60 * 1000;

async function persistDrainState() {
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [DRAIN_STATE_KEY, { draining: true, drain_started_at: _drainStartedAt }]);
}

async function clearPersistedDrainState() {
  await pool.query(`DELETE FROM working_memory WHERE key = $1`, [DRAIN_STATE_KEY]);
}

/**
 * Restore drain state from DB on Brain startup — call once during init.
 * If a drain was active before the process restarted (e.g. Gate3 deploy),
 * re-activates the in-memory flag so dispatch stays paused.
 */
export async function restoreDrainState() {
  const result = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1`,
    [DRAIN_STATE_KEY]
  );
  const saved = result.rows[0]?.value_json;
  if (!saved?.draining) return;

  // 过期自愈：drain_started_at 缺失/不可解析/超过上限 → 判为部署残留，
  // 不恢复内存态并清掉持久化行（fail-safe：宁可少 drain 也不无限瘫痪派发）
  const startedMs = Date.parse(saved.drain_started_at ?? '');
  const age = Number.isNaN(startedMs) ? Infinity : Date.now() - startedMs;
  if (age > DRAIN_RESTORE_MAX_AGE_MS) {
    log(`[tick] Stale drain state ignored on restore (started_at=${saved.drain_started_at ?? 'null'}, age>${Math.round(DRAIN_RESTORE_MAX_AGE_MS / 60000)}min) — clearing residue`);
    await clearPersistedDrainState();
    return;
  }

  _draining = true;
  _drainStartedAt = saved.drain_started_at;
}

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
  await persistDrainState();

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
    await clearPersistedDrainState();

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
export async function cancelDrain() {
  if (!_draining) {
    return { success: true, was_draining: false };
  }

  log('[tick] Drain mode cancelled, resuming normal dispatch');
  _draining = false;
  _drainStartedAt = null;
  await clearPersistedDrainState();
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
