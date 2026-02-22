/**
 * Model Profile 运行时切换系统
 *
 * 支持在后台一键切换 LLM 模型配置：
 * - Profile A: MiniMax 主力（默认）
 * - Profile B: Anthropic 主力（回退）
 *
 * 内存缓存 + DB 持久化，切换时刷新缓存，无需重启。
 */

/* global console */

// ============================================================
// Fallback Profile（DB 不可用时的默认值）
// ============================================================

export const FALLBACK_PROFILE = {
  id: 'profile-minimax',
  name: 'MiniMax 主力',
  config: {
    thalamus: {
      provider: 'minimax',
      model: 'MiniMax-M2.1',
    },
    cortex: {
      provider: 'anthropic',
      model: 'claude-opus-4-20250514',
    },
    executor: {
      default_provider: 'minimax',
      model_map: {
        dev:           { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        exploratory:   { anthropic: null, minimax: 'MiniMax-M2.1' },
        review:        { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        qa:            { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        audit:         { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        talk:          { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        research:      { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        decomp_review: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        codex_qa:      { anthropic: null, minimax: null },
      },
      fixed_provider: {
        exploratory:   'minimax',
        codex_qa:      'openai',
        decomp_review: 'minimax',
        talk:          'minimax',
        research:      'minimax',
      },
    },
  },
};

// ============================================================
// 内存缓存
// ============================================================

let _activeProfile = null;

/**
 * 从 DB 加载 active profile 到内存缓存
 * 启动时调用一次，切换时自动刷新
 */
export async function loadActiveProfile(pool) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, config, is_active FROM model_profiles WHERE is_active = true LIMIT 1'
    );
    if (rows.length > 0) {
      _activeProfile = rows[0];
      console.log(`[model-profile] Loaded active profile: ${_activeProfile.name} (${_activeProfile.id})`);
      return _activeProfile;
    }
    console.warn('[model-profile] No active profile found, using fallback');
    _activeProfile = FALLBACK_PROFILE;
    return _activeProfile;
  } catch (err) {
    console.error('[model-profile] Failed to load active profile:', err.message);
    _activeProfile = FALLBACK_PROFILE;
    return _activeProfile;
  }
}

/**
 * 获取当前缓存的 active profile（无 DB 查询）
 */
export function getActiveProfile() {
  return _activeProfile || FALLBACK_PROFILE;
}

/**
 * 切换 active profile
 * 事务安全：先取消旧 active，再激活新的
 */
export async function switchProfile(pool, profileId) {
  // 验证 profile 存在
  const { rows: check } = await pool.query(
    'SELECT id, name, config FROM model_profiles WHERE id = $1',
    [profileId]
  );
  if (check.length === 0) {
    throw new Error(`Profile not found: ${profileId}`);
  }

  // 事务切换
  await pool.query('BEGIN');
  try {
    await pool.query('UPDATE model_profiles SET is_active = false, updated_at = NOW() WHERE is_active = true');
    await pool.query('UPDATE model_profiles SET is_active = true, updated_at = NOW() WHERE id = $1', [profileId]);
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }

  // 刷新缓存
  _activeProfile = { ...check[0], is_active: true };
  console.log(`[model-profile] Switched to profile: ${_activeProfile.name} (${_activeProfile.id})`);

  return _activeProfile;
}

/**
 * 列出所有 profile
 */
export async function listProfiles(pool) {
  const { rows } = await pool.query(
    'SELECT id, name, config, is_active, created_at, updated_at FROM model_profiles ORDER BY created_at ASC'
  );
  return rows;
}

/**
 * 重置缓存（测试用）
 */
export function _resetProfileCache() {
  _activeProfile = null;
}
