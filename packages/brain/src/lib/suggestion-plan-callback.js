/** Identify the explicit /plan business failure without guessing from prose. */
export function suggestionPlanFailure(task, result) {
  if (task?.task_type !== 'suggestion_plan' || !task.payload?.suggestion_id) return null;
  let value = result && typeof result === 'object' && '_raw' in result ? result._raw : result;
  if (typeof value === 'string') {
    let text = value.trim();
    if (text.startsWith('```')) {
      const newline = text.indexOf('\n');
      if (newline < 0 || !text.endsWith('\n```')) return null;
      const language = text.slice(3, newline).trim().toLowerCase();
      if (language && language !== 'json') return null;
      text = text.slice(newline + 1, -4);
    }
    try { value = JSON.parse(text); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.status !== 'failed' || value.identified_layer !== 'unknown'
      || String(value.suggestion_id) !== String(task.payload.suggestion_id)) return null;
  return { suggestionId: String(value.suggestion_id) };
}

/** Preserve a concurrent human decision and leave a visible conflict on the task. */
export async function recordSuggestionPlanFailure(client, taskId, suggestionId, runId, originalStatus) {
  const updated = await client.query(
    "UPDATE suggestions SET status = 'failed', updated_at = NOW() WHERE id = $1 AND status = 'in_progress' RETURNING id",
    [suggestionId],
  );
  const changed = (updated.rowCount ?? updated.rows?.length ?? 0) === 1;
  await client.query(
    `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [taskId, JSON.stringify({ suggestion_plan_resolution: { suggestion_id: suggestionId,
      status: changed ? 'failed' : 'conflict_or_missing', run_id: runId || null, original_status: originalStatus } })],
  );
  return changed;
}

export async function hasCommittedSuggestionPlanFailure(pool, taskId, runId, originalStatus, suggestionId) {
  if (!runId) return false;
  const result = await pool.query(`SELECT 1 FROM tasks WHERE id = $1 AND status = 'failed'
    AND result->'suggestion_plan_resolution'->>'run_id' = $2
    AND result->'suggestion_plan_resolution'->>'original_status' = $3
    AND result->'suggestion_plan_resolution'->>'suggestion_id' = $4`,
  [taskId, String(runId), String(originalStatus), suggestionId]);
  return result.rows.length === 1;
}
import { recordRunFromCallback } from './task-run.js';


/** Finalize a run only through the single writer, and verify its owner and state. */
export async function reconcileSuggestionPlanRun(pool, callback, { emit } = {}) {
  if (!callback.runId) return { status: 'no_run_id' };
  let ownershipConflict = false;
  try {
    await recordRunFromCallback({ ...callback, status: 'AI Failed', error: 'suggestion_plan_insufficient_information' },
      { pool, requireTaskOwner: true, strict: true, ...(emit ? { emit } : {}) });
  } catch (error) {
    if (error.message !== 'task run ownership conflict') throw error;
    ownershipConflict = true;
  }
  const rows = await pool.query('SELECT task_id, status FROM task_runs WHERE run_id = $1', [String(callback.runId)]);
  const row = rows.rows[0];
  if (!ownershipConflict && row && String(row.task_id) === String(callback.taskId) && row.status === 'failed') {
    return { status: 'recorded' };
  }
  await pool.query(`UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [callback.taskId, JSON.stringify({ suggestion_plan_run_resolution: { status: 'conflict_or_missing', run_id: String(callback.runId) } })]);
  return { status: 'conflict_or_missing' };
}
