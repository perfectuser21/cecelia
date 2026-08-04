import { COMMANDER_MODES } from './commander-contract.js';

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
  'canceled',
]);

const VALID_COMMANDER_MODES = new Set(COMMANDER_MODES);

async function lockActiveKernelAttempts(client, runId) {
  const { rows } = await client.query(
    `SELECT id
       FROM harness_attempts
      WHERE run_id = $1
        AND status IN ('queued', 'starting', 'running')
      ORDER BY id
      FOR UPDATE`,
    [runId],
  );
  return rows;
}

async function terminalizeLockedKernelAttempts(client, {
  runId,
  attempts,
  outcome,
  reason,
}) {
  if (attempts.length === 0) return 0;
  const { rowCount } = await client.query(
    `UPDATE harness_attempts
        SET status = 'cancelled',
            error_code = 'parent_run_terminal',
            error_message = $3,
            completed_at = COALESCE(completed_at, NOW()),
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE id = ANY($1::uuid[])
        AND run_id = $2
        AND status IN ('queued', 'starting', 'running')`,
    [
      attempts.map(({ id }) => id),
      runId,
      `Parent Kernel run finalized as ${outcome}${reason ? `: ${reason}` : ''}`,
    ],
  );
  return rowCount;
}

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
  const commanderMode = input?.commanderMode === undefined
    ? 'kernel-only'
    : input.commanderMode;
  if (!VALID_COMMANDER_MODES.has(commanderMode)) {
    throw new Error(`invalid Kernel run commander mode: ${commanderMode}`);
  }
  return { commanderMode };
}

