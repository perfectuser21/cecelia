/**
 * Learning Loop - Brain self-improvement system
 *
 * Implements the learning closed loop:
 * 1. Detect systemic failures
 * 2. Trigger Cortex RCA analysis
 * 3. Generate strategy adjustments
 * 4. Apply adjustments to brain_config
 * 5. Record learnings for future reference
 */

/* global console */
import pool from './db.js';

// Strategy adjustment whitelist (safety measure)
const ADJUSTABLE_PARAMS = {
  'alertness.emergency_threshold': { min: 0.5, max: 1.0, type: 'number' },
  'alertness.alert_threshold': { min: 0.3, max: 0.8, type: 'number' },
  'retry.max_attempts': { min: 1, max: 5, type: 'number' },
  'retry.base_delay_minutes': { min: 1, max: 30, type: 'number' },
  'resource.max_concurrent': { min: 1, max: 20, type: 'number' },
  'resource.memory_threshold_mb': { min: 500, max: 4000, type: 'number' },
};

/**
 * Record learning from Cortex RCA analysis
 * @param {Object} analysis - RCA analysis result from Cortex
 * @param {string} analysis.task_id - Task that triggered learning
 * @param {Object} analysis.analysis - RCA analysis content
 * @param {Array} analysis.learnings - Learning points
 * @param {Array} analysis.recommended_actions - Recommended actions
 * @returns {Promise<Object>} - Created learning record
 */
export async function recordLearning(analysis) {
  const { task_id, analysis: rcaAnalysis, learnings, recommended_actions } = analysis;

  // Extract strategy adjustments from recommended actions
  const strategyAdjustments = recommended_actions?.filter(
    action => action.type === 'adjust_strategy'
  ) || [];

  const title = `RCA Learning: ${rcaAnalysis.root_cause?.slice(0, 100)}`;
  const category = 'failure_pattern';
  const triggerEvent = 'systemic_failure';

  const content = JSON.stringify({
    root_cause: rcaAnalysis.root_cause,
    contributing_factors: rcaAnalysis.contributing_factors,
    learnings,
  });

  try {
    const result = await pool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, strategy_adjustments, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      title,
      category,
      triggerEvent,
      content,
      JSON.stringify(strategyAdjustments),
      JSON.stringify({ task_id, confidence: analysis.confidence }),
    ]);

    console.log(`[learning] Recorded learning: ${result.rows[0].id}`);
    return result.rows[0];
  } catch (err) {
    console.error(`[learning] Failed to record learning: ${err.message}`);
    throw err;
  }
}

/**
 * Apply strategy adjustments to brain_config
 * @param {Array} adjustments - Strategy adjustments to apply
 * @param {string} learningId - Learning record ID (for audit trail)
 * @returns {Promise<Object>} - Application result
 */
export async function applyStrategyAdjustments(adjustments, learningId) {
  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return { applied: 0, skipped: 0, errors: [] };
  }

  const results = {
    applied: 0,
    skipped: 0,
    errors: [],
  };

  for (const adjustment of adjustments) {
    const { params } = adjustment;
    if (!params || !params.param) {
      results.errors.push({ adjustment, reason: 'missing_param_name' });
      continue;
    }

    const paramName = params.param;
    const newValue = params.new_value;

    // Validate against whitelist
    const paramConfig = ADJUSTABLE_PARAMS[paramName];
    if (!paramConfig) {
      results.errors.push({ adjustment, reason: 'param_not_whitelisted' });
      results.skipped++;
      continue;
    }

    // Validate value range
    if (paramConfig.type === 'number') {
      if (newValue < paramConfig.min || newValue > paramConfig.max) {
        results.errors.push({
          adjustment,
          reason: `value_out_of_range (${paramConfig.min}-${paramConfig.max})`,
        });
        results.skipped++;
        continue;
      }
    }

    // Apply to brain_config
    try {
      await pool.query(`
        INSERT INTO brain_config (key, value, updated_at, metadata)
        VALUES ($1, $2, NOW(), $3)
        ON CONFLICT (key) DO UPDATE SET
          value = $2,
          updated_at = NOW(),
          metadata = $3
      `, [
        paramName,
        JSON.stringify(newValue),
        JSON.stringify({
          learning_id: learningId,
          old_value: params.old_value,
          reason: params.reason,
          applied_at: new Date().toISOString(),
        }),
      ]);

      console.log(`[learning] Applied strategy adjustment: ${paramName} = ${newValue}`);
      results.applied++;
    } catch (err) {
      console.error(`[learning] Failed to apply adjustment ${paramName}: ${err.message}`);
      results.errors.push({ adjustment, reason: err.message });
    }
  }

  // Mark learning as applied
  if (results.applied > 0 && learningId) {
    try {
      await pool.query(`
        UPDATE learnings SET applied = true, applied_at = NOW()
        WHERE id = $1
      `, [learningId]);
    } catch (err) {
      console.error(`[learning] Failed to mark learning as applied: ${err.message}`);
    }
  }

  return results;
}

/**
 * Get recent learnings
 * @param {string} category - Learning category filter (optional)
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Learning records
 */
export async function getRecentLearnings(category = null, limit = 10) {
  try {
    let query = `
      SELECT id, title, category, trigger_event, content, strategy_adjustments, applied, created_at, metadata
      FROM learnings
    `;
    const params = [];

    if (category) {
      query += ` WHERE category = $1`;
      params.push(category);
      query += ` ORDER BY created_at DESC LIMIT $2`;
      params.push(limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $1`;
      params.push(limit);
    }

    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    console.error(`[learning] Failed to get recent learnings: ${err.message}`);
    return [];
  }
}

/**
 * Check if a learning task should be created for systemic failure
 * @param {Object} failureInfo - Failure information
 * @returns {boolean} - Whether to create learning task
 */
export function shouldTriggerLearning(failureInfo) {
  // Trigger learning for systemic failures
  if (failureInfo.is_systemic) {
    return true;
  }

  // Don't trigger for individual task errors
  return false;
}

/**
 * Create learning task for Cortex analysis
 * @param {Object} failureContext - Context about the failure
 * @returns {Promise<string>} - Created task ID
 */
export async function createLearningTask(failureContext) {
  const { trigger, failures, signals } = failureContext;

  try {
    const result = await pool.query(`
      INSERT INTO tasks (title, description, task_type, priority, status, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      `Learning - ${trigger}`,
      `Analyze systemic failure pattern and generate strategy adjustments.

Trigger: ${trigger}
Recent failures: ${failures?.length || 0}

System signals:
${JSON.stringify(signals, null, 2)}

Required analysis:
1. Root cause identification
2. Contributing factors
3. Strategy adjustments (specific parameter changes)
4. Recommended mitigations`,
      'research',
      'P1',
      'queued',
      JSON.stringify({
        requires_cortex: true,
        requires_learning: true,
        trigger,
        failures,
        signals,
        created_by: 'learning_system',
      }),
    ]);

    const taskId = result.rows[0].id;
    console.log(`[learning] Created learning task: ${taskId}`);
    return taskId;
  } catch (err) {
    console.error(`[learning] Failed to create learning task: ${err.message}`);
    throw err;
  }
}

export {
  ADJUSTABLE_PARAMS,
};
