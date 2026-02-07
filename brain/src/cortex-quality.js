/**
 * Cortex Quality Assessment Module
 *
 * Provides quality scoring, similarity detection, and effectiveness tracking
 * for Cortex RCA analyses.
 */

import crypto from 'crypto';
import pool from './db.js';

/**
 * Calculate quality score for an analysis (initial evaluation)
 * @param {string} analysisId - Analysis UUID
 * @returns {Promise<Object>} Quality evaluation result
 */
export async function evaluateQualityInitial(analysisId) {
  // Fetch analysis
  const result = await pool.query(
    'SELECT * FROM cortex_analyses WHERE id = $1',
    [analysisId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Analysis not found: ${analysisId}`);
  }

  const analysis = result.rows[0];

  // Calculate dimensions
  const completeness = calculateCompleteness(analysis);
  const effectiveness = 0; // Initial - needs feedback
  const timeliness = calculateTimeliness(analysis);
  const uniqueness = 15; // Initial assumption - will adjust if duplicate

  const qualityScore = completeness + effectiveness + timeliness + uniqueness;

  const dimensions = {
    completeness,
    effectiveness,
    timeliness,
    uniqueness
  };

  // Save to database
  await pool.query(
    `UPDATE cortex_analyses
     SET quality_score = $1, quality_dimensions = $2
     WHERE id = $3`,
    [qualityScore, JSON.stringify(dimensions), analysisId]
  );

  return {
    analysis_id: analysisId,
    quality_score: qualityScore,
    dimensions
  };
}

/**
 * Calculate completeness score (0-30 points)
 */
function calculateCompleteness(analysis) {
  let score = 0;

  // Root cause clarity (0-15)
  const rootCause = analysis.root_cause || '';
  if (rootCause.length > 50) score += 15;
  else if (rootCause.length > 20) score += 10;
  else if (rootCause.length > 0) score += 5;

  // Contributing factors (0-10)
  let factors = analysis.contributing_factors || [];
  if (typeof factors === 'string') {
    try {
      factors = JSON.parse(factors);
    } catch (e) {
      factors = [];
    }
  }
  if (Array.isArray(factors) && factors.length >= 3) {
    score += 10;
  } else if (Array.isArray(factors) && factors.length > 0) {
    score += 5;
  }

  // Strategy updates with reasoning (0-5)
  let updates = analysis.strategy_adjustments || [];
  if (typeof updates === 'string') {
    try {
      updates = JSON.parse(updates);
    } catch (e) {
      updates = [];
    }
  }
  if (Array.isArray(updates) && updates.length > 0 &&
      updates.every(u => u.reason || u.rationale)) {
    score += 5;
  }

  return score;
}

/**
 * Calculate timeliness score (0-15 points)
 */
function calculateTimeliness(analysis) {
  // For now, assume good timeliness
  // In real implementation, compare created_at with trigger time
  return 15;
}

/**
 * Generate similarity hash for an analysis context
 * @param {Object} context - Analysis context (task_type, reason, root_cause)
 * @returns {string} SHA256 hash
 */
export function generateSimilarityHash(context) {
  const { task_type, reason, root_cause } = context;

  const normalizedInput = [
    task_type || '',
    (reason || '').toLowerCase().trim(),
    (root_cause || '').toLowerCase().trim().substring(0, 200),
  ].join('|');

  return crypto.createHash('sha256').update(normalizedInput).digest('hex');
}

/**
 * Check if a new RCA should be created or reuse existing
 * @param {Object} context - Failure context
 * @returns {Promise<Object>} Decision result
 */
export async function checkShouldCreateRCA(context) {
  const hash = generateSimilarityHash(context);

  // Find similar analyses
  const similarAnalyses = await findSimilarAnalyses(hash);

  if (similarAnalyses.length === 0) {
    return {
      should_create: true,
      duplicate_of: null,
      similarity: 0
    };
  }

  // Calculate similarity for each
  const similarities = similarAnalyses.map(analysis => {
    const similarity = calculateSimilarity(
      context.root_cause || '',
      analysis.root_cause || ''
    );
    return { analysis, similarity };
  });

  // Find max similarity
  const maxMatch = similarities.reduce((max, curr) =>
    curr.similarity > max.similarity ? curr : max
  );

  // Threshold: 80%
  if (maxMatch.similarity > 80) {
    return {
      should_create: false,
      duplicate_of: maxMatch.analysis.id,
      similarity: maxMatch.similarity
    };
  }

  return {
    should_create: true,
    duplicate_of: null,
    similarity: maxMatch.similarity
  };
}

/**
 * Find analyses with similar hash
 */
async function findSimilarAnalyses(hash) {
  const result = await pool.query(
    `SELECT id, root_cause, similarity_hash
     FROM cortex_analyses
     WHERE similarity_hash = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [hash]
  );

  return result.rows;
}

/**
 * Calculate text similarity (simple word overlap)
 */
function calculateSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return Math.round((intersection.size / union.size) * 100);
}

/**
 * Get quality statistics for a time period
 * @param {number} days - Number of days to look back
 * @returns {Promise<Object>} Statistics
 */
export async function getQualityStats(days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const result = await pool.query(
    `SELECT
       COUNT(*) as total_rcas,
       AVG(quality_score) as avg_quality_score,
       MIN(quality_score) as min_quality_score,
       MAX(quality_score) as max_quality_score
     FROM cortex_analyses
     WHERE created_at >= $1 AND quality_score IS NOT NULL`,
    [cutoff]
  );

  const stats = result.rows[0];

  return {
    period_days: days,
    total_rcas: parseInt(stats.total_rcas) || 0,
    avg_quality_score: parseFloat(stats.avg_quality_score) || 0,
    min_quality_score: parseInt(stats.min_quality_score) || 0,
    max_quality_score: parseInt(stats.max_quality_score) || 0
  };
}
