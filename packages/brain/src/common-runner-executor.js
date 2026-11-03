import { createCommonRunnerDispatcher } from './lib/common-runner-dispatch.js';
import { finalizeTask as finalizeCentralTask } from './lib/task-terminal.js';
import { blockCommonRunnerForReview } from './lib/common-runner-review.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const running = new WeakSet();
const reapCursors = new WeakMap();
const SAFE_TASK = `kind='agent' AND COALESCE(payload->>'headed_manual','false')<>'true'
  AND NOT COALESCE(payload ? 'headed_takeover',false)
  AND COALESCE(payload->>'commander_protocol','')<>'commander-v2'
  AND jsonb_typeof(payload->'common_runner')='object'`;
const safeTask = task => task.kind === 'agent' && ![true, 'true'].includes(task.payload?.headed_manual)
  && !task.payload?.headed_takeover && task.payload?.commander_protocol !== 'commander-v2';

export function commonRunnerTaskInput(task) {
  const input = task.payload?.common_runner;
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !['run_id', 'profile', 'mode', 'input'].includes(k))
    || !UUID.test(input.run_id ?? '') || !/^[a-z][a-z0-9-]{0,63}$/.test(input.profile ?? '')
    || !['exploration', 'formal'].includes(input.mode) || !input.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
    throw Error('common_runner_task_input_invalid');
  }
  return { runId: input.run_id, body: { task_id: task.id, profile: input.profile, mode: input.mode, input: input.input } };
}

/** Explicit opt-in only. One task owns one immutable run; unknown execution is never relaunched. */
export async function runCommonRunnerTasks(pool, deps = {}) {
  if (running.has(pool)) return { skipped: 'already_running' };
  running.add(pool);
  const dispatcher = deps.dispatcher ?? createCommonRunnerDispatcher({ pool });
  const finalizeTask = deps.finalizeTask ?? finalizeCentralTask;
  const recordEvent = deps.recordEvent ?? recordTaskEventSafe;
  const out = { dispatched: 0, reaped: 0, needs_review: 0, unknown: 0, failed_preflight: 0, errors: 0 };
  const began = Date.now();
  async function observe(task, initial) {
    const fixed = task.result?.common_runner;
    const retryNotStarted = fixed?.launch_state === 'not_started' && !fixed.cancel_requested;
    const plan = fixed ? { runId: fixed.run_id, body: { task_id: task.id,
      ...(retryNotStarted ? { profile: fixed.profile, mode: fixed.mode, input: fixed.input } : {}) } } : commonRunnerTaskInput(task);
    const action = fixed?.cancel_requested ? 'cancel' : fixed && !retryNotStarted ? 'inspect' : 'start';
    let result = await dispatcher.dispatch(action, plan.runId, plan.body);
    if (!result.authenticated) { out.unknown++; return; }
    if (initial && !fixed) out.dispatched++;
    if (result.central_run?.recording_status !== 'confirmed' && Number(result.receipt?.writeback?.pending) > 0) {
      result = await dispatcher.dispatch('flush', plan.runId, { task_id: task.id });
    }
    const central = result.central_run;
    if (central?.status === 'needs_review') {
      const review = await blockCommonRunnerForReview(pool, task, plan.runId, result, {recordEvent});
      if (review.blocked) out.needs_review++;
      return;
    }
    if (result.authenticated && central?.recording_status === 'confirmed' && ['success', 'failed', 'cancelled'].includes(central.status)) {
      // Task terminal vocabulary has no cancelled terminal: cancellation is failure to deliver, never success.
      const status = central.status === 'success' ? 'completed' : 'failed';
      const summary = `公共Runner ${plan.runId}：中央运行${central.status}，执行记录已独立读回`;
      const finished = await finalizeTask(pool, task.id, status, { onlyIfStatus: 'in_progress',
        where: { sql: "claimed_by='common-runner' AND result->'common_runner'->>'run_id'=$1", params: [plan.runId] },
        mergeResult: { actor: 'common-runner', summary, evidence: [{ run_id: plan.runId, central_status: central.status,
          profile_sha256: result.receipt.profile_sha256, writeback: result.receipt.writeback }], handoff: { summary, next_steps: [] } },
        ...(status === 'failed' ? { set: { error_message: `common_runner_${central.status}` } } : {}) });
      if (finished.rowCount) out.reaped++;
    }
  }
  try {
    const existing = (await pool.query(`SELECT * FROM tasks WHERE status='in_progress' AND claimed_by='common-runner'
      AND ${SAFE_TASK} AND result->'common_runner'->>'run_id' IS NOT NULL
      ORDER BY ($1::uuid IS NULL OR id>$1::uuid) DESC,id LIMIT 10`, [reapCursors.get(pool) ?? null])).rows;
    for (const task of existing.slice(0, 10)) {
      if (Date.now() - began > 180000) break;
      if (!safeTask(task)) continue;
      try { await observe(task, false); } catch { out.errors++; }
      finally { reapCursors.set(pool, task.id); }
    }
    const queued = (await pool.query(`SELECT * FROM tasks WHERE status='queued' AND (claimed_by IS NULL OR claimed_by='common-runner')
      AND ${SAFE_TASK}
      AND NOT EXISTS(SELECT 1 FROM task_dependencies d JOIN tasks dep ON dep.id=d.to_task_id
        WHERE d.from_task_id=tasks.id AND d.edge_type='hard' AND dep.status NOT IN ('completed','cancelled','canceled'))
      AND NOT EXISTS(SELECT 1 FROM harness_gap_dependencies g WHERE g.source_task_id=tasks.id AND g.status='pending')
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,created_at,id LIMIT 1`)).rows;
    for (const candidate of queued.slice(0, 1)) {
      if (!safeTask(candidate)) continue;
      const claimed = (await pool.query(`UPDATE tasks SET claimed_by='common-runner',claimed_at=COALESCE(claimed_at,NOW()),updated_at=NOW()
        WHERE id=$1 AND status='queued' AND (claimed_by IS NULL OR claimed_by='common-runner') AND ${SAFE_TASK} RETURNING *`, [candidate.id])).rows[0];
      if (!claimed) continue;
      try { await observe(claimed, true); }
      catch (error) {
        const reason = /^common_runner_[a-z_]+$/.test(error.message) ? error.message : null;
        if (reason && !['common_runner_runtime_isolated', 'common_runner_dispatch_paused'].includes(reason) && !claimed.result?.common_runner) {
          const summary = `公共Runner启动前拒绝：${reason}`;
          await finalizeTask(pool, claimed.id, 'failed', { onlyIfStatus: 'queued',
            where: { sql: "claimed_by='common-runner' AND result->'common_runner' IS NULL", params: [] },
            set: { error_message: reason }, mergeResult: { actor: 'common-runner', summary, evidence: [{ reason, phase: 'preflight' }], handoff: { summary, next_steps: [] } } });
          out.failed_preflight++;
        } else { out.errors++; }
        await recordEvent(pool, claimed.id, 'common_runner_preflight', { reason: reason ?? 'execution_authority_unavailable', action: 'no_legacy_fallback' });
      }
    }
    return out;
  } finally { running.delete(pool); }
}
