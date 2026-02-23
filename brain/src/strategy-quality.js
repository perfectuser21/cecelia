/**
 * Strategy Quality Assessment Module
 *
 * Provides quality scoring and filtering for Learning to Strategy conversion.
 */

import pool from './db.js';

/**
 * Default quality thresholds
 */
const DEFAULT_THRESHOLDS = {
  min_quality_score: 50,
  min_confidence: 0.6,
  min_effectiveness_score: 20,
};

/**
 * Quality dimension weights
 */
const DIMENSION_WEIGHTS = {
  confidence: 0.30,
  effectiveness: 0.30,
  completeness: 0.20,
  practicality: 0.20,
};

/**
 * Get quality thresholds from brain_config
 * @returns {Promise<Object>} Quality thresholds
 */
export async function getQualityThresholds() {
  const configKeys = [
    'strategy.quality.min_quality_score',
    'strategy.quality.min_confidence',
    'strategy.quality.min_effectiveness_score',
  ];

  const placeholders = configKeys.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `SELECT key, value FROM brain_config WHERE key IN (${placeholders})`,
    configKeys
  );

  const thresholds = { ...DEFAULT_THRESHOLDS };

  for (const row of result.rows) {
    switch (row.key) {
      case 'strategy.quality.min_quality_score':
        thresholds.min_quality_score = parseInt(row.value, 10) || DEFAULT_THRESHOLDS.min_quality_score;
        break;
      case 'strategy.quality.min_confidence':
        thresholds.min_confidence = parseFloat(row.value) || DEFAULT_THRESHOLDS.min_confidence;
        break;
      case 'strategy.quality.min_effectiveness_score':
        thresholds.min_effectiveness_score = parseInt(row.value, 10) || DEFAULT_THRESHOLDS.min_effectiveness_score;
        break;
    }
  }

  return thresholds;
}

/**
 * Calculate completeness score (0-20)
 * @param {Object} learning - Learning record
 * @returns {number} Completeness score
 */
function calculateCompleteness(learning) {
  let score = 0;

  // Parse content if string
  let content = learning.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch (e) {
      content = {};
    }
  }

  // Check root_cause presence
  if (content.root_cause && content.root_cause.length > 20) {
    score += 10;
  } else if (content.root_cause) {
    score += 5;
  }

  // Check learnings presence
  if (content.learnings && Array.isArray(content.learnings) && content.learnings.length > 0) {
    score += 10;
  }

  return Math.min(score, 20);
}

/**
 * Calculate practicality score (0-20)
 * @param {Object} learning - Learning record
 * @returns {number} Practicality score
 */
function calculatePracticality(learning) {
  let score = 0;

  // Check strategy_adjustments presence
  const adjustments = learning.strategy_adjustments;
  if (adjustments && Array.isArray(adjustments) && adjustments.length > 0) {
    score += 20;
  }

  return score;
}

/**
 * Calculate confidence score (0-30)
 * @param {Object} learning - Learning record
 * @returns {number} Confidence score (0-30)
 */
function calculateConfidenceScore(learning) {
  const metadata = learning.metadata || {};
  const qualityScore = learning.quality_score || 0;

  // Use metadata.confidence first, fall back to quality_score
  const confidence = metadata.confidence || qualityScore;

  // Convert to 0-30 scale
  return Math.min(confidence * 30, 30);
}

/**
 * Calculate effectiveness score (0-30)
 * @param {Object} learning - Learning record
 * @returns {number} Effectiveness score (0-30)
 */
function calculateEffectivenessScore(learning) {
  const effectivenessScore = learning.effectiveness_score || 0;

  // Convert 0-100 to 0-30 scale
  return Math.min((effectivenessScore / 100) * 30, 30);
}

/**
 * Calculate overall quality score for a learning
 * @param {Object} learning - Learning record from database
 * @returns {Object} Quality score result
 */
export function calculateQualityScore(learning) {
  const confidenceScore = calculateConfidenceScore(learning);
  const effectivenessScore = calculateEffectivenessScore(learning);
  const completenessScore = calculateCompleteness(learning);
  const practicalityScore = calculatePracticality(learning);

  // Calculate weighted total (0-100)
  const totalScore = Math.round(
    confidenceScore + effectivenessScore + completenessScore + practicalityScore
  );

  return {
    quality_score: totalScore,
    dimensions: {
      confidence: confidenceScore / 30, // Normalized 0-1
      effectiveness: effectivenessScore / 30, // Normalized 0-1
      completeness: completenessScore / 20, // Normalized 0-1
      practicality: practicalityScore / 20, // Normalized 0-1
    },
    raw_scores: {
      confidence: confidenceScore,
      effectiveness: effectivenessScore,
      completeness: completenessScore,
      practicality: practicalityScore,
    },
  };
}

/**
 * Check if learning passes quality thresholds
 * @param {Object} learning - Learning record
 * @param {Object} thresholds - Quality thresholds
 * @returns {Object} Filter result
 */
