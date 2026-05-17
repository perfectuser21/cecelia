/**
 * Promotion Job (P1)
 *
 * 职责：
 * 1. 自动晋升 probation → active（满足条件）
 * 2. 自动禁用 probation/active → disabled（失败/过期）
 * 3. 每日晋升上限（硬护栏：3 条/天）
 *
 * 晋升规则：
 * - probation → active: simulate ≥ 2, pass rate ≥ 90%, risk_level = low
 * - active → disabled: verification fail ≥ 1
 * - probation → disabled: verification fail ≥ 2 OR 超过 7 天未晋升
 *
 * 运行频率：每 10 分钟
 */

import pool from './db.js';

// Hard limit: max promotions per day
const MAX_PROMOTIONS_PER_DAY = 3;

// Track interval handle for cleanup
let _promotionJobInterval = null;

/**
 * Run promotion job - promote probation to active, disable failed policies
 *
 * @returns {Promise<Object>} { promoted, disabled, reason }
 */
export async function runPromotionJob() {
  console.log('[PromotionJob] Starting promotion job...');

  try {
    // 1. Check daily promotion limit
    const promotedToday = await countPromotionsToday();
    const remainingSlots = MAX_PROMOTIONS_PER_DAY - promotedToday;

    console.log(`[PromotionJob] Daily promotions: ${promotedToday}/${MAX_PROMOTIONS_PER_DAY}, remaining: ${remainingSlots}`);

    if (remainingSlots <= 0) {
      console.log('[PromotionJob] Daily promotion limit reached, skipping promotion');
      // Still run disable logic
    }

    // 2. Find candidates for promotion (probation → active)
    const candidates = remainingSlots > 0 ? await findPromotionCandidates(remainingSlots) : [];
    console.log(`[PromotionJob] Found ${candidates.length} promotion candidates`);

    // 3. Promote qualifying policies
    let promoted = 0;
    for (const candidate of candidates) {
      const success = await promoteToActive(candidate);
      if (success) promoted++;
    }

    // 4. Find policies to disable
    const toDisable = await findPoliciesToDisable();
    console.log(`[PromotionJob] Found ${toDisable.length} policies to disable`);

    // 5. Disable failed policies
    let disabled = 0;
    for (const policy of toDisable) {
      const success = await disablePolicy(policy);
      if (success) disabled++;
    }

    const result = {
      promoted,
      disabled,
      remaining_slots: MAX_PROMOTIONS_PER_DAY - (promotedToday + promoted)
    };

    console.log(`[PromotionJob] Completed: promoted=${promoted}, disabled=${disabled}, remaining_slots=${result.remaining_slots}`);
    return result;
  } catch (error) {
    console.error('[PromotionJob] Error:', error);
    throw error;
  }
}

/**
 * Count promotions today (for rate limiting)
 *
 * @returns {Promise<number>} Number of promotions in last 24 hours
 */
export async function countPromotionsToday() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM policy_evaluations
      WHERE mode = 'promote'
        AND decision = 'applied'
        AND created_at >= NOW() - INTERVAL '24 hours'
    `);
    return parseInt(result.rows[0]?.count || 0);
  } catch (error) {
    console.error('[PromotionJob] Failed to count promotions:', error.message);
    throw error;
  }
}

/**
 * Find probation policies ready for promotion
 *
 * Criteria:
 * - status = 'probation'
 * - simulate_count >= 2
 * - pass_count / (pass_count + fail_count) >= 0.9
 * - risk_level = 'low'
 * - fail_count < 2 (not in disable zone)
 *
 * @param {number} limit - Maximum number of candidates
 * @returns {Promise<Array>} Promotion candidates
 */
export async function findPromotionCandidates(limit) {
  try {
    const result = await pool.query(`
      WITH policy_stats AS (
        SELECT
          pe.policy_id,
          ap.signature,
          ap.risk_level,
          ap.policy_json,
          COUNT(*) FILTER (WHERE pe.mode = 'simulate')::INTEGER as simulate_count,
          COUNT(*) FILTER (WHERE pe.verification_result = 'pass')::INTEGER as pass_count,
          COUNT(*) FILTER (WHERE pe.verification_result = 'fail')::INTEGER as fail_count
        FROM policy_evaluations pe
        JOIN absorption_policies ap ON ap.policy_id = pe.policy_id
        WHERE ap.status = 'probation'
          AND pe.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY pe.policy_id, ap.signature, ap.risk_level, ap.policy_json
      )
      SELECT *
      FROM policy_stats
      WHERE simulate_count >= 2
        AND risk_level = 'low'
        AND (pass_count + fail_count) > 0  -- At least one verification
        AND (pass_count::float / (pass_count + fail_count)) >= 0.9
        AND fail_count < 2  -- Not in disable zone
      ORDER BY simulate_count DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  } catch (error) {
    console.error('[PromotionJob] Failed to find candidates:', error.message);
    throw error;
  }
}

/**
 * Promote policy to active
 *
 * @param {Object} candidate - Policy candidate
 * @returns {Promise<boolean>} Success status
 */
