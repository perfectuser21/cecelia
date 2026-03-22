/**
 * task-type-config-cache.js
 *
 * 动态任务类型路由配置的内存缓存层。
 * 从 task_type_configs 表加载，供 executor.js 路由决策时同步读取。
 *
 * 分层策略（铁律）：
 *   - A类（dev/cecelia_run）：hardcoded in executor.js，不在此缓存
 *   - Coding pathway B类（code_review/decomp_review/initiative_plan 等）：hardcoded，不在此缓存
 *   - 其余 Codex B类（strategy_session/knowledge 等）：此缓存管理
 */

/** @type {Map<string, {location: string, executor: string, skill: string|null}>} */
let _cache = new Map();
let _loaded = false;

/**
 * 从 DB 加载动态任务类型配置到内存缓存。
 * 在 Brain 启动时调用一次。
 * @param {import('pg').Pool} pool
 */
export async function loadCache(pool) {
  try {
    const { rows } = await pool.query(
      'SELECT task_type, location, executor, skill FROM task_type_configs WHERE is_dynamic = true'
    );
    _cache = new Map(rows.map(r => [r.task_type, { location: r.location, executor: r.executor, skill: r.skill }]));
    _loaded = true;
    console.log(`[task-type-config-cache] 已加载 ${_cache.size} 条动态任务类型配置`);
  } catch (err) {
    console.warn(`[task-type-config-cache] 加载失败（使用空缓存）: ${err.message}`);
    _cache = new Map();
    _loaded = true;
  }
}

/**
 * 从 DB 重新加载缓存（PUT 更新后调用）。
 * @param {import('pg').Pool} pool
 */
export async function refreshCache(pool) {
  await loadCache(pool);
}

/**
 * 获取动态任务类型的 location。
 * 如果不在缓存中（A类或 Coding pathway），返回 null，让调用方 fallback 到 hardcoded 逻辑。
 * @param {string} taskType
 * @returns {string|null} 'us' | 'hk' | 'xian' | null
 */
export function getCachedLocation(taskType) {
  if (!_loaded) return null;
  const config = _cache.get(taskType);
  return config ? config.location : null;
}

/**
 * 获取动态任务类型的完整配置。
 * @param {string} taskType
 * @returns {{location: string, executor: string, skill: string|null}|null}
 */
export function getCachedConfig(taskType) {
  if (!_loaded) return null;
  return _cache.get(taskType) || null;
}

/**
 * 获取所有动态任务类型列表（用于 API）。
 * @returns {string[]}
 */
export function getDynamicTaskTypes() {
  return Array.from(_cache.keys());
}

/**
 * 更新（或新增）单条任务类型配置（UPSERT 写 DB + 刷新缓存）。
 * 若 task_type 不存在则插入，已存在则更新指定字段。
 * @param {import('pg').Pool} pool
 * @param {string} taskType
 * @param {{location?: string, executor?: string, skill?: string}} updates
 * @returns {Promise<{task_type: string, location: string, executor: string, skill: string|null, updated_at: Date}|null>}
 */
export async function updateConfig(pool, taskType, updates) {
  const { location, executor, skill } = updates;
  if (!location && !executor && !skill) return null;

  // UPSERT：不存在则插入，已存在则只更新提供的字段
  const { rows } = await pool.query(
    `INSERT INTO task_type_configs (task_type, location, executor, skill, is_dynamic, updated_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     ON CONFLICT (task_type) DO UPDATE SET
       location   = COALESCE($2, task_type_configs.location),
       executor   = COALESCE($3, task_type_configs.executor),
       skill      = COALESCE($4, task_type_configs.skill),
       updated_at = NOW()
     RETURNING task_type, location, executor, skill, updated_at`,
    [taskType, location ?? null, executor ?? null, skill ?? null]
  );

  if (rows.length === 0) return null;

  // 刷新内存缓存
  await refreshCache(pool);
  return rows[0];
}
