/** 经验策略调整及成效审计；函数合同保持原样，公开入口由learning.js转出。 */
import pool from './db.js';
import { EXEC_STATUS_US_TASK_TYPES } from './lib/task-type-registry.js';

export const ADJUSTABLE_PARAMS = {
  'alertness.emergency_threshold': { min: 0.5, max: 1.0, type: 'number' },
  'alertness.alert_threshold': { min: 0.3, max: 0.8, type: 'number' },
  'retry.max_attempts': { min: 1, max: 5, type: 'number' },
  'retry.base_delay_minutes': { min: 1, max: 30, type: 'number' },
  'resource.max_concurrent': { min: 1, max: 20, type: 'number' },
  'resource.memory_threshold_mb': { min: 500, max: 4000, type: 'number' },
};

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
 * Evaluate strategy adjustment effectiveness
 * Compares task success rates before and after strategy adjustment
 * @param {string} strategyKey - Strategy parameter name (e.g., 'retry.max_attempts')
 * @param {number} days - Evaluation period in days (default: 7)
 * @returns {Promise<Object>} - Effectiveness evaluation result
 */
export async function evaluateStrategyEffectiveness(strategyKey, days = 7) {
  try {
    // 1. Find strategy adoption record
    const adoptionResult = await pool.query(`
      SELECT id, adopted_at, strategy_key, old_value, new_value
      FROM strategy_adoptions
      WHERE strategy_key = $1
      ORDER BY adopted_at DESC
      LIMIT 1
    `, [strategyKey]);

    if (adoptionResult.rows.length === 0) {
      return {
        strategy_key: strategyKey,
        found: false,
        message: 'No adoption record found for this strategy',
      };
    }

    const adoption = adoptionResult.rows[0];
    const adoptedAt = new Date(adoption.adopted_at);
    const now = new Date();
    const daysSinceAdoption = Math.floor((now - adoptedAt) / (1000 * 60 * 60 * 24));

    // Need at least 'days' period after adoption to evaluate
    if (daysSinceAdoption < days) {
      return {
        strategy_key: strategyKey,
        adoption_id: adoption.id,
        evaluation_possible: false,
        message: `Not enough time passed (${daysSinceAdoption} days < ${days} days required)`,
        days_since_adoption: daysSinceAdoption,
      };
    }

    // 2. Calculate baseline success rate (period BEFORE adoption)
    const baselineStart = new Date(adoptedAt.getTime() - days * 24 * 60 * 60 * 1000);
    const baselineEnd = adoptedAt;

    const baselineResult = await pool.query(`
      SELECT
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks
      FROM tasks
      WHERE created_at >= $1 AND created_at < $2
        AND task_type = ANY($3::text[])
    `, [baselineStart, baselineEnd, EXEC_STATUS_US_TASK_TYPES]);

    const baselineTotal = parseInt(baselineResult.rows[0].total_tasks);
    const baselineCompleted = parseInt(baselineResult.rows[0].completed_tasks);
    const baselineSuccessRate = baselineTotal > 0
      ? ((baselineCompleted / baselineTotal) * 100).toFixed(2)
      : null;

    // 3. Calculate post-adjustment success rate (period AFTER adoption)
    const postStart = adoptedAt;
    const postEnd = new Date(adoptedAt.getTime() + days * 24 * 60 * 60 * 1000);

    const postResult = await pool.query(`
      SELECT
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks
      FROM tasks
      WHERE created_at >= $1 AND created_at < $2
        AND task_type = ANY($3::text[])
    `, [postStart, postEnd, EXEC_STATUS_US_TASK_TYPES]);

    const postTotal = parseInt(postResult.rows[0].total_tasks);
    const postCompleted = parseInt(postResult.rows[0].completed_tasks);
    const postSuccessRate = postTotal > 0
      ? ((postCompleted / postTotal) * 100).toFixed(2)
      : null;

    // 4. Determine if effective (success rate improvement > 5%)
    const isEffective = baselineSuccessRate !== null && postSuccessRate !== null
      ? (postSuccessRate - baselineSuccessRate) > 5
      : null;

    const improvementPercentage = baselineSuccessRate !== null && postSuccessRate !== null
      ? (postSuccessRate - baselineSuccessRate).toFixed(2)
      : null;

    // 5. Save to strategy_effectiveness table
    await pool.query(`
      INSERT INTO strategy_effectiveness (
        adoption_id,
        strategy_key,
        baseline_success_rate,
        post_adjustment_success_rate,
        sample_size,
        evaluation_period_days,
        is_effective,
        improvement_percentage,
        evaluated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (adoption_id) DO UPDATE SET
        baseline_success_rate = $3,
        post_adjustment_success_rate = $4,
        sample_size = $5,
        is_effective = $7,
        improvement_percentage = $8,
        evaluated_at = NOW()
    `, [
      adoption.id,
      strategyKey,
      baselineSuccessRate,
      postSuccessRate,
      postTotal,
      days,
      isEffective,
      improvementPercentage,
    ]);

    // 6. Update effectiveness_score in strategy_adoptions table
    if (isEffective !== null) {
      const effectivenessScore = isEffective
        ? Math.min(40, Math.floor(parseFloat(improvementPercentage) * 4)) // Max 40 points
        : 0;

      await pool.query(`
        UPDATE strategy_adoptions
        SET effectiveness_score = $1, evaluated_at = NOW()
        WHERE id = $2
      `, [effectivenessScore, adoption.id]);
    }

    console.log(`[learning] Strategy effectiveness evaluated: ${strategyKey} - ${isEffective ? 'Effective' : 'Not effective'} (${improvementPercentage}% improvement)`);

    return {
      strategy_key: strategyKey,
      adoption_id: adoption.id,
      evaluation_possible: true,
      baseline_success_rate: parseFloat(baselineSuccessRate),
      post_adjustment_success_rate: parseFloat(postSuccessRate),
      improvement_percentage: parseFloat(improvementPercentage),
      is_effective: isEffective,
      sample_size: postTotal,
      evaluation_period_days: days,
      baseline_period: { start: baselineStart, end: baselineEnd, sample_size: baselineTotal },
      post_period: { start: postStart, end: postEnd, sample_size: postTotal },
    };
  } catch (err) {
    console.error(`[learning] Failed to evaluate strategy effectiveness: ${err.message}`);
    throw err;
  }
}
