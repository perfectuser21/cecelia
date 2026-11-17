import pool from './db.js';

/**
 * Fetch task metadata (title, type, description head) from tasks table.
 * Uses parameterized query ($1) — pool.query is pg's built-in safe parameterization.
 * @param {string} taskId
 * @returns {Promise<{task_title?, task_type?, task_description_head?}>}
 */
async function fetchTaskMeta(taskId) {
  try {
    const result = await pool.query(
      `SELECT title, task_type, LEFT(description, 500) AS description_head
       FROM tasks WHERE id = $1 LIMIT 1`,
      [taskId]
    );
    if (result.rows.length === 0) return {};
    const t = result.rows[0];
    return { task_title: t.title, task_type: t.task_type, task_description_head: t.description_head };
  } catch (err) {
    console.warn(`[Monitor] fetchTaskMeta failed for task ${taskId}: ${err.message}`);
    return {};
  }
}

/**
 * Fetch stderr / log_tail from the most recent failed run_events payload.
 * Uses parameterized query ($1) — pool.query is pg's built-in safe parameterization.
 * @param {string} runId
 * @returns {Promise<{stderr?: string, log_tail?: string}>}
 */
async function fetchRunPayload(runId) {
  try {
    const result = await pool.query(
      `SELECT payload FROM run_events
       WHERE run_id = $1 AND status = 'failed'
       ORDER BY ts_end DESC NULLS LAST LIMIT 1`,
      [runId]
    );
    if (result.rows.length === 0) return {};
    const payload = result.rows[0].payload;
    if (!payload || typeof payload !== 'object') return {};
    return {
      stderr: (payload.stderr || payload.error || '').toString().slice(-2000),
      log_tail: (payload.log_tail || payload.output || '').toString().slice(-1000),
    };
  } catch (err) {
    console.warn(`[Monitor] fetchRunPayload failed for run ${runId}: ${err.message}`);
    return {};
  }
}

/**
 * Count recent similar failures by reason_code in the last 24h.
 * Uses parameterized query ($1) — pool.query is pg's built-in safe parameterization.
 * @param {string} reasonCode
 * @returns {Promise<{count: number, affected_steps: string[]}>}
 */
async function fetchSimilarFailures(reasonCode) {
  try {
    const result = await pool.query(
      `SELECT count(*) AS cnt, array_agg(DISTINCT step_name) AS steps
       FROM run_events
       WHERE reason_code = $1 AND status = 'failed'
         AND ts_start > NOW() - INTERVAL '24 hours'`,
      [reasonCode]
    );
    if (result.rows.length === 0) return { count: 0, affected_steps: [] };
    return {
      count: parseInt(result.rows[0].cnt) || 0,
      affected_steps: result.rows[0].steps || [],
    };
  } catch (err) {
    console.warn(`[Monitor] fetchSimilarFailures failed for reason_code ${reasonCode}: ${err.message}`);
    return { count: 0, affected_steps: [] };
  }
}

/**
 * Gather rich failure context from run_events and tasks tables
 * so Cortex can produce high-confidence RCA diagnoses.
 *
 * @param {Object} failure - row from run_events (must have task_id, run_id)
 * @returns {Promise<Object>} enriched context object
 */
async function gatherFailureContext(failure) {
  const ctx = {
    reason_code: failure.reason_code || 'UNKNOWN',
    reason_kind: failure.reason_kind || 'UNKNOWN',
    layer: failure.layer || 'N/A',
    step_name: failure.step_name || 'N/A',
    run_id: failure.run_id || null,
    task_id: failure.task_id || null,
    ts_start: failure.ts_start || null,
    ts_end: failure.ts_end || null,
    stderr: null,
    log_tail: null,
    task_title: null,
    task_type: null,
    task_description_head: null,
    recent_similar_failures: [],
  };

  try {
    if (failure.task_id) {
      Object.assign(ctx, await fetchTaskMeta(failure.task_id));
    }
    if (failure.run_id) {
      Object.assign(ctx, await fetchRunPayload(failure.run_id));
    }
    if (failure.reason_code) {
      ctx.recent_similar_failures = await fetchSimilarFailures(failure.reason_code);
    }
  } catch (err) {
    console.warn(`[Monitor] gatherFailureContext partial failure: ${err.message}`);
  }

  return ctx;
}

/**
 * Call Cortex for RCA (Root Cause Analysis)
 *
 * @param {Object} failure - Failure object from run_events
 * @returns {Promise<Object>} RCA result with structured fields
 */
export async function callCortexForRca(failure) {
  const { performRCA } = await import('./cortex.js');

  try {
    // Gather rich context from DB (not just 5 fields)
    const failureContext = await gatherFailureContext(failure);

    // Prepare task data with full context for performRCA
    const failedTask = {
      id: failure.task_id,
      task_type: failureContext.task_type || 'dev',
      reason_code: failureContext.reason_code,
      reason_kind: failureContext.reason_kind,
      layer: failureContext.layer,
      step_name: failureContext.step_name,
      // Rich context fields (new)
      title: failureContext.task_title,
      stderr: failureContext.stderr,
      log_tail: failureContext.log_tail,
      description_head: failureContext.task_description_head,
      recent_similar: failureContext.recent_similar_failures,
      run_id: failureContext.run_id,
      ts_start: failureContext.ts_start,
      ts_end: failureContext.ts_end,
    };

    // Build failure history with classification for Cortex
    const history = failureContext.recent_similar_failures?.count > 1
      ? [{ failure_classification: { class: failureContext.reason_code } }]
      : [];

    // Call performRCA with enriched data
    const response = await performRCA(failedTask, history);

    // Extract structured result from response
    if (response && response.analysis) {
      // Try to extract JSON from markdown code block
      const jsonMatch = response.analysis.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const rcaResult = JSON.parse(jsonMatch[1]);
        return {
          root_cause: rcaResult.root_cause || response.analysis,
          proposed_fix: rcaResult.proposed_fix || 'See analysis',
          action_plan: rcaResult.action_plan || '',
          confidence: rcaResult.confidence || 0.5,
          evidence: rcaResult.evidence || ''
        };
      }

      // Fallback: plain text response
      return {
        root_cause: response.analysis.substring(0, 500),
        proposed_fix: 'Manual review needed',
        action_plan: '',
        confidence: 0.3,
        evidence: ''
      };
    }

    // No valid response
    return {
      root_cause: 'RCA returned no analysis',
      proposed_fix: 'Retry with more context',
      action_plan: '',
      confidence: 0,
      evidence: ''
    };

  } catch (error) {
    console.error('[Monitor] Cortex RCA call failed:', error.message);
    return {
      root_cause: `Cortex invocation failed: ${error.message}`,
      proposed_fix: 'Check Cortex configuration',
      action_plan: '',
      confidence: 0,
      evidence: ''
    };
  }
}
