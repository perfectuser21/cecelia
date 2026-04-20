/**
 * packages/brain/src/execution.js
 * Harness execution module: pipeline lifecycle management.
 *
 * WS1: verdict retry + bridge crash detection.
 * WS2: harness_cleanup handler — pipeline artifact cleanup (worktree + remote branch + /tmp).
 */

import { execSync } from 'child_process';

// ── WS1: Verdict Retry + Bridge Crash Detection ──────────────────────────────

const MAX_VERDICT_RETRIES = 10;
const _VERDICT_RETRY_INTERVAL_MS = 200;

/**
 * readVerdictWithRetry — poll DB for verdict with up to MAX_VERDICT_RETRIES retries.
 * Each retry waits VERDICT_RETRY_INTERVAL_MS (200ms). Total wait ≤ 2s.
 *
 * @param {object} pool - pg pool
 * @param {string} taskId
 * @returns {Promise<{ verdict: string|null, timedOut: boolean }>}
 */
export async function readVerdictWithRetry(pool, taskId) {
  let retryCount = 0;
  while (retryCount < MAX_VERDICT_RETRIES) {
    try {
      const dbResult = await pool.query('SELECT result FROM tasks WHERE id = $1', [taskId]);
      const dbVerdict = dbResult.rows[0]?.result?.verdict?.toUpperCase();
      if (dbVerdict === 'PASS' || dbVerdict === 'FAIL') {
        return { verdict: dbVerdict, timedOut: false };
      }
    } catch (_err) {
      // ignore transient DB errors, continue retrying
    }
    await new Promise(resolve => setTimeout(resolve, 200)); // VERDICT_RETRY_INTERVAL_MS
    retryCount++;
  }
  return { verdict: null, timedOut: true };
}

/**
 * persistVerdictTimeout — record verdict_timeout alert on the task.
 * Does NOT trigger fix tasks. Does NOT set verdict to FAIL.
 *
 * @param {object} pool
 * @param {string} taskId
 */
export async function persistVerdictTimeout(pool, taskId) {
  try {
    await pool.query(
      `UPDATE tasks SET
        metadata = jsonb_set(COALESCE(metadata, '{}'), '{verdict_timeout}', 'true'),
        updated_at = NOW()
       WHERE id = $1`,
      [taskId],
    );
  } catch (_err) {
    // non-blocking alert only
  }
}

/**
 * isBridgeSessionCrash — returns true when bridge output is 0 bytes (session silently crashed).
 *
 * @param {*} result - callback result from bridge
 * @returns {boolean}
 */
export function isBridgeSessionCrash(result) {
  return result === null || result === undefined || result === '' || result === 0;
}

/**
 * handleEvaluateSessionCrash — bridge crash recovery.
 *
 * First crash  → mark session_crashed, create harness_evaluate retry task.
 * Second crash → mark permanent_failure, write error_message, no further tasks.
 *
 * @param {object} opts
 * @param {object} opts.pool
 * @param {string} opts.taskId
 * @param {string} opts.plannerShort
 * @param {object} opts.harnessTask
 * @param {object} opts.harnessPayload
 * @param {Function} opts.createHarnessTask
 * @returns {Promise<{ action: string }>}
 */
export async function handleEvaluateSessionCrash({ pool, taskId, plannerShort, _harnessTask, harnessPayload, createHarnessTask }) {
  let crashCount = 0;
  try {
    const meta = await pool.query('SELECT metadata FROM tasks WHERE id = $1', [taskId]);
    crashCount = meta.rows[0]?.metadata?.session_crash_count || 0;
  } catch (_err) { /* ignore */ }

  if (crashCount >= 1) {
    // Second crash → permanent_failure: terminate pipeline, write error_message, no new tasks
    const error_message = `Bridge session crashed ${crashCount + 1} times — pipeline terminated (permanent_failure).`;
    try {
      await pool.query(
        `UPDATE tasks SET
          metadata = jsonb_set(COALESCE(metadata, '{}'), '{permanent_failure}', 'true'),
          error_message = $2,
          updated_at = NOW()
         WHERE id = $1`,
        [taskId, error_message],
      );
    } catch (_err) { /* non-blocking */ }
    return { action: 'permanent_failure' };
  }

  // First crash → session_crashed: create harness_evaluate retry (not harness_fix)
  try {
    await pool.query(
      `UPDATE tasks SET
        metadata = jsonb_set(
          jsonb_set(COALESCE(metadata, '{}'), '{session_crashed}', 'true'),
          '{session_crash_count}', $2::text::jsonb
        ),
        updated_at = NOW()
       WHERE id = $1`,
      [taskId, JSON.stringify(crashCount + 1)],
    );
  } catch (_err) { /* non-blocking */ }

  try {
    await createHarnessTask({
      task_type: 'harness_evaluate',
      title: `[Re-Evaluate] session_crashed retry — ${plannerShort}`,
      payload: {
        ...harnessPayload,
        retry_reason: 'session_crashed',
        eval_round: (harnessPayload?.eval_round || 0) + 1,
      },
    });
  } catch (_err) { /* non-blocking */ }

  return { action: 'session_crashed' };
}

// ── harness_cleanup Task Type ──────────────────────────────────────────────

export const HARNESS_CLEANUP_TASK_TYPE = 'harness_cleanup';

/**
 * executeHarnessCleanup — handler for harness_cleanup task type.
 *
 * Cleans up three artifact categories after pipeline completion:
 *   1. Worktree directory  — git worktree remove --force
 *   2. Remote branch       — git push origin --delete
 *   3. /tmp/cecelia-* temp files — rm -rf
 *
 * Each step runs independently; failures are collected but do not abort cleanup.
 *
 * @param {object} opts
 * @param {string} [opts.branch]       - Remote branch name to delete
 * @param {string} [opts.worktreePath] - Local worktree path to remove
 * @returns {Promise<{ cleaned: boolean, errors: string[] }>}
 */
export async function executeHarnessCleanup(opts = {}) {
  const { branch, worktreePath } = opts;
  const errors = [];

  // 1. Worktree cleanup: git worktree remove --force
  if (worktreePath) {
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { stdio: 'pipe' });
    } catch (err) {
      errors.push(`worktree remove failed: ${err.message}`);
    }
  }

  // 2. Remote branch deletion: git push origin --delete
  if (branch) {
    try {
      execSync(`git push origin --delete "${branch}"`, { stdio: 'pipe' });
    } catch (err) {
      errors.push(`remote branch delete failed: ${err.message}`);
    }
  }

  // 3. /tmp/cecelia-* temp files cleanup
  try {
    execSync('rm -rf /tmp/cecelia-* 2>/dev/null || true', { shell: true, stdio: 'pipe' });
  } catch (err) {
    errors.push(`/tmp/cecelia cleanup failed: ${err.message}`);
  }

  return { cleaned: true, errors };
}
