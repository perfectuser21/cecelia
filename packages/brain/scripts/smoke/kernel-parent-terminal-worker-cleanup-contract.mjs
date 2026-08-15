/* global setTimeout */

const ACTIVE_ATTEMPT_STATUSES = new Set(['queued', 'starting', 'running']);
const CONFIRMED_CLEANUP_STATUSES = new Set(['cleaned', 'already_clean']);

function snapshotMachine(attempt) {
  return attempt.machine_id ?? attempt.actual_machine_id ?? attempt.requested_machine_id;
}

function assertSameAttemptSnapshot(current, expected, { requireActive = false } = {}) {
  if (
    !current
    || current.attempt_id !== expected.attempt_id
    || current.run_id !== expected.run_id
    || snapshotMachine(current) !== snapshotMachine(expected)
    || current.lease_owner !== expected.lease_owner
    || current.lease_generation !== expected.lease_generation
    || (requireActive && !ACTIVE_ATTEMPT_STATUSES.has(current.status))
  ) {
    throw new Error(`attempt snapshot changed before parent terminal:${expected.attempt_id}`);
  }
}

export async function waitForAttemptRunning({
  pool,
  snapshot,
  timeoutMs,
  pollMs,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const current = (await pool.query(
      `SELECT id AS attempt_id,run_id,status,
              COALESCE(actual_machine_id,requested_machine_id,machine_id) AS machine_id,
              actual_machine_id,requested_machine_id,lease_owner,lease_generation,
              execution_transport,remote_job_id
         FROM harness_attempts
        WHERE id=$1 AND run_id=$2`,
      [snapshot.attempt_id, snapshot.run_id],
    )).rows[0];
    assertSameAttemptSnapshot(current, snapshot, { requireActive: true });
    if (current.status === 'running') return Object.freeze({ ...current });
    await sleep(pollMs);
  } while (Date.now() < deadline);
  throw new Error(`cleanup canary attempt did not reach running:${snapshot.attempt_id}`);
}

export async function terminalizeCanaryParent({ pool, identity, attempts } = {}) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const run = (await client.query(
      `SELECT id,phase,orchestrator_version
         FROM initiative_runs
        WHERE id=$1 AND current_task_id=$2
        FOR UPDATE`,
      [identity.run_id, identity.task_id],
    )).rows[0];
    if (!run || run.orchestrator_version !== 'v2' || ['done', 'failed'].includes(run.phase)) {
      throw new Error('cleanup canary parent run is not active v2');
    }
    const attemptIds = attempts.map((attempt) => attempt.attempt_id).sort();
    const currentAttempts = (await client.query(
      `SELECT id AS attempt_id,run_id,status,
              COALESCE(actual_machine_id,requested_machine_id,machine_id) AS machine_id,
              actual_machine_id,requested_machine_id,lease_owner,lease_generation,
              execution_transport,remote_job_id
         FROM harness_attempts
        WHERE run_id=$1 AND id=ANY($2::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [identity.run_id, attemptIds],
    )).rows;
    if (currentAttempts.length !== attempts.length) {
      throw new Error('attempt snapshot changed before parent terminal:count');
    }
    const expectedById = new Map(attempts.map((attempt) => [attempt.attempt_id, attempt]));
    for (const current of currentAttempts) {
      assertSameAttemptSnapshot(current, expectedById.get(current.attempt_id), {
        requireActive: true,
      });
    }
    const terminalized = await client.query(
      `UPDATE initiative_runs
          SET phase='failed',failure_reason='cleanup_canary_parent_terminal',
              completed_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND current_task_id=$2 AND phase NOT IN ('done','failed')
        RETURNING id`,
      [identity.run_id, identity.task_id],
    );
    if (terminalized.rows.length !== 1) throw new Error('cleanup canary parent terminal CAS failed');
    await client.query('COMMIT');
    transactionOpen = false;
    return true;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function validateCleanupEvidence({ attempts, outbox, decisionCount } = {}) {
  if (outbox.length !== attempts.length || decisionCount !== attempts.length) {
    throw new Error('cleanup evidence count mismatch');
  }
  const outboxByAttempt = new Map(outbox.map((row) => [row.attempt_id, row]));
  for (const attempt of attempts) {
    const row = outboxByAttempt.get(attempt.attempt_id);
    const receipt = row?.receipt;
    if (
      !row
      || row.status !== 'confirmed'
      || row.run_id !== attempt.run_id
      || row.target_machine_id !== snapshotMachine(attempt)
      || row.execution_transport !== attempt.execution_transport
      || row.lease_owner !== attempt.lease_owner
      || row.lease_generation !== attempt.lease_generation
      || receipt?.contract_version !== 'attempt-cleanup-confirmation/v1'
      || !CONFIRMED_CLEANUP_STATUSES.has(receipt?.status)
      || receipt.attempt_id !== attempt.attempt_id
      || receipt.run_id !== attempt.run_id
      || receipt.target_machine_id !== snapshotMachine(attempt)
      || receipt.execution_transport !== attempt.execution_transport
      || receipt.lease_owner !== attempt.lease_owner
      || receipt.lease_generation !== attempt.lease_generation
    ) {
      throw new Error(`cleanup evidence identity mismatch:${attempt.attempt_id}`);
    }
  }
  return true;
}
