/**
 * Config Loader - Brain Configuration Reader
 *
 * Reads dynamic configuration from brain_config table.
 * Bridges the gap between Cortex strategy adjustments (written to DB)
 * and system behavior (needs to read adjusted parameters).
 */

import pool from './db.js';

/**
 * Read a configuration value from brain_config table
 *
 * @param {string} key - Configuration key (e.g., 'alertness.alert_threshold')
 * @param {*} defaultValue - Default value if key not found in DB
 * @returns {Promise<*>} Configuration value or defaultValue
 */
export async function readBrainConfig(key, defaultValue) {
  try {
    const result = await pool.query(
      'SELECT value FROM brain_config WHERE key = $1',
      [key]
    );

    if (result.rows.length === 0) {
      return defaultValue;
    }

    // brain_config.value is JSONB, extract the actual value
    const value = result.rows[0].value;

    // If value is a JSON string, parse it; otherwise return as-is
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return value;
  } catch (err) {
    console.error(`[config-loader] Failed to read config key "${key}":`, err.message);
    return defaultValue;
  }
}

/**
 * Read multiple configuration values at once
 *
 * @param {Object} keyDefaults - Object mapping keys to default values
 * @returns {Promise<Object>} Object with same keys, values from DB or defaults
 *
 * @example
 * const config = await readBrainConfigBatch({
 *   'alertness.alert_threshold': 0.5,
 *   'retry.max_attempts': 3
 * });
 * // Returns: { 'alertness.alert_threshold': 0.5, 'retry.max_attempts': 3 }
 */
export async function readBrainConfigBatch(keyDefaults) {
  const keys = Object.keys(keyDefaults);

  if (keys.length === 0) {
    return {};
  }

  try {
    const result = await pool.query(
      'SELECT key, value FROM brain_config WHERE key = ANY($1)',
      [keys]
    );

    // Build result object with defaults
    const config = { ...keyDefaults };

    // Override with DB values
    for (const row of result.rows) {
      let value = row.value;

      // Parse if string
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep as string
        }
      }

      config[row.key] = value;
    }

    return config;
  } catch (err) {
    console.error('[config-loader] Failed to read config batch:', err.message);
    return keyDefaults;
  }
}

/**
 * Get all adjustable parameters with their current values
 *
 * This is the master list of parameters that Cortex can adjust.
 *
 * @returns {Promise<Object>} Current configuration values
 */
export async function loadAllAdjustableParams() {
  const defaults = {
    // Alertness thresholds
    'alertness.alert_threshold': 0.5,
    'alertness.emergency_threshold': 0.7,
    'alertness.coma_threshold': 0.9,

    // Retry parameters
    'retry.max_attempts': 3,
    'retry.backoff_base_seconds': 60,

    // Resource limits
    'resource.max_concurrent_tasks': 10,
    'resource.memory_threshold_mb': 2048,

    // Circuit breaker
    'circuit_breaker.failure_threshold': 3,
    'circuit_breaker.timeout_seconds': 1800,
  };

  return await readBrainConfigBatch(defaults);
}
