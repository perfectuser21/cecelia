/**
 * Brain 运行时模型参数的只读装载器。
 * 启动时读取已生效的数据库参数；不提供配置目录、切换或修改入口。
 */

// ============================================================
// Fallback Profile（DB 不可用时的默认值）
// ============================================================

export const FALLBACK_PROFILE = {
  id: 'profile-anthropic',
  name: 'Anthropic 主力（Claude Code 无头）',
  config: {
    thalamus: {
      provider: 'anthropic-api',
      model: 'claude-haiku-4-5-20251001',
      fallbacks: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }],
    },
    cortex: {
      provider: 'anthropic-api',
      model: 'claude-sonnet-4-6',
    },
    reflection: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    mouth: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    narrative: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    memory: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    },
    fact_extractor: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    },
    rumination: {
      provider: 'anthropic-api',
      model: 'claude-haiku-4-5-20251001',
      fallbacks: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }],
    },
    executor: {
      default_provider: 'anthropic',
      model_map: {
        dev:                { anthropic: 'claude-sonnet-4-6', minimax: null },
        review:             { anthropic: 'claude-sonnet-4-6', minimax: null },
        qa:                 { anthropic: 'claude-sonnet-4-6', minimax: null },
        audit:              { anthropic: 'claude-sonnet-4-6', minimax: null },
        talk:               { anthropic: 'claude-haiku-4-5-20251001', minimax: null },
        research:           { anthropic: 'claude-sonnet-4-6', minimax: null },
        decomp_review:      { anthropic: 'claude-haiku-4-5-20251001', minimax: null },
        dept_heartbeat:     { anthropic: 'claude-haiku-4-5-20251001', minimax: null },
        codex_qa:           { anthropic: null, minimax: null },
        // initiative 相关任务：Sonnet 天花板，瀑布降级到 Haiku
        initiative_plan:    { anthropic: 'claude-sonnet-4-6', minimax: null,
                              cascade: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
        initiative_verify:  { anthropic: 'claude-sonnet-4-6', minimax: null,
                              cascade: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
        architecture_design:{ anthropic: 'claude-sonnet-4-6', minimax: null,
                              cascade: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
        code_review:        { anthropic: 'claude-sonnet-4-6', minimax: null },

      },
      fixed_provider: {
        codex_qa:        'openai',
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
 * 启动时读取，不修改数据库。
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
 * 重置缓存（测试用）
 */
export function _resetProfileCache() {
  _activeProfile = null;
}

// ============================================================
// 瀑布 Cascade 辅助函数
// ============================================================

// 天花板模型 → 自动推导 cascade（无手动配置时使用）
const CEILING_TO_CASCADE = {
  'claude-opus-4-6':           ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'claude-sonnet-4-6':         ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'claude-haiku-4-5-20251001': ['claude-haiku-4-5-20251001'],
  'claude-haiku-4-5':          ['claude-haiku-4-5-20251001'],
};
const DEFAULT_CASCADE = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

/**
 * 获取任务的 cascade 降级列表
 *   1. 优先读取 active profile model_map[taskType].cascade
 *   2. 没有 cascade 时从天花板（anthropic 字段）自动推导
 *   3. 无天花板时返回默认 Sonnet→Haiku
 *
 * @param {Object} task - 任务对象，需包含 task_type
 * @returns {string[]} 完整模型 ID 数组，降级顺序
 */
export function getCascadeForTask(task) {
  const taskType = task?.task_type || 'dev';
  const profile = getActiveProfile();
  const profileMap = profile?.config?.executor?.model_map;
  const mapping = profileMap?.[taskType] || FALLBACK_PROFILE.config.executor.model_map[taskType];

  if (!mapping) return DEFAULT_CASCADE;

  // 优先使用已生效参数中的 cascade
  if (Array.isArray(mapping.cascade) && mapping.cascade.length > 0) {
    return mapping.cascade;
  }

  // 从天花板自动推导
  const ceiling = mapping.anthropic;
  if (!ceiling) return DEFAULT_CASCADE;
  return CEILING_TO_CASCADE[ceiling] || DEFAULT_CASCADE;
}
