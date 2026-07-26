const TERMINAL_STATUSES = [
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
  'failed',
  'cancelled',
];

const SUCCESS_TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_concerns',
  'needs_context',
  'blocked',
]);

const TERMINAL_SQL = TERMINAL_STATUSES.map((status) => `'${status}'`).join(',');
const DERIVED_TIME_ROLES = new Set(['judge', 'reporter']);

function firstRow(queryResult) {
  return queryResult.rows?.[0] ?? null;
}

const CREATE_ATTEMPT_WINNER_READ_ATTEMPTS = 3;
const CREATE_ATTEMPT_WINNER_READ_DELAY_MS = 5;

async function readConcurrentAttemptWinner(pool, runId, hop) {
  for (let attempt = 0; attempt < CREATE_ATTEMPT_WINNER_READ_ATTEMPTS; attempt += 1) {
    const winner = firstRow(await pool.query(
      'SELECT * FROM harness_attempts WHERE run_id=$1 AND hop=$2',
      [runId, hop],
    ));
    if (winner) return winner;
    if (attempt + 1 < CREATE_ATTEMPT_WINNER_READ_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, CREATE_ATTEMPT_WINNER_READ_DELAY_MS));
    }
  }
  return null;
}

export function createAttemptStore(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createAttemptStore requires a PostgreSQL pool');
  }

  return Object.freeze({
    async createAttempt(input) {
      const skill = input.bundle?.skill ?? null;
      const result = await pool.query(
        `WITH inserted AS (
           INSERT INTO harness_attempts (
             id, run_id, hop, phase, role, provider, account_id, machine_id,
             requested_machine_id, local_container_naming,
             skill_name, skill_version, skill_digest, task_bundle,
             callback_secret_hash, logical_cycle_id, attempt_kind, retry_of_attempt_id,
             restart_reason, workstream_key, time_derived
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             $15,$16,$17,$18,$19,$20,$21
           )
           ON CONFLICT (run_id, hop) DO NOTHING
           RETURNING *
         )
         SELECT * FROM inserted
         UNION ALL
         SELECT * FROM harness_attempts WHERE run_id=$2 AND hop=$3
         LIMIT 1`,
        [
          input.id,
          input.runId,
          input.hop,
          input.phase,
          input.role,
          input.provider ?? 'auto',
          input.accountId ?? null,
          input.machineId ?? null,
          input.machineId ?? null,
          'generation-v1',
          skill?.name ?? null,
          skill?.version ?? null,
          skill?.digest ?? null,
          input.bundle,
          input.callbackSecretHash,
          input.logicalCycleId ?? `intent:${input.runId}:${input.hop}`,
          input.attemptKind ?? 'initial',
          input.retryOfAttemptId ?? null,
          input.restartReason ?? null,
          input.workstreamKey ?? 'ws1',
          input.timeDerived ?? DERIVED_TIME_ROLES.has(input.role),
        ],
      );
      return firstRow(result)
        ?? readConcurrentAttemptWinner(pool, input.runId, input.hop);
    },

    async markStarting(id, { leaseOwner, leaseSeconds }) {
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = 'starting',
                lease_owner = $2,
                lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
                started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
          WHERE id = $1 AND status = 'queued'
          RETURNING *`,
        [id, leaseOwner, leaseSeconds],
      );
      return firstRow(result);
    },

    async markRunning(id, { leaseOwner, providerSessionId, leaseSeconds }) {
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = 'running',
                provider_session_id = $3,
                lease_expires_at = NOW() + ($4 * INTERVAL '1 second'),
                heartbeat_at = NOW(),
                started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, providerSessionId, leaseSeconds],
      );
      return firstRow(result);
    },

    async heartbeat(id, { leaseOwner, leaseSeconds }) {
      const result = await pool.query(
        `UPDATE harness_attempts
            SET heartbeat_at = NOW(),
                lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, leaseSeconds],
      );
      return firstRow(result);
    },

    async recordLaunchReceipt(id, {
      leaseOwner,
      leaseGeneration,
      actualMachineId,
      executionTransport,
      remoteJobId = null,
      attestationStatus,
    }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('recordLaunchReceipt requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET actual_machine_id = $3,
                execution_transport = $4,
                remote_job_id = $5,
                machine_attestation_status = $6,
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $7
            AND status IN ('starting','running')
          RETURNING *`,
        [
          id,
          leaseOwner,
          actualMachineId,
          executionTransport,
          remoteJobId,
          attestationStatus,
          leaseGeneration,
        ],
      );
      return firstRow(result);
    },

    async reclaim(id, { leaseOwner, leaseSeconds }) {
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = 'starting',
                lease_owner = $2,
                lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
                lease_generation = lease_generation + 1,
                updated_at = NOW()
          WHERE id = $1
            AND status IN ('starting','running')
            AND lease_expires_at < NOW()
          RETURNING *`,
        [id, leaseOwner, leaseSeconds],
      );
      return firstRow(result);
    },

    async rotateCallbackSecret(id, {
      leaseOwner,
      leaseGeneration,
      callbackSecretHash,
    }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('rotateCallbackSecret requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET callback_secret_hash = $3,
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $4
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, callbackSecretHash, leaseGeneration],
      );
      return firstRow(result);
    },

    async complete(id, resultPayload, { leaseOwner = null } = {}) {
      if (!SUCCESS_TERMINAL_STATUSES.has(resultPayload?.status)) {
        throw new Error(`invalid successful terminal status: ${resultPayload?.status}`);
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = $2,
                result = $3,
                provider_session_id = COALESCE($4, provider_session_id),
                completed_at = NOW(),
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status NOT IN (${TERMINAL_SQL})
            AND ($5::text IS NULL OR lease_owner = $5)
          RETURNING *`,
        [
          id,
          resultPayload.status,
          resultPayload,
          resultPayload.provider_metadata?.session_id ?? null,
          leaseOwner,
        ],
      );
      const attempt = firstRow(result);
      return { attempt, deduped: attempt === null };
    },

    async fail(
      id,
      { code, message, status = 'failed' },
      { leaseOwner = null, leaseGeneration = null } = {},
    ) {
      if (!['failed', 'cancelled'].includes(status)) {
        throw new Error(`invalid failure status: ${status}`);
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = $2,
                error_code = $3,
                error_message = $4,
                completed_at = NOW(),
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status NOT IN (${TERMINAL_SQL})
            AND ($5::text IS NULL OR lease_owner = $5)
            AND ($6::integer IS NULL OR lease_generation = $6)
          RETURNING *`,
        [id, status, code ?? null, message ?? null, leaseOwner, leaseGeneration],
      );
      const attempt = firstRow(result);
      return { attempt, deduped: attempt === null };
    },

    async getById(id) {
      return firstRow(await pool.query('SELECT * FROM harness_attempts WHERE id=$1', [id]));
    },

    async getByRunHop(runId, hop) {
      return firstRow(await pool.query(
        'SELECT * FROM harness_attempts WHERE run_id=$1 AND hop=$2',
        [runId, hop],
      ));
    },

    async assertFreshRoleSession({ runId, attemptId, role, sessionId }) {
      if (!sessionId) throw new Error('sessionId is required for isolation check');
      const result = await pool.query(
        `SELECT id, role, provider_session_id
           FROM harness_attempts
          WHERE run_id=$1 AND provider_session_id=$2`,
        [runId, sessionId],
      );
      for (const existing of result.rows ?? []) {
        if (existing.id === attemptId) continue;
        if (existing.role !== role) {
          throw new Error(
            `role_session_reuse: ${role} cannot reuse ${existing.role} session ${sessionId}`,
          );
        }
        throw new Error(
          `cross_attempt_session_reuse: attempt ${attemptId} cannot reuse session from ${existing.id}`,
        );
      }
      return true;
    },
  });
}

export const __test__ = {
  TERMINAL_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  DERIVED_TIME_ROLES,
};
