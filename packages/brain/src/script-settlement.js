import {finalizeTask} from './lib/task-terminal.js';
import {finishRun} from './lib/task-run.js';
import {recordTaskEventSafe} from './lib/task-event-log.js';
import {getBackoffMs} from './lib/retry-policy.js';

export function redactEnvValues(text, env) {
  let out = String(text ?? '');
  const values = Object.values(env ?? {}).filter((v) => typeof v === 'string' && v.length >= 3);
  values.sort((a, b) => b.length - a.length);
  for (const v of values) out = out.split(v).join('***');
  return out;
}

export async function settleScriptRun(pool, row, parsed, { hostId, runId, reservationId = null }) {
  const authority = reservationId ? {where:{sql:"payload->>'script_run_id'=$1 AND payload->>'script_reservation_id'=$2",params:[runId,reservationId]}} : {};
  const payload = row.payload ?? {};
  const env = payload.env ?? {};
  const stdout = redactEnvValues(parsed.stdout, env);
  const stderr = redactEnvValues(parsed.stderr, env);
  const prior = Array.isArray(payload.script_attempts) ? payload.script_attempts : [];
  const attemptNo = prior.length + 1;
  const artifacts = parsed.artifacts ?? [
    `${hostId}:~/brain-runs/${runId}.out`,
    `${hostId}:~/brain-runs/${runId}.err`,
    ...(Array.isArray(payload.artifact_paths) ? payload.artifact_paths.map((p) => `${hostId}:${p}`) : []),
  ];
  const script = {
    exit_code: parsed.exit, timed_out: parsed.timedOut, host: hostId, run_id: runId,
    attempts: attemptNo, stdout, stderr, artifacts,
    ...(reservationId?{logs_truncated:parsed.logs_truncated===true,logs_unavailable:parsed.logs_unavailable===true}:{}),
  };

  if (parsed.exit === 0 && !parsed.timedOut) {
    // 成功终态写 completed：hard 依赖门禁只放行 completed。
    const settled=await finalizeTask(pool, row.id, 'completed', { ...authority,mergeResult: { script }, onlyIfStatus: 'in_progress' });
    if(!settled.rowCount)return 'skipped';
    await finishRun({ runId, status: 'completed', exitCode: 0, artifacts }, { pool });
    await recordTaskEventSafe(pool, row.id, 'script_reaped', { run_id: runId, exit: 0 });
    return 'completed';
  }

  const code = parsed.failureCode ?? (parsed.timedOut ? 'script_timeout' : `script_exit_${parsed.exit}`);
  await finishRun({
    runId,
    status: parsed.timedOut ? 'timeout' : 'failed',
    exitCode: parsed.exit,
    artifacts,
    error: code,
  }, { pool });
  const attempts = [...prior, {
    attempt: attemptNo, run_id: runId, exit_code: parsed.exit, timed_out: parsed.timedOut, error: code,
    stderr_tail: stderr.slice(-500), ended_at: new Date().toISOString(),
  }];

  const backoffMs = getBackoffMs('script_exec', prior.length);
  if (backoffMs !== null) {
    const nextRunAt = new Date(Date.now() + backoffMs).toISOString();
    const requeued = await pool.query(
      `UPDATE tasks
          SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW(),
              payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
        WHERE id = $1 AND status = 'in_progress'
          AND ($3::text IS NULL OR (payload->>'script_run_id'=$4 AND payload->>'script_reservation_id'=$3))
        RETURNING id`,
      [row.id, JSON.stringify({ script_attempts: attempts, next_run_at: nextRunAt, script_run_id: null }),reservationId,runId],
    );
    if (!requeued.rowCount) return 'skipped';
    await recordTaskEventSafe(pool, row.id, 'script_attempt_failed', {
      run_id: runId, exit: parsed.exit, timed_out: parsed.timedOut, will_retry: true, next_run_at: nextRunAt,
    });
    return 'retried';
  }

  const firstErrLine = stderr.split('\n').map((l) => l.trim()).find(Boolean);
  const settled=await finalizeTask(pool, row.id, 'failed', {
    ...authority,
    set: {
      completed_at: 'now',
      error_message: `${code}${firstErrLine ? `: ${firstErrLine}` : ''}`.slice(0, 500),
    },
    mergeResult: { script },
    mergePayload: { script_attempts: attempts, failure_class: 'script_failed' },
    onlyIfStatus: 'in_progress',
  });
  if(!settled.rowCount)return 'skipped';
  await recordTaskEventSafe(pool, row.id, 'script_attempt_failed', {
    run_id: runId, exit: parsed.exit, timed_out: parsed.timedOut, will_retry: false,
  });
  return 'failed';
}

