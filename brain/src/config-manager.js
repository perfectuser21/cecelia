/**
 * Brain Config Manager - 失败重试策略配置管理
 *
 * 从 brain_config 表读取配置，支持默认值 fallback
 */

const pool = require('./db').pool;

// 缓存配置（5秒 TTL）
let configCache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL_MS = 5000;

// 默认配置（fallback 值）
const DEFAULT_CONFIG = {
  'quarantine.failure_threshold': 3,
  'quarantine.rate_limit_max_retries': 3,
  'quarantine.network_max_retries': 3,
  'executor.quarantine_after_kills': 2,
  'executor.rate_limit_backoff_minutes': [2, 4, 8],
  'executor.network_backoff_seconds': [30, 60, 120],
  'executor.default_backoff_minutes': 2,
  'executor.max_backoff_minutes': 30,
  'executor.billing_pause_hours': 2
};

/**
 * 获取所有配置（带缓存）
 */
async function getAllConfig(forceRefresh = false) {
  const now = Date.now();

  // 检查缓存
  if (!forceRefresh && configCache.data && (now - configCache.timestamp) < CACHE_TTL_MS) {
    return configCache.data;
  }

  try {
    const result = await pool.query(
      'SELECT config_key, config_value, config_type FROM brain_config'
    );

    const config = { ...DEFAULT_CONFIG };

    for (const row of result.rows) {
      try {
        if (row.config_type === 'json') {
          config[row.config_key] = JSON.parse(row.config_value);
        } else if (row.config_type === 'number') {
          config[row.config_key] = parseFloat(row.config_value);
        } else {
          config[row.config_key] = row.config_value;
        }
      } catch (e) {
        console.warn(`[config-manager] Failed to parse config ${row.config_key}:`, e.message);
      }
    }

    configCache = { data: config, timestamp: now };
    return config;
  } catch (error) {
    console.error('[config-manager] Failed to load config from DB, using defaults:', error.message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 获取单个配置
 */
async function getConfig(key, defaultValue = null) {
  const allConfig = await getAllConfig();
  return allConfig[key] !== undefined ? allConfig[key] : defaultValue;
}

/**
 * 更新配置（带验证）
 */
async function setConfig(key, value, updatedBy = 'api') {
  // 验证 key 是否存在
  const checkResult = await pool.query(
    'SELECT config_type, min_value, max_value FROM brain_config WHERE config_key = $1',
    [key]
  );

  if (checkResult.rows.length === 0) {
    throw new Error(`Config key "${key}" not found`);
  }

  const schema = checkResult.rows[0];

  // 类型验证和转换
  let configValue;
  if (schema.config_type === 'number') {
    configValue = parseFloat(value);
    if (isNaN(configValue)) {
      throw new Error(`Invalid number value: ${value}`);
    }
    // 范围验证
    if (schema.min_value !== null && configValue < parseFloat(schema.min_value)) {
      throw new Error(`Value ${configValue} is below minimum ${schema.min_value}`);
    }
    if (schema.max_value !== null && configValue > parseFloat(schema.max_value)) {
      throw new Error(`Value ${configValue} exceeds maximum ${schema.max_value}`);
    }
  } else if (schema.config_type === 'json') {
    configValue = typeof value === 'string' ? JSON.parse(value) : value;
    configValue = JSON.stringify(configValue);
  } else {
    configValue = String(value);
  }

  // 更新数据库
  await pool.query(
    `UPDATE brain_config
     SET config_value = $1, updated_at = NOW(), updated_by = $2
     WHERE config_key = $3`,
    [configValue, updatedBy, key]
  );

  // 清除缓存
  configCache = { data: null, timestamp: 0 };

  return { key, value: configValue };
}

/**
 * 获取配置 schema（用于 API 文档）
 */
async function getConfigSchema() {
  const result = await pool.query(
    'SELECT config_key, config_value, config_type, description, min_value, max_value, updated_at, updated_by FROM brain_config ORDER BY config_key'
  );

  return result.rows.map(row => ({
    key: row.config_key,
    value: row.config_value,
    type: row.config_type,
    description: row.description,
    min: row.min_value,
    max: row.max_value,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  }));
}

/**
 * 清除缓存（用于测试）
 */
function clearCache() {
  configCache = { data: null, timestamp: 0 };
}

module.exports = {
  getAllConfig,
  getConfig,
  setConfig,
  getConfigSchema,
  clearCache,
  DEFAULT_CONFIG
};
