const INFLIGHT_STATUSES = new Set(['starting', 'running']);
const PREPARED_WORKER_STATUSES = new Set(['prepared', 'starting']);
const CONFIRMED_CANCEL_STATUSES = new Set([
  'cancelled',
  'cleaned',
  'already_clean',
]);
const TERMINAL_CODES = new Set([
  'worker_attempt_missing_after_lease',
  'worker_attempt_replacement_required_after_lease',
]);

function bounded(value, maximum = 1_000) {
  return String(value ?? '').slice(0, maximum);
}

function validLease(attempt) {
  return (
    typeof attempt?.lease_owner === 'string'
    && attempt.lease_owner.length > 0
    && Number.isInteger(attempt.lease_generation)
    && attempt.lease_generation >= 0
  );
}

function expired(attempt, now) {
  if (!INFLIGHT_STATUSES.has(attempt?.status)) return false;
  const expiresAt = new Date(attempt?.lease_expires_at);
  return Number.isFinite(expiresAt.getTime()) && expiresAt < now;
}

function targetMachine(attempt) {
  if (
    attempt?.machine_attestation_status === 'verified'
    && typeof attempt.actual_machine_id === 'string'
    && attempt.actual_machine_id.length > 0
  ) {
    return attempt.actual_machine_id;
  }
  return [attempt?.requested_machine_id, attempt?.machine_id]
    .find((value) => typeof value === 'string' && value.length > 0) ?? null;
}

function infrastructureBlocked(signature) {
  return Object.freeze({
    status: 'infrastructure_blocked',
    failure_class: 'infrastructure_blocked',
    signature,
  });
}

function terminalInput(attempt, machine, code, message) {
  return Object.freeze({
    attemptId: attempt.id,
    runId: attempt.run_id,
    leaseOwner: attempt.lease_owner,
    leaseGeneration: attempt.lease_generation,
    code,
    message,
    failureClass: 'infrastructure_blocked',
    evidence: Object.freeze({
      attempt_id: attempt.id,
      prior_lease_generation: attempt.lease_generation,
      target: machine,
      signature: code,
    }),
  });
}

export function oldestExpiredAttempt(attempts, now = new Date()) {
  if (!Array.isArray(attempts) || !(now instanceof Date)) return null;
  return attempts
    .filter((attempt) => expired(attempt, now))
    .sort((left, right) => {
      const byExpiry = new Date(left.lease_expires_at) - new Date(right.lease_expires_at);
      if (byExpiry !== 0) return byExpiry;
      const byHop = Number(left.hop ?? 0) - Number(right.hop ?? 0);
      if (byHop !== 0) return byHop;
      return String(left.id).localeCompare(String(right.id));
    })[0] ?? null;
}

/**
 * Expired-attempt terminal authority. The exact lease-fenced attempt update and
 * its bounded append-only evidence share one PostgreSQL transaction. This is
 * intentionally separate from callback authority: no callback or role verdict
 * is fabricated when Worker state is missing.
 */
