/**
 * Immune System Module (P0)
 *
 * 职责：
 * 1. 更新失败签名计数（failure_signatures）
 * 2. 查询 active policy
 * 3. 记录审计（policy_evaluations）
 * 4. 判断晋升条件
 *
 * 核心原则：
 * - Simulate First（probation 默认模拟）
 * - 可审计（每次执行都写 evaluation）
 * - 可回滚（规则有 rollback_json）
 */

import pool from './db.js';

/**
 * Update failure signature counts
 *
 * @param {string} signature - Error signature (16-char hex)
 * @param {Object} failure - Failure object from run_events
 * @param {string} failure.run_id - Run ID
 * @param {string} failure.reason_code - Error code
 * @param {string} failure.layer - Execution layer
 * @param {string} failure.step_name - Step where error occurred
 * @returns {Promise<Object>} Updated signature record
 */
export async function updateFailureSignature(signature, failure) {
  try {
    const query = `
      INSERT INTO failure_signatures (
        signature,
        first_seen_at,
        last_seen_at,
        count_24h,
        count_7d,
        count_total,
        latest_run_id,
        latest_reason_code,
        latest_layer,
        latest_step_name
      ) VALUES ($1, NOW(), NOW(), 1, 1, 1, $2, $3, $4, $5)
      ON CONFLICT (signature) DO UPDATE SET
        last_seen_at = NOW(),
        count_24h = CASE
          WHEN failure_signatures.last_seen_at > NOW() - INTERVAL '24 hours'
          THEN failure_signatures.count_24h + 1
          ELSE 1
        END,
        count_7d = CASE
          WHEN failure_signatures.last_seen_at > NOW() - INTERVAL '7 days'
          THEN failure_signatures.count_7d + 1
          ELSE 1
        END,
        count_total = failure_signatures.count_total + 1,
        latest_run_id = $2,
        latest_reason_code = $3,
        latest_layer = $4,
        latest_step_name = $5
      RETURNING *
    `;

    const result = await pool.query(query, [
      signature,
      failure.run_id || null,
      failure.reason_code || 'UNKNOWN',
      failure.layer || '',
      failure.step_name || ''
    ]);

    return result.rows[0];
  } catch (error) {
    console.error('[Immune] Failed to update failure signature:', error.message);
    throw error;
  }
}

/**
 * Find active policy for a given signature
 *
 * @param {string} signature - Error signature
 * @returns {Promise<Object|null>} Active policy or null
 */
export async function findActivePolicy(signature) {
  try {
    const query = `
      SELECT *
      FROM absorption_policies
      WHERE signature = $1
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [signature]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[Immune] Failed to find active policy:', error.message);
    throw error;
  }
}

/**
 * Find probation policy for a given signature
 *
 * @param {string} signature - Error signature
 * @returns {Promise<Object|null>} Probation policy or null
 */
export async function findProbationPolicy(signature) {
  try {
    const query = `
      SELECT *
      FROM absorption_policies
      WHERE signature = $1
        AND status = 'probation'
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [signature]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[Immune] Failed to find probation policy:', error.message);
    throw error;
  }
}

/**
 * Record policy evaluation (audit trail)
 *
 * @param {Object} evaluation - Evaluation record
 * @param {string} evaluation.policy_id - Policy UUID
 * @param {string} evaluation.run_id - Run UUID (optional)
 * @param {string} evaluation.signature - Error signature
 * @param {string} evaluation.mode - 'simulate' or 'enforce'
 * @param {string} evaluation.decision - 'applied', 'skipped', or 'failed'
 * @param {string} evaluation.verification_result - 'pass', 'fail', or 'unknown'
 * @param {number} evaluation.latency_ms - Execution time
 * @param {Object} evaluation.details - Additional details (JSON)
 * @returns {Promise<string>} Evaluation ID
 */
export async function recordPolicyEvaluation(evaluation) {
  try {
    const query = `
      INSERT INTO policy_evaluations (
        policy_id,
        run_id,
        signature,
        mode,
        decision,
        verification_result,
        latency_ms,
        details,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING evaluation_id
    `;

    const result = await pool.query(query, [
      evaluation.policy_id,
      evaluation.run_id || null,
      evaluation.signature,
      evaluation.mode,
      evaluation.decision,
      evaluation.verification_result || 'unknown',
      evaluation.latency_ms || null,
      evaluation.details ? JSON.stringify(evaluation.details) : null
    ]);

    return result.rows[0].evaluation_id;
  } catch (error) {
    console.error('[Immune] Failed to record policy evaluation:', error.message);
    throw error;
  }
}

/**
 * Check if signature should be promoted to probation
 *
 * Promotion criteria (稳健版):
 * - draft → probation: 同签名 24h 内 ≥2次 or 7d 内 ≥3次
 *
 * @param {string} signature - Error signature
 * @returns {Promise<boolean>} Should promote
 */
