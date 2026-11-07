export function decompReviewInputError(task, runId, result) {
  if (!runId) return 'decomp_review run_id missing';
  if (task?.payload?.postdeploy_check?.command && task.payload.postdeploy_check.exempt !== true) {
    return 'decomp_review postdeploy check unsupported';
  }
  if (!decompReviewVerdict(result)) return 'decomp_review verdict missing or invalid';
  return null;
}

export function decompReviewVerdict(result) {
  if (result === null || typeof result !== 'object') return null;
  const raw = result.verdict ?? result.result?.verdict;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  return ['approved', 'needs_revision', 'rejected'].includes(normalized) ? normalized : null;
}

export async function applyDecompReview(client, taskId, result, task) {
  const verdict = decompReviewVerdict(result);
  if (!verdict) {
    const error = new Error('decomp_review verdict missing or invalid');
    error.code = 'DECOMP_REVIEW_VERDICT_INVALID';
    throw error;
  }
  const findings = result.findings || result.result?.findings || result;
  const { processReviewResult } = await import('../review-gate.js');
  if (!await processReviewResult(client, taskId, verdict, findings)) {
    throw new Error('decomp_review record missing or ambiguous');
  }
  if (verdict === 'approved' && findings?.plan_adjustment && task?.payload?.review_scope === 'plan_adjustment') {
    const { executePlanAdjustment } = await import('../progress-reviewer.js');
    await executePlanAdjustment(client, findings, task.payload?.plan_context);
  }
}

export async function recordVerifiedDecompRun(pool, callback) {
  try {
    const before = await pool.query('SELECT task_id, status FROM task_runs WHERE run_id = $1', [String(callback.runId)]);
    if (before.rows.length > 1 || (before.rows[0] && String(before.rows[0].task_id) !== String(callback.taskId))) {
      throw new Error('decomp_review run ownership conflict');
    }
    const { recordRunFromCallback } = await import('./task-run.js');
    const { default: defaultPool } = await import('../db.js');
    // 自定义隔离池不能写全局事件库，也不能触发生产订阅者。
    const emit = pool === defaultPool ? undefined : async () => {};
    await recordRunFromCallback(callback, { pool, requireTaskOwner: true, ...(emit ? { emit } : {}) });
    const checked = await pool.query('SELECT task_id, status FROM task_runs WHERE run_id = $1', [String(callback.runId)]);
    if (checked.rows.length !== 1 || String(checked.rows[0].task_id) !== String(callback.taskId) || checked.rows[0].status !== 'success') {
      throw new Error('decomp_review run ledger not confirmed');
    }
  } catch (cause) {
    const error = new Error('decomp_review run ledger verification failed', { cause });
    error.code = 'DECOMP_REVIEW_RUN_LEDGER_UNAVAILABLE';
    throw error;
  }
}