export function createExpiredAttemptAuthority(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('expired attempt authority requires a transactional pool');
  }
  return Object.freeze({
    async terminalize(input) {
      if (!TERMINAL_CODES.has(input?.code)) {
        throw new Error('expired attempt terminal code invalid');
      }
      if (
        typeof input.attemptId !== 'string'
        || typeof input.runId !== 'string'
        || typeof input.leaseOwner !== 'string'
        || input.leaseOwner.length === 0
        || !Number.isInteger(input.leaseGeneration)
        || input.leaseGeneration < 0
      ) {
        throw new Error('expired attempt terminal identity invalid');
      }
      const detail = Object.freeze({
        attempt_id: input.attemptId,
        prior_lease_generation: input.leaseGeneration,
        target: bounded(input.evidence?.target, 128),
        signature: input.code,
      });
      const client = await pool.connect();
      let transactionOpen = false;
      const rollbackConflict = async (conflict) => {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { attempt: null, hop: null, deduped: false, conflict };
      };
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const locked = await client.query(
          `WITH decision_lock AS MATERIALIZED (
             SELECT pg_advisory_xact_lock(hashtext($2::text)) AS locked
           ), locked_run AS MATERIALIZED (
             SELECT run.id, run.phase
               FROM decision_lock
               JOIN initiative_runs run ON run.id=$2::uuid
              WHERE run.orchestrator_version='v2'
              FOR UPDATE OF run
           )
           SELECT attempt.*, locked_run.phase AS run_phase
             FROM locked_run
             JOIN harness_attempts attempt ON attempt.run_id=locked_run.id
            WHERE attempt.id=$1
            FOR UPDATE OF attempt`,
          [input.attemptId, input.runId],
        );
        const attempt = locked.rows?.[0] ?? null;
        if (!attempt) return await rollbackConflict('attempt_identity_mismatch');
        if (attempt.lease_owner !== input.leaseOwner) {
          return await rollbackConflict('lease_owner_mismatch');
        }
        if (attempt.lease_generation !== input.leaseGeneration) {
          return await rollbackConflict('lease_generation_mismatch');
        }
        if (['done', 'failed'].includes(attempt.run_phase)) {
          return await rollbackConflict('parent_run_terminal');
        }
        if (!INFLIGHT_STATUSES.has(attempt.status)) {
          return await rollbackConflict('attempt_not_inflight');
        }

        const terminal = await client.query(
          `UPDATE harness_attempts
              SET status='failed',
                  error_code=$5,
                  error_message=$6,
                  failure_class=$7,
                  completed_at=NOW(),
                  lease_expires_at=NULL,
                  updated_at=NOW()
            WHERE id=$1
              AND run_id=$2
              AND lease_owner=$3
              AND lease_generation=$4
              AND status IN ('starting','running')
              AND lease_expires_at < NOW()
            RETURNING *`,
          [
            input.attemptId,
            input.runId,
            input.leaseOwner,
            input.leaseGeneration,
            input.code,
            bounded(input.message),
            input.failureClass,
          ],
        );
        const terminalAttempt = terminal.rows?.[0] ?? null;
        if (!terminalAttempt) {
          return await rollbackConflict('attempt_changed_before_terminal_write');
        }

        const evidence = await client.query(
          `WITH next_hop AS (
             SELECT COALESCE(MAX(hop), 0) + 1 AS hop
               FROM orchestrator_decision_log
              WHERE run_id=$1::uuid
           )
           INSERT INTO orchestrator_decision_log
             (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
           SELECT $1::uuid, next_hop.hop, $2::jsonb, $3,
                  'deny:infrastructure_blocked',
                  'effect:expired_attempt_reconciled', $4::jsonb
             FROM next_hop
           RETURNING hop`,
          [
            input.runId,
            JSON.stringify({
              attempt_id: input.attemptId,
              role: terminalAttempt.role,
              status: 'failed',
            }),
            terminalAttempt.phase,
            JSON.stringify(detail),
          ],
        );
        const hop = Number(evidence.rows?.[0]?.hop);
        if (!Number.isSafeInteger(hop)) {
          throw new Error('expired attempt decision evidence missing');
        }
        await client.query('COMMIT');
        transactionOpen = false;
        return { attempt: terminalAttempt, hop, deduped: false };
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // Preserve the authoritative transaction failure.
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

/**
 * Keep Worker and Brain on the same old lease identity. A database reclaim
 * would increment generation without rotating Worker/callback state, fencing
 * out the live Runner. A future ownership transfer requires its own atomic
 * Worker lease-rotation protocol.
 */
export async function reconcileExpiredAttempt({
  attempt,
  launcher,
  attemptStore,
  terminalize,
  now = () => new Date(),
  leaseSeconds = 180,
}) {
  const currentTime = now();
  if (!expired(attempt, currentTime)) {
    return Object.freeze({ status: 'not_expired' });
  }
  if (!validLease(attempt)) {
    return infrastructureBlocked('worker_attempt_lease_identity_invalid');
  }
  const machine = targetMachine(attempt);
  if (!machine) {
    return infrastructureBlocked('worker_attempt_target_missing');
  }
  const target = Object.freeze({ machine });
  let inspected;
  try {
    inspected = await launcher.inspect({ attempt, target });
  } catch {
    return infrastructureBlocked('worker_attempt_inspect_unavailable');
  }

  if (inspected?.status === 'missing') {
    try {
      const terminal = await terminalize(terminalInput(
        attempt,
        machine,
        'worker_attempt_missing_after_lease',
        'Worker has no exact state after lease expiry',
      ));
      if (!terminal?.attempt || !Number.isSafeInteger(Number(terminal.hop))) {
        return infrastructureBlocked('worker_attempt_terminal_authority_conflict');
      }
      return Object.freeze({
        status: 'missing_terminalized',
        attempt_id: attempt.id,
        hop: Number(terminal.hop),
      });
    } catch {
      return infrastructureBlocked('worker_attempt_terminal_authority_unavailable');
    }
  }

  if (PREPARED_WORKER_STATUSES.has(inspected?.status)) {
    try {
      await launcher.start({ attempt, target });
    } catch {
      let cancelled;
      try {
        cancelled = await launcher.cancel({ attempt, target });
      } catch {
        return infrastructureBlocked('worker_attempt_cancel_unavailable');
      }
      if (!CONFIRMED_CANCEL_STATUSES.has(cancelled?.status)) {
        return infrastructureBlocked('worker_attempt_cancel_unconfirmed');
      }
      try {
        const terminal = await terminalize(terminalInput(
          attempt,
          machine,
          'worker_attempt_replacement_required_after_lease',
          'Prepared Worker could not resume with its exact credential lease',
        ));
        if (!terminal?.attempt || !Number.isSafeInteger(Number(terminal.hop))) {
          return infrastructureBlocked('worker_attempt_terminal_authority_conflict');
        }
        return Object.freeze({
          status: 'replacement_required',
          attempt_id: attempt.id,
          hop: Number(terminal.hop),
        });
      } catch {
        return infrastructureBlocked('worker_attempt_terminal_authority_unavailable');
      }
    }
    let renewed;
    try {
      renewed = await attemptStore.heartbeat(attempt.id, {
        leaseOwner: attempt.lease_owner,
        leaseGeneration: attempt.lease_generation,
        leaseSeconds,
      });
    } catch {
      return infrastructureBlocked('worker_attempt_lease_heartbeat_unavailable');
    }
    if (!renewed) {
      return infrastructureBlocked('worker_attempt_lease_heartbeat_conflict');
    }
    return Object.freeze({ status: 'adopted_prepared', attempt_id: attempt.id });
  }

  if (inspected?.status === 'running') {
    let renewed;
    try {
      renewed = await attemptStore.heartbeat(attempt.id, {
        leaseOwner: attempt.lease_owner,
        leaseGeneration: attempt.lease_generation,
        leaseSeconds,
      });
    } catch {
      return infrastructureBlocked('worker_attempt_lease_heartbeat_unavailable');
    }
    if (!renewed) {
      return infrastructureBlocked('worker_attempt_lease_heartbeat_conflict');
    }
    return Object.freeze({ status: 'adopted_running', attempt_id: attempt.id });
  }

  return infrastructureBlocked('worker_attempt_state_unresolved');
}