export async function shouldPromoteToProbation(signature) {
  try {
    const query = `
      SELECT count_24h, count_7d
      FROM failure_signatures
      WHERE signature = $1
    `;

    const result = await pool.query(query, [signature]);

    if (result.rows.length === 0) {
      return false;
    }

    const { count_24h, count_7d } = result.rows[0];

    // 稳健晋升条件
    if (count_24h >= 2 || count_7d >= 3) {
      console.log(`[Immune] Signature ${signature} meets promotion criteria: 24h=${count_24h}, 7d=${count_7d}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[Immune] Failed to check promotion criteria:', error.message);
    throw error;
  }
}

/**
 * Get policy evaluation statistics
 *
 * @param {string} policyId - Policy UUID
 * @returns {Promise<Object>} Stats
 */
export async function getPolicyEvaluationStats(policyId) {
  try {
    const query = `
      SELECT
        COUNT(*) AS total_evaluations,
        COUNT(*) FILTER (WHERE mode = 'simulate') AS simulations,
        COUNT(*) FILTER (WHERE mode = 'enforce') AS enforcements,
        COUNT(*) FILTER (WHERE decision = 'applied') AS applied,
        COUNT(*) FILTER (WHERE decision = 'failed') AS failed,
        COUNT(*) FILTER (WHERE verification_result = 'pass') AS verified_pass,
        COUNT(*) FILTER (WHERE verification_result = 'fail') AS verified_fail,
        ROUND(
          COUNT(*) FILTER (WHERE verification_result = 'pass')::numeric * 100 /
          NULLIF(COUNT(*) FILTER (WHERE verification_result IN ('pass', 'fail')), 0),
          1
        ) AS success_rate
      FROM policy_evaluations
      WHERE policy_id = $1
    `;

    const result = await pool.query(query, [policyId]);
    return result.rows[0];
  } catch (error) {
    console.error('[Immune] Failed to get policy stats:', error.message);
    throw error;
  }
}

/**
 * Check if policy should be promoted from probation to active
 *
 * Promotion criteria (稳健版):
 * - probation → active: 模拟命中 ≥2次 且 验证成功率 ≥90%
 *
 * @param {string} policyId - Policy UUID
 * @returns {Promise<boolean>} Should promote
 */
export async function shouldPromoteToActive(policyId) {
  try {
    const stats = await getPolicyEvaluationStats(policyId);

    if (!stats) {
      return false;
    }

    const { simulations, verified_pass, verified_fail, success_rate } = stats;

    // 稳健晋升条件
    if (simulations >= 2 && (verified_pass + verified_fail) >= 2 && success_rate >= 90) {
      console.log(`[Immune] Policy ${policyId} meets active promotion criteria: simulations=${simulations}, success_rate=${success_rate}%`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[Immune] Failed to check active promotion:', error.message);
    throw error;
  }
}

/**
 * Get failure signature statistics
 *
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} Top failure signatures
 */
export async function getTopFailureSignatures(limit = 10) {
  try {
    const query = `
      SELECT
        signature,
        latest_reason_code,
        latest_layer,
        latest_step_name,
        count_24h,
        count_7d,
        count_total,
        last_seen_at
      FROM failure_signatures
      ORDER BY count_24h DESC, count_7d DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    return result.rows;
  } catch (error) {
    console.error('[Immune] Failed to get top signatures:', error.message);
    throw error;
  }
}

/**
 * Parse policy_json to extract intended action (P1)
 *
 * Used by probation simulate to record what the policy would do
 *
 * @param {Object} policyJson - JSON from absorption_policies.policy_json
 * @returns {Object} { type, params, expected_outcome }
 *
 * @example
 * // Input policy_json:
 * // {
 * //   "action": "requeue",
 * //   "params": { "delay_minutes": 30, "priority": "low" },
 * //   "expected_outcome": "Task will retry after 30 min with lower priority"
 * // }
 * //
 * // Output:
 * // {
 * //   type: "requeue",
 * //   params: { delay_minutes: 30, priority: "low" },
 * //   expected_outcome: "Task will retry after 30 min with lower priority"
 * // }
 */
export function parsePolicyAction(policyJson) {
  try {
    // Handle null/undefined
    if (!policyJson) {
      return {
        type: 'unknown',
        params: {},
        expected_outcome: 'No policy JSON provided'
      };
    }

    // Parse if string
    const parsed = typeof policyJson === 'string' ? JSON.parse(policyJson) : policyJson;

    // Extract action details with defaults
    return {
      type: parsed.action || 'unknown',
      params: parsed.params || {},
      expected_outcome: parsed.expected_outcome || 'No expected outcome defined'
    };
  } catch (error) {
    console.error('[Immune] Failed to parse policy_json:', error.message);
    // Return safe default instead of throwing
    return {
      type: 'parse_error',
      params: {},
      expected_outcome: `Failed to parse policy JSON: ${error.message}`
    };
  }
}
