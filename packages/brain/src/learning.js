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
import crypto from 'crypto';
import pool from './db.js';
import { generateEmbedding } from './openai-client.js';
import { generateLearningEmbeddingAsync } from './embedding-service.js';
import { generateL0Summary } from './memory-utils.js';

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
    // 计算 content_hash 进行去重
    const hashInput = `${title}\n${content}`;
    const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

    // 检查是否已存在相同 hash 的记录
    const existing = await pool.query(
      'SELECT id, version FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
      [contentHash]
    );

    if (existing.rows.length > 0) {
      // 已存在：更新版本号，不重复插入
      const existingId = existing.rows[0].id;
      const newVersion = (existing.rows[0].version || 1) + 1;
      await pool.query(
        'UPDATE learnings SET version = $1, metadata = metadata || $2, created_at = NOW() WHERE id = $3',
        [newVersion, JSON.stringify({ last_duplicate_at: new Date().toISOString() }), existingId]
      );
      console.log(`[learning] Deduplicated: existing=${existingId} version=${newVersion}`);
      return existing.rows[0];
    }

    const summary = generateL0Summary(`${title} ${content}`);
    const result = await pool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, strategy_adjustments, metadata, content_hash, version, is_latest, summary)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, true, $8)
      RETURNING *
    `, [
      title,
      category,
      triggerEvent,
      content,
      JSON.stringify(strategyAdjustments),
      JSON.stringify({ task_id, confidence: analysis.confidence }),
      contentHash,
      summary,
    ]);

    const learning = result.rows[0];
    console.log(`[learning] Recorded learning: ${learning.id}`);

    // Fire-and-forget: 异步生成 embedding
    const embeddingText = `${title}\n\n${content}`.substring(0, 4000);
    generateLearningEmbeddingAsync(learning.id, embeddingText);

    return learning;
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
 * Search relevant learnings based on semantic context
 * @param {Object} context - Search context
 * @param {string} context.task_type - Task type (dev/review/qa/audit/research/talk/data)
 * @param {string} context.failure_class - Failure class (NETWORK/BILLING_CAP/RATE_LIMIT/RESOURCE/etc)
 * @param {string} context.event_type - Event type (systemic_failure/rca_request/etc)
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Learning records sorted by relevance
 */
export async function searchRelevantLearnings(context = {}, limit = 10) {
  try {
    // Build query text from context
    const queryText = [context.task_type, context.failure_class, context.event_type, context.description]
      .filter(Boolean).join(' ');

    // Check if vector search is available
    let useVectorSearch = false;
    if (queryText && process.env.OPENAI_API_KEY) {
      try {
        const countResult = await pool.query(
          `SELECT COUNT(*) FROM learnings WHERE embedding IS NOT NULL`
        );
        useVectorSearch = parseInt(countResult.rows[0].count) > 0;
      } catch (_err) {
        // embedding column may not exist yet, fallback to keyword
      }
    }

    let results;
    if (useVectorSearch) {
      results = await vectorSearchLearnings(queryText, limit * 2, context);
    } else {
      results = await keywordSearchLearnings(context, limit);
    }

    // Sort by score and return top N
    results.sort((a, b) => b.relevance_score - a.relevance_score);
    return results.slice(0, limit);
  } catch (err) {
    console.error(`[learning] Failed to search relevant learnings: ${err.message}`);
    // Fallback to getRecentLearnings
    return getRecentLearnings(null, limit);
  }
}

/**
 * Vector search for learnings using pgvector
 * @param {string} queryText - Query text
 * @param {number} limit - Maximum results
 * @param {Object} context - Search context for keyword boost
 * @returns {Promise<Array>} Scored learning records
 */
async function vectorSearchLearnings(queryText, limit, context = {}) {
  const queryEmbedding = await generateEmbedding(queryText);
  const embStr = `[${queryEmbedding.join(',')}]`;

  const result = await pool.query(`
    SELECT id, title, category, trigger_event, content, strategy_adjustments,
           applied, created_at, metadata,
           1 - (embedding <=> $1::vector) AS vector_score
    FROM learnings
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `, [embStr, limit]);

  return result.rows.map(learning => {
    const vectorScore = learning.vector_score || 0;
    const boost = keywordBoost(learning, context);
    return {
      ...learning,
      relevance_score: (vectorScore * 30) + boost,  // Scale to match keyword scoring range (~30 max)
    };
  });
}

/**
 * Keyword-based search for learnings (fallback)
 * @param {Object} context - Search context
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Scored learning records
 */
async function keywordSearchLearnings(context, limit) {
  const result = await pool.query(`
    SELECT id, title, category, trigger_event, content, strategy_adjustments, applied, created_at, metadata
    FROM learnings
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return result.rows.map(learning => {
    let score = 0;
    const metadata = learning.metadata || {};
    const content = learning.content || '';
    const contentLower = content.toLowerCase();

    if (context.task_type && metadata.task_type === context.task_type) score += 10;
    if (context.failure_class) {
      if (contentLower.includes(context.failure_class.toLowerCase())) score += 8;
    }
    if (context.event_type && learning.trigger_event === context.event_type) score += 6;
    if (learning.category === 'failure_pattern') score += 4;

    const ageInDays = (Date.now() - new Date(learning.created_at).getTime()) / 86400000;
    if (ageInDays <= 7) score += 3;
    else if (ageInDays <= 30) score += 2;
    else score += 1;

    return { ...learning, relevance_score: score };
  }).slice(0, limit);
}

/**
 * Calculate keyword boost for a learning record
 * @param {Object} learning - Learning record
 * @param {Object} context - Search context
 * @returns {number} Boost score
 */
function keywordBoost(learning, context = {}) {
  let boost = 0;
  const metadata = learning.metadata || {};
  const content = learning.content || '';
  const contentLower = content.toLowerCase();

  if (context.task_type && metadata.task_type === context.task_type) boost += 5;
  if (context.failure_class && contentLower.includes(context.failure_class.toLowerCase())) boost += 4;
  if (context.event_type && learning.trigger_event === context.event_type) boost += 3;
  if (learning.category === 'failure_pattern') boost += 2;

  return boost;
}

/**
 * Get recent learnings (fallback / backward compatibility)
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
        AND task_type IN ('dev', 'review', 'qa', 'audit')
    `, [baselineStart, baselineEnd]);

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
        AND task_type IN ('dev', 'review', 'qa', 'audit')
    `, [postStart, postEnd]);

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

export {
  ADJUSTABLE_PARAMS,
  vectorSearchLearnings as _vectorSearchLearnings,
  keywordSearchLearnings as _keywordSearchLearnings,
  keywordBoost as _keywordBoost,
};