export async function promoteToActive(candidate) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update policy status
    await client.query(`
      UPDATE absorption_policies
      SET status = 'active',
          updated_at = NOW()
      WHERE policy_id = $1
    `, [candidate.policy_id]);

    // Record promotion event
    await client.query(`
      INSERT INTO policy_evaluations (
        policy_id, signature, mode, decision, details, created_at
      ) VALUES ($1, $2, 'promote', 'applied', $3, NOW())
    `, [
      candidate.policy_id,
      candidate.signature,
      JSON.stringify({
        simulate_count: candidate.simulate_count,
        pass_count: candidate.pass_count,
        fail_count: candidate.fail_count,
        success_rate: candidate.pass_count / (candidate.pass_count + candidate.fail_count),
        promoted_at: new Date().toISOString()
      })
    ]);

    await client.query('COMMIT');
    console.log(`[PromotionJob] Promoted policy ${candidate.policy_id} to active (simulate=${candidate.simulate_count}, success_rate=${(candidate.pass_count / (candidate.pass_count + candidate.fail_count) * 100).toFixed(1)}%)`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[PromotionJob] Failed to promote ${candidate.policy_id}:`, error.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * Find policies to disable (probation or active with failures)
 *
 * Disable criteria:
 * - Active: verification fail >= 1
 * - Probation: verification fail >= 2
 * - Probation: created > 7 days ago (stale)
 *
 * @returns {Promise<Array>} Policies to disable
 */
export async function findPoliciesToDisable() {
  try {
    const result = await pool.query(`
      WITH recent_failures AS (
        SELECT
          pe.policy_id,
          ap.status,
          ap.signature,
          ap.created_at as policy_created,
          COUNT(*) FILTER (WHERE pe.verification_result = 'fail')::INTEGER as fail_count,
          COUNT(*) FILTER (WHERE pe.decision = 'failed')::INTEGER as consecutive_fails,
          MAX(pe.created_at) as last_evaluation
        FROM policy_evaluations pe
        JOIN absorption_policies ap ON ap.policy_id = pe.policy_id
        WHERE ap.status IN ('probation', 'active')
          AND pe.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY pe.policy_id, ap.status, ap.signature, ap.created_at
      ),
      stale_probation AS (
        SELECT
          ap.policy_id,
          ap.status,
          ap.signature,
          ap.created_at as policy_created,
          0 as fail_count,
          0 as consecutive_fails,
          NULL::TIMESTAMP as last_evaluation
        FROM absorption_policies ap
        WHERE ap.status = 'probation'
          AND ap.created_at < NOW() - INTERVAL '7 days'
          AND NOT EXISTS (
            SELECT 1 FROM policy_evaluations pe
            WHERE pe.policy_id = ap.policy_id
          )
      )
      SELECT * FROM recent_failures
      WHERE
        -- Active policy: fail once = disable
        (status = 'active' AND fail_count >= 1)
        -- Probation: fail twice = disable
        OR (status = 'probation' AND fail_count >= 2)
        -- Probation stale: 7 days without promotion
        OR (status = 'probation' AND policy_created < NOW() - INTERVAL '7 days')
        -- Consecutive failures
        OR (consecutive_fails >= 2)

      UNION

      SELECT * FROM stale_probation
    `);

    return result.rows;
  } catch (error) {
    console.error('[PromotionJob] Failed to find policies to disable:', error.message);
    throw error;
  }
}

/**
 * Disable policy
 *
 * @param {Object} policy - Policy to disable
 * @returns {Promise<boolean>} Success status
 */
export async function disablePolicy(policy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update policy status
    await client.query(`
      UPDATE absorption_policies
      SET status = 'disabled',
          updated_at = NOW()
      WHERE policy_id = $1
    `, [policy.policy_id]);

    // Determine disable reason
    let reason;
    if (policy.status === 'active' && policy.fail_count >= 1) {
      reason = 'active_verification_failed';
    } else if (policy.status === 'probation' && policy.fail_count >= 2) {
      reason = 'probation_multiple_failures';
    } else if (policy.status === 'probation' && policy.policy_created < Date.now() - 7 * 24 * 60 * 60 * 1000) {
      reason = 'probation_stale';
    } else {
      reason = 'consecutive_failures';
    }

    // Record disable event
    await client.query(`
      INSERT INTO policy_evaluations (
        policy_id, signature, mode, decision, details, created_at
      ) VALUES ($1, $2, 'disable', 'applied', $3, NOW())
    `, [
      policy.policy_id,
      policy.signature,
      JSON.stringify({
        reason,
        status: policy.status,
        fail_count: policy.fail_count,
        consecutive_fails: policy.consecutive_fails,
        disabled_at: new Date().toISOString()
      })
    ]);

    await client.query('COMMIT');
    console.log(`[PromotionJob] Disabled policy ${policy.policy_id} (reason: ${reason}, status: ${policy.status})`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[PromotionJob] Failed to disable ${policy.policy_id}:`, error.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * Start promotion job loop (runs every 10 minutes)
 */
export function startPromotionJobLoop() {
  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  console.log('[PromotionJob] Starting promotion job loop (every 10 min)');

  // Run immediately on startup
  runPromotionJob().catch(err => {
    console.error('[PromotionJob] Initial run failed:', err);
  });

  // Then run every 10 minutes
  _promotionJobInterval = setInterval(() => {
    runPromotionJob().catch(err => {
      console.error('[PromotionJob] Scheduled run failed:', err);
    });
  }, INTERVAL_MS);
}

/**
 * Stop promotion job loop (cleanup interval)
 */
export function stopPromotionJob() {
  if (_promotionJobInterval) {
    clearInterval(_promotionJobInterval);
    _promotionJobInterval = null;
    console.log('[PromotionJob] Stopped promotion job loop');
  }
}
