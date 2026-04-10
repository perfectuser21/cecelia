/**
 * Model Profile 运行时切换系统
 *
 * 支持在后台一键切换 LLM 模型配置：
 * - Profile A: MiniMax 主力（默认）
 * - Profile B: Anthropic 主力（回退）
 *
 * 内存缓存 + DB 持久化，切换时刷新缓存，无需重启。
 */

// ============================================================
// Fallback Profile（DB 不可用时的默认值）
// ============================================================

export const FALLBACK_PROFILE = {
  id: 'profile-anthropic',
  name: 'Anthropic 主力（Claude Code 无头）',
  config: {
    // thalamus uses anthropic-api (direct REST) instead of anthropic (bridge/claude -p).
    // Reason: claude -p bridge exits with code 1 in <1s, causing silent fallback to static templates.
    // Direct REST API is stable (same as cortex). Rollback: UPDATE model_profiles
    // SET config=jsonb_set(config,'{thalamus,provider}','"anthropic"') WHERE id='profile-anthropic'
    thalamus: {
      provider: 'anthropic-api',
      model: 'claude-haiku-4-5-20251001',
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
        // harness pipeline：GAN 三件套用 Opus（推理/规格），Generator/Report 用 Sonnet（执行/写代码）
        harness_planner:          { anthropic: 'claude-opus-4-6', minimax: null },
        harness_contract_propose: { anthropic: 'claude-opus-4-6', minimax: null },
        harness_contract_review:  { anthropic: 'claude-opus-4-6', minimax: null },
        harness_generate:         { anthropic: 'claude-sonnet-4-6', minimax: null },
        harness_fix:              { anthropic: 'claude-sonnet-4-6', minimax: null },
        harness_report:           { anthropic: 'claude-haiku-4-5-20251001', minimax: null },
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
 * 更新单个 agent 的模型配置
 * 直接修改 active profile 的 config JSONB
 */
/**
 * 更新单个 agent 的模型配置
 * @param {object} pool - DB pool
 * @param {string} agentId - agent ID
 * @param {string} modelId - model ID
 * @param {object} [options]
 * @param {string} [options.provider] - brain-layer 专用：覆盖自动推导的 provider
 *   仅当 model 的自然 provider 是 'anthropic' 时允许覆盖为 'anthropic-api'（反之亦然）
 */
export async function updateAgentModel(pool, agentId, modelId, options = {}) {
  // 动态导入避免循环依赖
  const { getAgentById, isModelAllowedForAgent, getProviderForModel } = await import('./model-registry.js');

  const agent = getAgentById(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  if (!isModelAllowedForAgent(agentId, modelId)) {
    throw new Error(`Model ${modelId} is not allowed for agent ${agentId}`);
  }

  const naturalProvider = getProviderForModel(modelId);
  if (agent.fixed_provider && naturalProvider !== agent.fixed_provider) {
    throw new Error(`Agent ${agentId} is locked to provider ${agent.fixed_provider}, cannot use ${naturalProvider}`);
  }

  // 确定最终使用的 provider
  // brain-layer 专用：允许 anthropic ↔ anthropic-api 互相覆盖（同为 Anthropic，区别只在调用方式）
  let newProvider = naturalProvider;
  if (options.provider && agent.layer === 'brain') {
    const ANTHROPIC_VARIANTS = ['anthropic', 'anthropic-api'];
    if (
      ANTHROPIC_VARIANTS.includes(naturalProvider) &&
      ANTHROPIC_VARIANTS.includes(options.provider)
    ) {
      newProvider = options.provider;
    }
    // 非 Anthropic 模型的 provider 覆盖忽略（minimax/openai 只有一种调用方式）
  }

  // 获取 active profile
  const { rows: activeRows } = await pool.query(
    'SELECT id, name, config FROM model_profiles WHERE is_active = true LIMIT 1'
  );
  if (activeRows.length === 0) {
    throw new Error('No active profile found');
  }

  const profile = activeRows[0];
  const config = { ...profile.config };
  const previous = {};

  if (agent.layer === 'brain') {
    // brain 层: 直接更新 thalamus 或 cortex
    previous.provider = config[agentId]?.provider;
    previous.model = config[agentId]?.model;
    config[agentId] = { provider: newProvider, model: modelId };
  } else {
    // executor 层: 更新 model_map
    const modelMap = { ...config.executor.model_map };
    previous.model_map = modelMap[agentId] ? { ...modelMap[agentId] } : null;

    // 设置新模型，其他 provider 设为 null
    const newMap = {};
    for (const p of ['anthropic', 'minimax', 'openai']) {
      newMap[p] = p === newProvider ? modelId : null;
    }
    modelMap[agentId] = newMap;

    config.executor = { ...config.executor, model_map: modelMap };
  }

  // 更新 DB
  await pool.query(
    'UPDATE model_profiles SET config = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(config), profile.id]
  );

  // 刷新缓存
  _activeProfile = { ...profile, config, is_active: true };
  console.log(`[model-profile] Updated agent ${agentId} to model ${modelId} (provider: ${newProvider})`);

  return {
    agent_id: agentId,
    previous,
    current: { provider: newProvider, model: modelId },
    profile: _activeProfile,
  };
}

/**
 * 批量更新多个 agent 的模型配置
 * 前端"保存"按钮一次提交所有修改
 */
export async function batchUpdateAgentModels(pool, updates) {
  // updates = [{ agent_id: 'dev', model_id: 'xxx' }, ...]
  const { getAgentById, isModelAllowedForAgent, getProviderForModel } = await import('./model-registry.js');

  // 先校验所有 updates
  for (const { agent_id, model_id } of updates) {
    const agent = getAgentById(agent_id);
    if (!agent) throw new Error(`Unknown agent: ${agent_id}`);
    if (!isModelAllowedForAgent(agent_id, model_id)) {
      throw new Error(`Model ${model_id} is not allowed for agent ${agent_id}`);
    }
    const newProvider = getProviderForModel(model_id);
    if (agent.fixed_provider && newProvider !== agent.fixed_provider) {
      throw new Error(`Agent ${agent_id} is locked to provider ${agent.fixed_provider}`);
    }
  }

  // 获取 active profile
  const { rows: activeRows } = await pool.query(
    'SELECT id, name, config FROM model_profiles WHERE is_active = true LIMIT 1'
  );
  if (activeRows.length === 0) {
    throw new Error('No active profile found');
  }

  const profile = activeRows[0];
  const config = JSON.parse(JSON.stringify(profile.config)); // deep clone

  // 应用所有更新
  const results = [];
  for (const { agent_id, model_id } of updates) {
    const agent = getAgentById(agent_id);
    const newProvider = getProviderForModel(model_id);

    if (agent.layer === 'brain') {
      config[agent_id] = { provider: newProvider, model: model_id };
    } else {
      if (!config.executor.model_map) config.executor.model_map = {};
      const newMap = {};
      for (const p of ['anthropic', 'minimax', 'openai']) {
        newMap[p] = p === newProvider ? model_id : null;
      }
      config.executor.model_map[agent_id] = newMap;
    }
    results.push({ agent_id, provider: newProvider, model: model_id });
  }

  // 单次 DB 写入
  await pool.query(
    'UPDATE model_profiles SET config = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(config), profile.id]
  );

  // 刷新缓存
  _activeProfile = { ...profile, config, is_active: true };
  console.log(`[model-profile] Batch updated ${updates.length} agents`);

  return { updated: results, profile: _activeProfile };
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

  // 优先使用手动配置的 cascade
  if (Array.isArray(mapping.cascade) && mapping.cascade.length > 0) {
    return mapping.cascade;
  }

  // 从天花板自动推导
  const ceiling = mapping.anthropic;
  if (!ceiling) return DEFAULT_CASCADE;
  return CEILING_TO_CASCADE[ceiling] || DEFAULT_CASCADE;
}

/**
 * 更新指定 agent 的 cascade 配置并持久化到 DB
 *
 * @param {import('pg').Pool} pool
 * @param {string} agentId - executor 层 agent ID（如 'dev'、'initiative_plan'）
 * @param {string[]|null} cascade - 降级瀑布数组（null 表示恢复自动）
 * @returns {Promise<{ agent_id: string, cascade: string[]|null, profile: Object }>}
 */
export async function updateAgentCascade(pool, agentId, cascade) {
  const { rows: activeRows } = await pool.query(
    'SELECT id, name, config FROM model_profiles WHERE is_active = true LIMIT 1'
  );
  if (activeRows.length === 0) throw new Error('No active profile found');

  const profile = activeRows[0];
  const config = JSON.parse(JSON.stringify(profile.config));

  if (!config.executor.model_map) config.executor.model_map = {};
  if (!config.executor.model_map[agentId]) {
    config.executor.model_map[agentId] = {};
  }

  if (cascade === null) {
    delete config.executor.model_map[agentId].cascade;
  } else {
    config.executor.model_map[agentId].cascade = cascade;
  }

  await pool.query(
    'UPDATE model_profiles SET config = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(config), profile.id]
  );

  _activeProfile = { ...profile, config, is_active: true };
  console.log(`[model-profile] updateAgentCascade: ${agentId} → ${cascade ? cascade.join(',') : 'auto'}`);

  return { agent_id: agentId, cascade, profile: _activeProfile };
}