export async function loadActiveKernelRun(db, taskId, { forUpdate = false } = {}) {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await db.query(
    `SELECT id, initiative_id, current_task_id, phase,
            orchestrator_heartbeat_at, orchestrator_pid, orchestrator_host,
            started_at, created_source, commander_mode
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

export async function loadKernelRunById(db, runId) {
  const { rows } = await db.query(
    `SELECT id, initiative_id, current_task_id, phase,
            orchestrator_version, orchestrator_heartbeat_at,
            orchestrator_pid, orchestrator_host, started_at, updated_at,
            deadline_at, completed_at, failure_reason, pr_url,
            evaluate_verdict, judge_verdict, cost_usd, created_source,
            record_trust_status, record_trust_reason, predecessor_run_id,
            commander_mode
       FROM initiative_runs
      WHERE id = $1
        AND orchestrator_version = 'v2'`,
    [runId],
  );
  return rows[0] ?? null;
}

export async function patchKernelRunById(pool, {
  runId,
  phase,
  failureReason = null,
  prUrl = null,
  evaluateVerdict = null,
  judgeVerdict = null,
  costUsd = null,
  transactionClient = null,
}) {
  if (![
    'planning',
    'gan',
    'generate',
    'evaluate',
    'done',
    'failed',
  ].includes(phase)) {
    throw new Error(`invalid Kernel run patch phase: ${phase}`);
  }

  const identity = await loadKernelRunById(transactionClient ?? pool, runId);
  if (!identity) return null;

  const ownsTransaction = transactionClient === null;
  const client = transactionClient ?? await pool.connect();
  let committed = false;
  try {
    if (ownsTransaction) await client.query('BEGIN');

    let task = null;
    if (identity.current_task_id) {
      const { rows } = await client.query(
        `SELECT id, status
           FROM tasks
          WHERE id = $1
          FOR UPDATE`,
        [identity.current_task_id],
      );
      task = rows[0] ?? null;
    }

    const { rows: runRows } = await client.query(
      `SELECT id, current_task_id, phase
         FROM initiative_runs
        WHERE id = $1
          AND orchestrator_version = 'v2'
        FOR UPDATE`,
      [runId],
    );
    const current = runRows[0];
    if (!current) {
      if (ownsTransaction) await client.query('COMMIT');
      committed = true;
      return null;
    }
    if (current.current_task_id !== identity.current_task_id) {
      throw new Error(`Kernel run identity changed during patch: ${runId}`);
    }

    const wasTerminal = ['done', 'failed'].includes(current.phase);
    const willBeTerminal = ['done', 'failed'].includes(phase);
    if (wasTerminal && current.phase !== phase) {
      throw new Error(
        `Kernel terminal outcome conflict: ${current.phase}/${phase}`,
      );
    }
    if (!identity.current_task_id || !task) {
      throw new Error(`Kernel run parent task missing: ${runId}`);
    }
    if (!willBeTerminal && TERMINAL_TASK_STATUSES.has(task.status)) {
      throw new Error(`Kernel task is terminal: ${task.status}`);
    }
    const activeAttempts = willBeTerminal
      ? await lockActiveKernelAttempts(client, runId)
      : [];

    const { rows: updatedRows } = await client.query(
      `UPDATE initiative_runs
          SET phase = $2,
              completed_at = CASE
                WHEN $2 IN ('done','failed')
                  THEN COALESCE(completed_at, NOW())
                ELSE completed_at
              END,
              failure_reason = COALESCE($3, failure_reason),
              pr_url = COALESCE($4, pr_url),
              evaluate_verdict = COALESCE($5, evaluate_verdict),
              judge_verdict = COALESCE($6, judge_verdict),
              cost_usd = COALESCE($7, cost_usd),
              updated_at = NOW()
        WHERE id = $1
          AND orchestrator_version = 'v2'
      RETURNING id, initiative_id, current_task_id, phase, completed_at,
                failure_reason, pr_url, evaluate_verdict, judge_verdict,
                cost_usd, record_trust_status, record_trust_reason,
                predecessor_run_id`,
      [
        runId,
        phase,
        failureReason,
        prUrl,
        evaluateVerdict,
        judgeVerdict,
        costUsd,
      ],
    );

    if (willBeTerminal) {
      const taskOutcome = phase === 'done' ? 'completed' : 'failed';
      const taskIsCancelled = ['cancelled', 'canceled'].includes(task.status);
      if (
        TERMINAL_TASK_STATUSES.has(task.status)
        && task.status !== taskOutcome
        && !(taskIsCancelled && phase === 'failed')
      ) {
        throw new Error(
          `Kernel task terminal outcome conflict: ${task.status}/${taskOutcome}`,
        );
      }
      if (!taskIsCancelled && task.status !== taskOutcome) {
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
          [identity.current_task_id, taskOutcome, failureReason],
        );
      }
      const attemptsTerminalized = await terminalizeLockedKernelAttempts(client, {
        runId,
        attempts: activeAttempts,
        outcome: phase,
        reason: failureReason,
      });
      if (!wasTerminal) {
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
            phase,
            phase === 'done' ? 'allow' : 'deny:run_failed',
            JSON.stringify({
              task_id: identity.current_task_id,
              outcome: phase,
              reason: failureReason,
              source: 'exact_run_api',
            }),
          ],
        );
      }
      if (updatedRows[0]) {
        updatedRows[0].attemptsTerminalized = attemptsTerminalized;
      }
    }

    if (ownsTransaction) await client.query('COMMIT');
    committed = true;
    return updatedRows[0] ?? null;
  } catch (error) {
    if (ownsTransaction && !committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function patchLegacyKernelRunByInitiative(pool, {
  rawId,
  patch,
}) {
  const isFullUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId);
  const isShortId = /^[0-9a-f]{8}$/i.test(rawId);
  if (!isFullUUID && !isShortId) {
    const error = new Error('invalid id format');
    error.status = 400;
    throw error;
  }

  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const lockIdentity = isFullUUID
      ? `relay-initiative:${rawId}`
      : `relay-prefix:${rawId.toLowerCase()}`;
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [lockIdentity],
    );
    const condition = isFullUUID
      ? 'initiative_id = $1'
      : 'initiative_id::text LIKE $1';
    const value = isFullUUID ? rawId : `${rawId}%`;
    const { rows: candidates } = await client.query(
      `SELECT id
         FROM initiative_runs
        WHERE ${condition}
          AND orchestrator_version = 'v2'
        ORDER BY started_at DESC, id DESC`,
      [value],
    );
    if (candidates.length !== 1) {
      await client.query('COMMIT');
      committed = true;
      return { candidateCount: candidates.length, run: null };
    }

    const runId = candidates[0].id;
    const run = await patchKernelRunById(pool, {
      runId,
      ...patch,
      transactionClient: client,
    });
    if (!run) {
      await client.query('COMMIT');
      committed = true;
      return { candidateCount: 0, run: null };
    }
    await client.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('legacy_relay_mutation', 'relay-run-api', $1::jsonb)`,
      [JSON.stringify({
        legacy_identifier: rawId,
        run_id: runId,
        canonical_endpoint: `/api/brain/orchestrator/relay-runs/by-id/${runId}`,
      })],
    );
    await client.query('COMMIT');
    committed = true;
    return { candidateCount: 1, run };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createKernelRun(pool, input) {
  const { commanderMode } = validateCreateInput(input);
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`relay-prefix:${input.initiativeId.replaceAll('-', '').slice(0, 8).toLowerCase()}`],
    );
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`relay-initiative:${input.initiativeId}`],
    );
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
         created_source, record_trust_status, commander_mode
       ) VALUES (
         $1, $2, $3, 'v2', $4,
         NOW() + ($5 * INTERVAL '1 hour'), $6, $7, $8, $9, $10
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
        commanderMode,
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
  expectedTaskStatus = null,
  requireNoActiveSibling = false,
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
    if (expectedTaskStatus !== null && task.status !== expectedTaskStatus) {
      throw new Error(
        `Kernel task status changed: ${task.status}/${expectedTaskStatus}`,
      );
    }
    if (requireNoActiveSibling) {
      const { rows: activeSiblingRows } = await client.query(
        `SELECT id
           FROM initiative_runs
          WHERE current_task_id = $1
            AND id <> $2
            AND orchestrator_version = 'v2'
            AND phase NOT IN ('done', 'failed')
          FOR UPDATE`,
        [expectedTaskId, runId],
      );
      if (activeSiblingRows.length > 0) {
        throw new Error(
          `Kernel terminal repair blocked by active sibling: ${activeSiblingRows[0].id}`,
        );
      }
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

    const activeAttempts = await lockActiveKernelAttempts(client, runId);

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

    const attemptsTerminalized = await terminalizeLockedKernelAttempts(client, {
      runId,
      attempts: activeAttempts,
      outcome,
      reason,
    });

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
      attemptsTerminalized,
    };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * run.phase 前进持久化（r17 实证修复：运行中 phase 恒 'planning'，只有
 * finalizeKernelRun 写终态）。loop.js 在每轮最终 decision 确定后调用，仅限
 * decision.phase ∈ {planning,gan,generate,evaluate,judge} 且非 wait:* 决策。
 *
 * 死锁铁律（PR #4596 教训）：必须是独立单语句 autocommit UPDATE，禁止塞进任何
 * 还会锁其他行的事务；调用方负责把失败降级为告警，不炸 loop。
 */
export async function persistKernelRunPhase(pool, runId, phase) {
  const { rows } = await pool.query(
    `UPDATE initiative_runs
        SET phase = $2, updated_at = NOW()
      WHERE id = $1
        AND orchestrator_version = 'v2'
        AND phase IS DISTINCT FROM $2
        AND phase NOT IN ('done', 'failed')
      RETURNING id, phase`,
    [runId, phase],
  );
  return rows[0] ?? null;
}

/**
 * task.status 启动置位（r17 实证修复：派发时也不置 in_progress，task.status 恒
 * 'queued'）。run.js 启动流程装载 task 后调用一次；只在仍是 'queued' 时翻面，
 * 已 in_progress/终态一律不碰。调用方负责把失败降级为告警，不阻断 loop 启动。
 */
export async function activateQueuedKernelTask(pool, taskId) {
  const { rows } = await pool.query(
    `UPDATE tasks
        SET status = 'in_progress', updated_at = NOW()
      WHERE id = $1
        AND status = 'queued'
      RETURNING id`,
    [taskId],
  );
  return rows[0] ?? null;
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
        AND NOT EXISTS (
          SELECT 1
            FROM initiative_runs active
           WHERE active.current_task_id = $1
             AND active.orchestrator_version = 'v2'
             AND active.phase NOT IN ('done', 'failed')
        )
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
    requireNoActiveSibling: true,
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
