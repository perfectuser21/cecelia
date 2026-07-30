const ACTIVE_PHASES = new Set([
  'planning',
  'gan',
  'generate',
  'evaluate',
]);

const CREATED_SOURCES = new Set([
  'kernel_dispatch',
  'foreground_handoff',
  'legacy_relay',
  'explicit_recovery',
  'historical_reconstruction',
]);

const ELIGIBLE_TASK_TYPES = new Set([
  'harness_initiative',
  'golden_path_proposal',
]);

const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
]);

function validateCreateInput(input) {
  if (!ACTIVE_PHASES.has(input?.phase)) {
    throw new Error(`invalid Kernel run start phase: ${input?.phase}`);
  }
  if (!CREATED_SOURCES.has(input?.createdSource)) {
    throw new Error(`invalid Kernel run created source: ${input?.createdSource}`);
  }
  if (!Number.isFinite(input?.deadlineHours) || input.deadlineHours <= 0) {
    throw new Error(`invalid Kernel run deadline hours: ${input?.deadlineHours}`);
  }
}

export async function loadActiveKernelRun(db, taskId, { forUpdate = false } = {}) {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await db.query(
    `SELECT id, initiative_id, current_task_id, phase,
            orchestrator_heartbeat_at, orchestrator_pid, orchestrator_host,
            started_at, created_source
       FROM initiative_runs
      WHERE current_task_id = $1
        AND orchestrator_version = 'v2'
        AND phase NOT IN ('done', 'failed')
      ORDER BY started_at DESC, id DESC
      LIMIT 1${lock}`,
    [taskId],
  );
  return rows[0] ?? null;
}

export async function createKernelRun(pool, input) {
  validateCreateInput(input);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const { rows: taskRows } = await client.query(
      `SELECT id, task_type, status, payload
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.taskId],
    );
    const task = taskRows[0];
    if (
      !task
      || !ELIGIBLE_TASK_TYPES.has(task.task_type)
      || TERMINAL_TASK_STATUSES.has(task.status)
    ) {
      throw new Error(`kernel run task ${input.taskId} not eligible`);
    }
    const taskInitiativeId = task.payload?.initiative_id ?? task.id;
    if (String(taskInitiativeId) !== input.initiativeId) {
      throw new Error(
        `kernel run task ${input.taskId} initiative mismatch: `
        + `${input.initiativeId}/${taskInitiativeId}`,
      );
    }

    const active = await loadActiveKernelRun(
      client,
      input.taskId,
      { forUpdate: true },
    );
    if (active) {
      await client.query('COMMIT');
      committed = true;
      return { created: false, run: active };
    }

    const { rows } = await client.query(
      `INSERT INTO initiative_runs (
         initiative_id, phase, journey_id, orchestrator_version,
         orchestrator_host, deadline_at, ability_id, current_task_id,
         created_source, record_trust_status
       ) VALUES (
         $1, $2, $3, 'v2', $4,
         NOW() + ($5 * INTERVAL '1 hour'), $6, $7, $8, $9
       )
       RETURNING *`,
      [
        input.initiativeId,
        input.phase,
        input.journeyId,
        input.host,
        input.deadlineHours,
        input.abilityId,
        input.taskId,
        input.createdSource,
        'trusted',
      ],
    );
    await client.query('COMMIT');
    committed = true;
    return { created: true, run: rows[0] };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeKernelRun(pool, {
  runId,
  expectedTaskId,
  outcome,
  reason = null,
}) {
  if (!['done', 'failed'].includes(outcome)) {
    throw new Error(`invalid Kernel terminal outcome: ${outcome}`);
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const { rows: taskRows } = await client.query(
      `SELECT id, status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [expectedTaskId],
    );
    const task = taskRows[0];
    if (!task) {
      throw new Error(`Kernel run parent task missing: ${expectedTaskId}`);
    }

    // createKernelRun also locks task before run. Keeping one global order
    // prevents create/finalize deadlocks under concurrent recovery.
    const { rows: runRows } = await client.query(
      `SELECT id, current_task_id, phase
         FROM initiative_runs
        WHERE id = $1
          AND orchestrator_version = 'v2'
        FOR UPDATE`,
      [runId],
    );
    const run = runRows[0];
    if (!run || run.current_task_id !== expectedTaskId) {
      throw new Error(
        `Kernel run/task identity mismatch: ${runId}/${expectedTaskId}`,
      );
    }

    const runAlreadyTerminal = ['done', 'failed'].includes(run.phase);
    if (runAlreadyTerminal && run.phase !== outcome) {
      throw new Error(
        `Kernel terminal outcome conflict: ${run.phase}/${outcome}`,
      );
    }

    const taskOutcome = outcome === 'done' ? 'completed' : 'failed';
    if (
      TERMINAL_TASK_STATUSES.has(task.status)
      && task.status !== taskOutcome
    ) {
      throw new Error(
        `Kernel task terminal outcome conflict: ${task.status}/${taskOutcome}`,
      );
    }

    const changed = !runAlreadyTerminal;
    if (changed) {
      await client.query(
        `UPDATE initiative_runs
            SET phase = $2,
                failure_reason = CASE
                  WHEN $2 = 'failed' THEN $3
                  ELSE failure_reason
                END,
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
          WHERE id = $1`,
        [runId, outcome, reason],
      );
    }

    if (task.status !== taskOutcome) {
      await client.query(
        `UPDATE tasks
            SET status = $2::varchar,
                error_message = CASE
                  WHEN $2::text = 'failed' THEN $3
                  ELSE error_message
                END,
                completed_at = COALESCE(completed_at, NOW()),
                updated_at = NOW()
          WHERE id = $1`,
        [expectedTaskId, taskOutcome, reason],
      );
    }

    if (changed) {
      await client.query(
        `INSERT INTO orchestrator_decision_log
           (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
         SELECT $1,
                COALESCE(MAX(hop), 0) + 1,
                $4::jsonb,
                $2,
                $3,
                'effect:run_terminal',
                $4::jsonb
           FROM orchestrator_decision_log
          WHERE run_id = $1`,
        [
          runId,
          outcome,
          outcome === 'done' ? 'allow' : 'deny:run_failed',
          JSON.stringify({
            task_id: expectedTaskId,
            outcome,
            reason,
          }),
        ],
      );
    }

    await client.query('COMMIT');
    committed = true;
    return {
      changed,
      outcome,
      runId,
      taskId: expectedTaskId,
    };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileKernelTaskTerminal(
  pool,
  taskId,
  { finalizeRun = finalizeKernelRun } = {},
) {
  const { rows } = await pool.query(
    `SELECT id, phase, failure_reason
       FROM initiative_runs
      WHERE current_task_id = $1
        AND orchestrator_version = 'v2'
        AND phase IN ('done', 'failed')
      ORDER BY completed_at DESC NULLS LAST, started_at DESC, id DESC
      LIMIT 1`,
    [taskId],
  );
  const run = rows[0];
  if (!run) {
    return {
      reconciled: false,
      reason: 'no_task_linked_terminal_run',
    };
  }

  await finalizeRun(pool, {
    runId: run.id,
    expectedTaskId: taskId,
    outcome: run.phase,
    reason: run.failure_reason ?? 'terminal_run_reconciliation',
  });
  return {
    reconciled: true,
    runId: run.id,
    outcome: run.phase,
  };
}

export const __test__ = {
  ACTIVE_PHASES,
  CREATED_SOURCES,
  ELIGIBLE_TASK_TYPES,
  TERMINAL_TASK_STATUSES,
};
