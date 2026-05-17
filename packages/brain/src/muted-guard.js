// SSOT for Brain mute toggle.
// 通过 BRAIN_MUTED 环境变量或 working_memory runtime state 控制所有
// 主动 outbound 飞书消息（经 notifier.js）。env 优先 + runtime fallback。

const MEMORY_KEY = 'brain_muted';
let _cached = null;
let _initialized = false;

export function isMuted() {
  if (process.env.BRAIN_MUTED === 'true') return true;
  if (_initialized && _cached) return _cached.enabled === true;
  return false;
}

export async function initMutedGuard(pool) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value_json;
    _cached = val || { enabled: false, last_toggled_at: null };
  } catch (err) {
    console.warn('[muted-guard] initMutedGuard failed, using default:', err.message);
    _cached = { enabled: false, last_toggled_at: null };
  }
  _initialized = true;
}

export async function setMuted(pool, enabled) {
  const value = { enabled: !!enabled, last_toggled_at: new Date().toISOString() };
  await pool.query(
    `INSERT INTO working_memory(key, value_json, updated_at)
     VALUES($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2::jsonb, updated_at = NOW()`,
    [MEMORY_KEY, JSON.stringify(value)]
  );
  _cached = value;
  console.log(`[Brain] Mute toggled → ${value.enabled} at ${value.last_toggled_at}`);
  return getMutedStatus();
}

export function getMutedStatus() {
  const envOverride = process.env.BRAIN_MUTED === 'true';
  return {
    enabled: isMuted(),
    last_toggled_at: _cached?.last_toggled_at || null,
    env_override: envOverride,
  };
}

export async function reloadMutedCache(pool) {
  try {
    const result = await pool.query(
      'SELECT value_json FROM working_memory WHERE key = $1',
      [MEMORY_KEY]
    );
    const val = result.rows[0]?.value_json;
    if (val) _cached = val;
  } catch (err) {
    console.warn('[muted-guard] reload failed (non-fatal):', err.message);
  }
}

export function _resetCacheForTest() {
  _cached = null;
  _initialized = false;
}
