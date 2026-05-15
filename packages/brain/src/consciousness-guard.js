// SSOT for Brain consciousness toggle.
// 通过 CONSCIOUSNESS_ENABLED 环境变量控制所有会持续消耗 LLM token 的意识模块。
// 默认启用，设为 'false' 时关闭。BRAIN_QUIET_MODE=true 作为 deprecated 别名继续识别。

export const GUARDED_MODULES = [
  'thalamus', 'rumination', 'rumination-scheduler', 'narrative',
  'diary-scheduler', 'conversation-digest', 'conversation-consolidator',
  'capture-digestion', 'self-report', 'notebook-feeder',
  'proactive-mouth', 'evolution-scanner', 'evolution-synthesizer',
  'desire-system', 'suggestion-cycle', 'self-drive',
  'dept-heartbeat', 'pending-followups',
];

let _deprecationWarned = false;

export function isConsciousnessEnabled() {
  // env override 永远优先（紧急逃生口）；新 env 比 deprecated 旧 env 优先
  if (process.env.CONSCIOUSNESS_ENABLED === 'false') return false;
  if (process.env.CONSCIOUSNESS_ENABLED === 'true') return true;
  if (process.env.BRAIN_QUIET_MODE === 'true') {
    if (!_deprecationWarned) {
      console.warn('[consciousness-guard] BRAIN_QUIET_MODE is deprecated, use CONSCIOUSNESS_ENABLED=false');
      _deprecationWarned = true;
    }
    return false;
  }
  // memory 权威
  if (_initialized && _cached) return _cached.enabled !== false;
  // 默认
  return true;
}

export function logStartupDeclaration() {
  if (!isConsciousnessEnabled()) {
    console.log('[Brain] CONSCIOUSNESS_ENABLED=false — 意识层全部跳过（保留任务派发/调度/监控）');
    console.log('[Brain] 守护模块: ' + GUARDED_MODULES.join('/'));
  }
}

// Test-only: reset internal deprecation flag (for vitest beforeEach)
export function _resetDeprecationWarn() { _deprecationWarned = false; }

// ========== Phase 2: Runtime toggle via working_memory ==========

const MEMORY_KEY = 'consciousness_enabled';
let _cached = null; // { enabled: bool, last_toggled_at: ISO | null }
let _initialized = false;

/**
 * 从 working_memory 加载开关状态到模块缓存。
 * 必须在 server.js 的 app.listen 之前 await 完成。
 */
export async function initConsciousnessGuard(pool) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value_json;
    _cached = val || { enabled: true, last_toggled_at: null };
  } catch (err) {
    console.warn('[consciousness-guard] initConsciousnessGuard failed, using default:', err.message);
    _cached = { enabled: true, last_toggled_at: null };
  }
  _initialized = true;
}

export async function setConsciousnessEnabled(pool, enabled) {
  const value = { enabled: !!enabled, last_toggled_at: new Date().toISOString() };
  await pool.query(
    `INSERT INTO working_memory(key, value_json, updated_at)
     VALUES($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()`,
    [MEMORY_KEY, JSON.stringify(value)]
  );
  _cached = value;
  console.log(`[Brain] Consciousness toggled → ${value.enabled} at ${value.last_toggled_at}`);
  return getConsciousnessStatus();
}

export function getConsciousnessStatus() {
  const envOverride =
    process.env.CONSCIOUSNESS_ENABLED === 'false' ||
    process.env.BRAIN_QUIET_MODE === 'true';
  return {
    enabled: isConsciousnessEnabled(),
    last_toggled_at: _cached?.last_toggled_at || null,
    env_override: envOverride,
  };
}

export async function reloadConsciousnessCache(pool) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value_json;
    if (val) _cached = val;
  } catch (err) {
    console.warn('[consciousness-guard] reload failed (non-fatal):', err.message);
  }
}

export function _resetCacheForTest() {
  _cached = null;
  _initialized = false;
}

// ========== Phase 3: Heartbeat monitoring ==========

const HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
let _lastHeartbeatCheck = 0;
const HEARTBEAT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 每小时最多检查一次

/**
 * 检测反刍系统心跳，若 24h 内无心跳则告警并尝试自愈。
 *
 * 调用方：tick-runner.js（每小时触发一次，fire-and-forget）
 *
 * @param {import('pg').Pool} pool - PG 连接池
 * @param {{ raise: Function }} alerting - alerting 模块（注入以避免循环依赖）
 * @param {{ runRumination?: Function }} [rumination] - 可选注入，用于 self-heal
 * @returns {Promise<{checked: boolean, heartbeats_24h: number, alerted: boolean, healed: boolean}>}
 */
export async function checkConsciousnessHeartbeat(pool, alerting, rumination = null) {
  const now = Date.now();

  // 节流：每小时最多检查一次，避免 tick 每 5s 都查 DB
  if (now - _lastHeartbeatCheck < HEARTBEAT_CHECK_INTERVAL_MS) {
    return { checked: false, heartbeats_24h: -1, alerted: false, healed: false };
  }
  _lastHeartbeatCheck = now;

  // consciousness 关闭时无需检测（意识层本就不跑）
  if (!isConsciousnessEnabled()) {
    return { checked: true, heartbeats_24h: -1, alerted: false, healed: false };
  }

  let heartbeats24h = 0;
  try {
    const { rows } = await pool.query(
      `SELECT count(*) AS cnt FROM cecelia_events
       WHERE event_type = 'rumination_run'
         AND created_at > NOW() - INTERVAL '24 hours'`
    );
    heartbeats24h = parseInt(rows[0]?.cnt || 0);
  } catch (err) {
    console.warn('[consciousness-guard] heartbeat query failed (non-blocking):', err.message);
    return { checked: false, heartbeats_24h: -1, alerted: false, healed: false };
  }

  if (heartbeats24h > 0) {
    return { checked: true, heartbeats_24h: heartbeats24h, alerted: false, healed: false };
  }

  // heartbeats_24h=0 → 反刍系统无声停跳超过 24h → 告警
  console.warn('[consciousness-guard] heartbeat check: 0 rumination_run events in 24h — alerting');
  let alerted = false;
  try {
    await alerting.raise(
      'P2',
      'consciousness_heartbeat_dead',
      '[consciousness-guard] 反刍心跳停跳超 24h（heartbeats_24h=0）。rumination 系统可能已无声挂起，正在尝试自愈。'
    );
    alerted = true;
  } catch (alertErr) {
    console.warn('[consciousness-guard] heartbeat alert failed (non-blocking):', alertErr.message);
  }

  // 自愈：env_override / BRAIN_MINIMAL_MODE 为人工开关，不自动覆盖
  const envOverride = getConsciousnessStatus().env_override;
  const minimalMode = process.env.BRAIN_MINIMAL_MODE === 'true';
  let healed = false;

  if (!envOverride && !minimalMode && rumination) {
    try {
      const healResult = await rumination.runRumination(pool);
      const digested = healResult?.digested ?? 0;
      console.log(`[consciousness-guard] heartbeat self-heal: runRumination digested=${digested}`);
      healed = true;
    } catch (healErr) {
      console.warn('[consciousness-guard] heartbeat self-heal failed (non-blocking):', healErr.message);
    }
  }

  return { checked: true, heartbeats_24h: 0, alerted, healed };
}

// Test-only: reset heartbeat check timestamp
export function _resetHeartbeatCheckForTest() {
  _lastHeartbeatCheck = 0;
}