export async function checkQualityFilter(learning, thresholds) {
  const thresholds_ = thresholds || await getQualityThresholds();
  const qualityResult = calculateQualityScore(learning);

  const passed = qualityResult.quality_score >= thresholds_.min_quality_score &&
    qualityResult.dimensions.confidence >= thresholds_.min_confidence &&
    (learning.effectiveness_score || 0) >= thresholds_.min_effectiveness_score;

  const reasons = [];
  if (qualityResult.quality_score >= thresholds_.min_quality_score) {
    reasons.push('quality above threshold');
  }
  if (qualityResult.dimensions.confidence >= thresholds_.min_confidence) {
    reasons.push('confidence above threshold');
  }
  if ((learning.effectiveness_score || 0) >= thresholds_.min_effectiveness_score) {
    reasons.push('effectiveness above threshold');
  }

  if (!passed) {
    if (qualityResult.quality_score < thresholds_.min_quality_score) {
      reasons.push(`quality below threshold (${qualityResult.quality_score} < ${thresholds_.min_quality_score})`);
    }
    if (qualityResult.dimensions.confidence < thresholds_.min_confidence) {
      reasons.push(`confidence below threshold (${qualityResult.dimensions.confidence} < ${thresholds_.min_confidence})`);
    }
    if ((learning.effectiveness_score || 0) < thresholds_.min_effectiveness_score) {
      reasons.push(`effectiveness below threshold (${learning.effectiveness_score || 0} < ${thresholds_.min_effectiveness_score})`);
    }
  }

  return {
    learning_id: learning.id,
    title: learning.title,
    quality_score: qualityResult.quality_score,
    dimensions: qualityResult.dimensions,
    passed,
    reasons,
  };
}

/**
 * Get quality statistics for strategies
 * @param {string} strategyId - Optional strategy ID
 * @param {number} periodDays - Period in days
 * @returns {Promise<Object>} Quality statistics
 */
export async function getQualityReport(strategyId, periodDays = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);

  let query = '';
  let params = [];

  if (strategyId) {
    // Get specific strategy quality
    query = `
      SELECT id, name, description, created_at
      FROM strategies
      WHERE id = $1
    `;
    params = [strategyId];
  } else {
    // Get all strategies in period
    query = `
      SELECT id, name, description, created_at
      FROM strategies
      WHERE created_at >= $1
      ORDER BY created_at DESC
    `;
    params = [startDate];
  }

  const strategiesResult = await pool.query(query, params);
  const strategies = strategiesResult.rows;

  // Get thresholds
  const thresholds = await getQualityThresholds();

  // Calculate statistics
  const passedStrategies = [];
  const failedStrategies = [];
  let totalQualityScore = 0;

  for (const strategy of strategies) {
    // Get associated learnings for quality calculation
    const learningsResult = await pool.query(`
      SELECT l.quality_score, l.effectiveness_score, l.metadata, l.content, l.strategy_adjustments
      FROM learnings l
      JOIN strategy_learnings sl ON l.id = sl.learning_id
      WHERE sl.strategy_id = $1 AND l.is_latest = true
    `, [strategy.id]);

    if (learningsResult.rows.length > 0) {
      // Calculate average quality from learnings
      let sumQuality = 0;
      for (const learning of learningsResult.rows) {
        const quality = calculateQualityScore(learning);
        sumQuality += quality.quality_score;
      }
      const avgQuality = Math.round(sumQuality / learningsResult.rows.length);

      const passed = avgQuality >= thresholds.min_quality_score;
      if (passed) {
        passedStrategies.push(strategy);
      } else {
        failedStrategies.push(strategy);
      }
      totalQualityScore += avgQuality;
    }
  }

  const avgQualityScore = strategies.length > 0
    ? Math.round(totalQualityScore / strategies.length)
    : 0;

  return {
    strategy_id: strategyId || null,
    statistics: {
      total_strategies: strategies.length,
      passed_count: passedStrategies.length,
      failed_count: failedStrategies.length,
      avg_quality_score: avgQualityScore,
    },
    thresholds: {
      min_quality_score: thresholds.min_quality_score,
      passed: avgQualityScore >= thresholds.min_quality_score,
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * Get quality filter preview - candidates that can be converted to strategy
 * @param {number} minQualityScore - Minimum quality score threshold
 * @returns {Promise<Object>} Filter preview result
 */
export async function getQualityFilterPreview(minQualityScore = 50) {
  const thresholds = await getQualityThresholds();
  const effectiveThreshold = minQualityScore || thresholds.min_quality_score;

  // Get learnings with quality data
  const learningsResult = await pool.query(`
    SELECT id, title, category, trigger_event, content, metadata,
           quality_score, effectiveness_score, strategy_adjustments, created_at
    FROM learnings
    WHERE is_latest = true
    ORDER BY quality_score DESC, created_at DESC
    LIMIT 100
  `;

  const candidates = [];
  for (const learning of learningsResult.rows) {
    const filterResult = await checkQualityFilter(learning, {
      ...thresholds,
      min_quality_score: effectiveThreshold,
    });

    if (filterResult.passed || filterResult.quality_score >= effectiveThreshold * 0.8) {
      candidates.push(filterResult);
    }
  }

  const passed = candidates.filter(c => c.passed);
  const failed = candidates.filter(c => !c.passed);

  return {
    candidates: candidates.slice(0, 20),
    summary: {
      total: candidates.length,
      passed: passed.length,
      failed: failed.length,
    },
  };
}

export { DEFAULT_THRESHOLDS, DIMENSION_WEIGHTS };
