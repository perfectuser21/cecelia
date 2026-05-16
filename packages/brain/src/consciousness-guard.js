// SSOT for Brain consciousness toggle.
// 通过 CONSCIOUSNESS_ENABLED 环境变量控制所有会持续消耗 LLM token 的意识模块。
// 默认启用，设为 'false' 时关闭。BRAIN_QUIET_MODE=true 作为 deprecated 别名继续识别。

export const GUARDED_MODULES = [
  'thalamus', 'rumination', 'rumination-scheduler', 'narrative',
  'diary-scheduler', 'conversation-digest', 'conversation-consolidator',
  'capture-digestion', 'self-report', 'notebook-feeder',
  'proactive-mouth', 'evolution-scanner', 'evolution-synthesizer',
  'desire-system', 'suggestion-cycle',
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
