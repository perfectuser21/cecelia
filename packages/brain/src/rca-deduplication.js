/**
 * RCA Deduplication Module (P1)
 *
 * 职责：
 * 1. 防止 24h 内对同一错误签名重复 RCA 分析
 * 2. 节省 Cortex（Opus）调用成本
 * 3. 缓存历史分析结果供查询
 *
 * 原理：
 * - 错误签名 = SHA256(reason_code:layer:step_name)
 * - rca_cache 表存储：signature, root_cause, proposed_fix, confidence, ts_analyzed
 * - shouldAnalyzeFailure() 查询 24h 内是否有相同签名
 */

import crypto from 'crypto';
import pool from './db.js';

/**
 * Generate error signature for deduplication
 *
 * @param {Object} failure - Failure object from run_events
 * @param {string} failure.reason_code - Error code
 * @param {string} failure.layer - Execution layer (L2_executor, L1_thalamus, etc.)
 * @param {string} failure.step_name - Step where error occurred
 * @returns {string} 16-char hex signature
 */
export function generateErrorSignature(failure) {
  const parts = [
    failure.reason_code || 'UNKNOWN',
    failure.layer || '',
    failure.step_name || ''
  ].filter(Boolean);

  const signature = parts.join(':');
  const hash = crypto.createHash('sha256').update(signature).digest('hex');

  return hash.substring(0, 16);
}

/**
 * Check if failure needs RCA analysis
 *
 * @param {Object} failure - Failure object
 * @returns {Promise<Object>} { should_analyze: boolean, signature: string, cached_result?: Object }
 */
export async function shouldAnalyzeFailure(failure) {
  const signature = generateErrorSignature(failure);

  // Check if same signature analyzed in last 24 hours
  const query = `
    SELECT
      signature,
      root_cause,
      proposed_fix,
      action_plan,
      confidence,
      evidence,
      ts_analyzed,
      EXTRACT(EPOCH FROM (NOW() - ts_analyzed)) / 3600 AS hours_ago
    FROM rca_cache
    WHERE signature = $1
      AND ts_analyzed > NOW() - INTERVAL '24 hours'
    ORDER BY ts_analyzed DESC
    LIMIT 1
  `;

  const result = await pool.query(query, [signature]);

  if (result.rows.length > 0) {
    // Found recent analysis, skip
    const cached = result.rows[0];
    const hoursAgo = parseFloat(cached.hours_ago) || 0;
    console.log(`[RCA] Skip duplicate analysis for signature=${signature} (analyzed ${hoursAgo.toFixed(1)}h ago)`);

    return {
      should_analyze: false,
      signature: signature,
      cached_result: {
        root_cause: cached.root_cause,
        proposed_fix: cached.proposed_fix,
        action_plan: cached.action_plan,
        confidence: cached.confidence,
        evidence: cached.evidence,
        ts_analyzed: cached.ts_analyzed
      }
    };
  }

  // No recent analysis, proceed
  console.log(`[RCA] New error signature=${signature}, will analyze`);
  return {
    should_analyze: true,
    signature: signature
  };
}

/**
 * Cache RCA result
 *
 * @param {Object} failure - Original failure object
 * @param {Object} rcaResult - RCA analysis result from Cortex
 * @param {string} rcaResult.root_cause - Root cause analysis
 * @param {string} rcaResult.proposed_fix - Proposed fix
 * @param {string} rcaResult.action_plan - Action plan
 * @param {number} rcaResult.confidence - Confidence score (0-1)
 * @param {string} rcaResult.evidence - Evidence from logs/traces
 * @returns {Promise<void>}
 */
export async function cacheRcaResult(failure, rcaResult) {
  const signature = generateErrorSignature(failure);

  const query = `
    INSERT INTO rca_cache (
      signature,
      reason_code,
      layer,
      step_name,
      root_cause,
      proposed_fix,
      action_plan,
      confidence,
      evidence,
      ts_analyzed
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (signature)
    DO UPDATE SET
      root_cause = EXCLUDED.root_cause,
      proposed_fix = EXCLUDED.proposed_fix,
      action_plan = EXCLUDED.action_plan,
      confidence = EXCLUDED.confidence,
      evidence = EXCLUDED.evidence,
      ts_analyzed = NOW()
  `;

  await pool.query(query, [
    signature,
    failure.reason_code || 'UNKNOWN',
    failure.layer || '',
    failure.step_name || '',
    rcaResult.root_cause || '',
    rcaResult.proposed_fix || '',
    rcaResult.action_plan || '',
    rcaResult.confidence || 0,
    rcaResult.evidence || ''
  ]);

  console.log(`[RCA] Cached result for signature=${signature}`);
}

/**
 * Get RCA cache statistics
 *
 * @returns {Promise<Object>} Stats object
 */
export async function getRcaCacheStats() {
  const query = `
    SELECT
      COUNT(*) AS total_cached,
      COUNT(*) FILTER (WHERE ts_analyzed > NOW() - INTERVAL '24 hours') AS cached_last_24h,
      COUNT(DISTINCT signature) AS unique_signatures,
      AVG(confidence) AS avg_confidence
    FROM rca_cache
  `;

  const result = await pool.query(query);
  return result.rows[0];
}

/**
 * Clean old cache entries (older than 7 days)
 *
 * @returns {Promise<number>} Number of deleted entries
 */
export async function cleanOldCache() {
  const query = `
    DELETE FROM rca_cache
    WHERE ts_analyzed < NOW() - INTERVAL '7 days'
    RETURNING signature
  `;

  const result = await pool.query(query);
  const deletedCount = result.rows.length;

  if (deletedCount > 0) {
    console.log(`[RCA] Cleaned ${deletedCount} old cache entries (>7 days)`);
  }

  return deletedCount;
}
