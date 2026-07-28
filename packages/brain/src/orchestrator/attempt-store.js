import { createHash } from 'node:crypto';

/**
 * Harness Attempt authority store.
 *
 * 所有状态写保持单条 SQL 且显式更新 updated_at。migration 367 的数据库 trigger
 * 在同一事务中推进 event_version 并投影 lifecycle event；这里不得双写
 * harness_run_events，也不得把 task_bundle/result/error_message 投影进去。
 */
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
const MAX_FLEET_HEARTBEAT_CLOCK_SKEW_MS = 120_000;
const ATTEMPT_OWNERSHIP_SEAM_ID =
  'kernel.controller.attempt_ownership';
const ATTEMPT_OWNERSHIP_EFFECTS = Object.freeze({
  normal: Object.freeze({
    observed_outcome: 'confirmed',
    effect_code: 'single_controller_ownership_confirmed',
  }),
  violation: Object.freeze({
    observed_outcome: 'denied',
    effect_code: 'cross_session_callback_denied',
  }),
  recovery: Object.freeze({
    observed_outcome: 'recovered',
    effect_code: 'controller_ownership_recovered',
  }),
});

function firstRow(queryResult) {
  return queryResult.rows?.[0] ?? null;
}

export class FleetResultReceiptConflictError extends Error {
  constructor(message = 'conflicting Fleet result receipt') {
    super(message);
    this.name = 'FleetResultReceiptConflictError';
    this.code = 'fleet_result_conflict';
  }
}

export class FleetHeartbeatReceiptConflictError extends Error {
  constructor(message = 'conflicting Fleet heartbeat receipt') {
    super(message);
    this.name = 'FleetHeartbeatReceiptConflictError';
    this.code = 'fleet_heartbeat_conflict';
  }
}

export class FleetHeartbeatStaleError extends Error {
  constructor(message = 'stale Fleet heartbeat') {
    super(message);
    this.name = 'FleetHeartbeatStaleError';
    this.code = 'fleet_heartbeat_stale';
  }
}

function fleetReceiptConflict(message) {
  throw new FleetResultReceiptConflictError(message);
}

function fleetHeartbeatConflict(message) {
  throw new FleetHeartbeatReceiptConflictError(message);
}

function timestampMillis(value) {
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

function exactFleetHeartbeatReceipt(receipt, input) {
  return Boolean(receipt)
    && receipt.attempt_id === input.attemptId
    && receipt.run_id === input.runId
    && receipt.worker_id === input.workerId
    && receipt.job_id === input.jobId
    && receipt.lease_owner === input.leaseOwner
    && receipt.lease_generation === input.leaseGeneration
    && receipt.heartbeat_nonce === input.heartbeatNonce
    && receipt.request_sha256 === input.requestSha256
    && timestampMillis(receipt.observed_at) === timestampMillis(input.observedAt)
    && receipt.lease_seconds === input.leaseSeconds
    && (receipt.provider_session_id ?? null) === (input.providerSessionId ?? null);
}

function assertFleetHeartbeatAuthority(attempt, input) {
  const exact = Boolean(attempt)
    && attempt.id === input.attemptId
    && attempt.run_id === input.runId
    && attempt.execution_transport === 'fleet-worker'
    && attempt.actual_machine_id === input.workerId
    && attempt.remote_job_id === input.jobId
    && attempt.lease_owner === input.leaseOwner
    && attempt.lease_generation === input.leaseGeneration
    && attempt.machine_attestation_status === 'verified'
    && ['starting', 'running'].includes(attempt.status)
    && (
      !attempt.provider_session_id
      || !input.providerSessionId
      || attempt.provider_session_id === input.providerSessionId
    );
  if (!exact) fleetHeartbeatConflict('Fleet heartbeat authority changed');
}

function parsedTaskBundle(attempt) {
  if (attempt?.task_bundle && typeof attempt.task_bundle === 'object') {
    return attempt.task_bundle;
  }
  if (typeof attempt?.task_bundle !== 'string') return null;
  try {
    return JSON.parse(attempt.task_bundle);
  } catch {
    return null;
  }
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
  ).join(',')}}`;
}

function stableJsonSha256(value) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function assertFleetReceiptAuthority(attempt, input) {
  if (!attempt) fleetReceiptConflict('attempt missing during receipt transaction');
  const bundle = parsedTaskBundle(attempt);
  const channel = bundle?.result_channel;
  const bindings = channel?.bindings;
  const expectedResultPath = `/tmp/cecelia-prompts/${input.attemptId}.result.json`;
  const exact = (
    attempt.id === input.attemptId
    && attempt.run_id === input.runId
    && attempt.role === input.role
    && attempt.provider === input.provider
    && (attempt.skill_name ?? null) === (input.skillName ?? null)
    && (attempt.skill_version ?? null) === (input.skillVersion ?? null)
    && (attempt.skill_digest ?? null) === (input.skillDigest ?? null)
    && attempt.lease_owner === input.leaseOwner
    && attempt.lease_generation === input.leaseGeneration
    && attempt.execution_transport === 'fleet-worker'
    && attempt.actual_machine_id === input.workerId
    && attempt.remote_job_id === input.jobId
    && attempt.machine_attestation_status === 'verified'
    && (!attempt.provider_session_id || attempt.provider_session_id === input.providerSessionId)
    && bundle?.run_id === input.runId
    && bundle?.attempt_id === input.attemptId
    && bundle?.role === input.role
    && bundle?.inputs?.task_id === input.taskId
    && channel?.version === 'attempt-result-file/v1'
    && channel?.path === expectedResultPath
    && bindings?.task_id === input.taskId
    && bindings?.run_id === input.runId
    && bindings?.attempt_id === input.attemptId
    && bindings?.role === input.role
    && Number.isInteger(channel?.max_bytes)
    && channel.max_bytes > 0
    && input.resultBytes <= channel.max_bytes
    && stableJson(bundle) === stableJson(input.taskBundle)
    && stableJsonSha256(bundle) === input.taskBundleSha256
    && stableJsonSha256(input.resultAuthority) === input.resultAuthoritySha256
  );
  if (!exact) fleetReceiptConflict('Fleet result authority changed before terminal write');
}

function exactFleetReceipt(receipt, input) {
  return Boolean(receipt)
    && receipt.attempt_id === input.attemptId
    && receipt.run_id === input.runId
    && receipt.task_id === input.taskId
    && receipt.role === input.role
    && receipt.provider === input.resultProvider
    && receipt.requested_provider === input.provider
    && (receipt.provider_session_id ?? null) === (input.providerSessionId ?? null)
    && (receipt.skill_name ?? null) === (input.skillName ?? null)
    && (receipt.skill_version ?? null) === (input.skillVersion ?? null)
    && (receipt.skill_digest ?? null) === (input.skillDigest ?? null)
    && receipt.task_bundle_sha256 === input.taskBundleSha256
    && receipt.result_authority_sha256 === input.resultAuthoritySha256
    && stableJson(receipt.result_authority) === stableJson(input.resultAuthority)
    && receipt.worker_id === input.workerId
    && receipt.job_id === input.jobId
    && receipt.lease_owner === input.leaseOwner
    && receipt.lease_generation === input.leaseGeneration
    && receipt.delivery_id === input.deliveryId
    && receipt.result_nonce === input.resultNonce
    && receipt.result_sha256 === input.resultSha256
    && receipt.result_bytes === input.resultBytes
    && receipt.terminal_status === input.terminalStatus;
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

export function createAttemptStore(pool, { now = () => Date.now() } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('createAttemptStore requires a PostgreSQL pool');
  }
  if (typeof now !== 'function') {
    throw new Error('createAttemptStore now must be a function');
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

    async markRunning(
      id,
      {
        leaseOwner,
        providerSessionId,
        leaseSeconds,
        leaseGeneration = null,
      },
    ) {
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
            AND ($5::integer IS NULL OR lease_generation = $5)
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, providerSessionId, leaseSeconds, leaseGeneration],
      );
      return firstRow(result);
    },

    async heartbeat(
      id,
      {
        leaseOwner,
        leaseSeconds,
        leaseGeneration = null,
      },
    ) {
      const result = await pool.query(
        `UPDATE harness_attempts
            SET heartbeat_at = NOW(),
                lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND ($4::integer IS NULL OR lease_generation = $4)
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, leaseSeconds, leaseGeneration],
      );
      return firstRow(result);
    },

    async persistFleetHeartbeat(input) {
      if (typeof pool.connect !== 'function') {
        throw new Error('persistFleetHeartbeat requires a transactional PostgreSQL pool');
      }
      if (
        !/^[a-f0-9]{64}$/.test(input?.requestSha256 ?? '')
        || !Number.isInteger(input?.leaseGeneration)
        || input.leaseGeneration < 0
        || !Number.isInteger(input?.leaseSeconds)
        || input.leaseSeconds < 30
        || input.leaseSeconds > 600
        || !Number.isFinite(timestampMillis(input?.observedAt))
      ) {
        fleetHeartbeatConflict('Fleet heartbeat persistence input invalid');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = firstRow(await client.query(
          'SELECT * FROM harness_attempts WHERE id=$1 FOR UPDATE',
          [input.attemptId],
        ));
        if (!current) fleetHeartbeatConflict('Fleet heartbeat Attempt missing');
        const existing = firstRow(await client.query(
          `SELECT *
             FROM harness_heartbeat_receipts
            WHERE attempt_id=$1
              AND lease_generation=$2
              AND heartbeat_nonce=$3`,
          [
            input.attemptId,
            input.leaseGeneration,
            input.heartbeatNonce,
          ],
        ));
        if (existing) {
          if (!exactFleetHeartbeatReceipt(existing, input)) {
            fleetHeartbeatConflict('Fleet heartbeat nonce payload conflict');
          }
          await client.query('COMMIT');
          return { attempt: current, receipt: existing, deduped: true };
        }

        assertFleetHeartbeatAuthority(current, input);
        const currentTime = now();
        const currentTimeMs = currentTime instanceof Date
          ? currentTime.getTime()
          : currentTime;
        if (
          !Number.isFinite(currentTimeMs)
          || Math.abs(currentTimeMs - timestampMillis(input.observedAt))
            > MAX_FLEET_HEARTBEAT_CLOCK_SKEW_MS
        ) {
          throw new FleetHeartbeatStaleError();
        }
        if (input.providerSessionId) {
          const sessionRows = await client.query(
            `SELECT id, role, provider_session_id
               FROM harness_attempts
              WHERE run_id=$1 AND provider_session_id=$2`,
            [input.runId, input.providerSessionId],
          );
          const conflict = (sessionRows.rows ?? []).find(
            (attempt) => attempt.id !== input.attemptId,
          );
          if (conflict) {
            fleetHeartbeatConflict(
              `provider session belongs to another Attempt ${conflict.id}`,
            );
          }
        }

        const renewed = firstRow(await client.query(
          `UPDATE harness_attempts
              SET status = CASE WHEN $4::text IS NULL THEN status ELSE 'running' END,
                  provider_session_id = COALESCE($4, provider_session_id),
                  heartbeat_at = NOW(),
                  lease_expires_at = NOW() + ($5 * INTERVAL '1 second'),
                  started_at = CASE
                    WHEN $4::text IS NULL THEN started_at
                    ELSE COALESCE(started_at, NOW())
                  END,
                  updated_at = NOW()
            WHERE id = $1
              AND lease_owner = $2
              AND lease_generation = $3
              AND status IN ('starting','running')
              AND (
                provider_session_id IS NULL
                OR $4::text IS NULL
                OR provider_session_id = $4
              )
            RETURNING *`,
          [
            input.attemptId,
            input.leaseOwner,
            input.leaseGeneration,
            input.providerSessionId ?? null,
            input.leaseSeconds,
          ],
        ));
        if (!renewed) fleetHeartbeatConflict('Fleet heartbeat lost its lease');

        const receipt = firstRow(await client.query(
          `INSERT INTO harness_heartbeat_receipts (
             attempt_id, run_id, worker_id, job_id, lease_owner,
             lease_generation, heartbeat_nonce, request_sha256,
             observed_at, lease_seconds, provider_session_id,
             heartbeat_at, lease_expires_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
           )
           RETURNING *`,
          [
            input.attemptId,
            input.runId,
            input.workerId,
            input.jobId,
            input.leaseOwner,
            input.leaseGeneration,
            input.heartbeatNonce,
            input.requestSha256,
            input.observedAt,
            input.leaseSeconds,
            input.providerSessionId ?? null,
            renewed.heartbeat_at,
            renewed.lease_expires_at,
          ],
        ));
        if (!receipt) fleetHeartbeatConflict('Fleet heartbeat receipt insert returned no row');
        await client.query('COMMIT');
        return { attempt: renewed, receipt, deduped: false };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original persistence error.
        }
        if (error?.code === '23505') {
          throw new FleetHeartbeatReceiptConflictError(
            'Fleet heartbeat receipt uniqueness conflict',
          );
        }
        throw error;
      } finally {
        client.release();
      }
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

    async complete(
      id,
      resultPayload,
      { leaseOwner = null, leaseGeneration = null } = {},
    ) {
      if (!SUCCESS_TERMINAL_STATUSES.has(resultPayload?.status)) {
        throw new Error(`invalid successful terminal status: ${resultPayload?.status}`);
      }
      if (
        leaseOwner !== null
        && (!Number.isInteger(leaseGeneration) || leaseGeneration < 0)
      ) {
        throw new Error('complete requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = $2,
                result = $3,
                provider_session_id = COALESCE($4, provider_session_id),
                failure_class = $5,
                completed_at = NOW(),
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status NOT IN (${TERMINAL_SQL})
            AND ($6::text IS NULL OR lease_owner = $6)
            AND ($7::integer IS NULL OR lease_generation = $7)
          RETURNING *`,
        [
          id,
          resultPayload.status,
          resultPayload,
          resultPayload.provider_metadata?.session_id ?? null,
          resultPayload.failure_class ?? null,
          leaseOwner,
          leaseGeneration,
        ],
      );
      const attempt = firstRow(result);
      return { attempt, deduped: attempt === null };
    },

    async fail(
      id,
      { code, message, status = 'failed', failureClass = null },
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
                failure_class = $5,
                completed_at = NOW(),
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status NOT IN (${TERMINAL_SQL})
            AND ($6::text IS NULL OR lease_owner = $6)
            AND ($7::integer IS NULL OR lease_generation = $7)
          RETURNING *`,
        [
          id,
          status,
          code ?? null,
          message ?? null,
          failureClass,
          leaseOwner,
          leaseGeneration,
        ],
      );
      const attempt = firstRow(result);
      return { attempt, deduped: attempt === null };
    },

    async persistFleetResultReceipt(input) {
      if (typeof pool.connect !== 'function') {
        throw new Error('persistFleetResultReceipt requires a transactional PostgreSQL pool');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = firstRow(await client.query(
          'SELECT * FROM harness_attempts WHERE id=$1 FOR UPDATE',
          [input.attemptId],
        ));
        assertFleetReceiptAuthority(current, input);

        if (TERMINAL_STATUSES.includes(current.status)) {
          if (
            !current.result_receipt_id
            || current.result_sha256 !== input.resultSha256
            || current.lease_generation !== input.leaseGeneration
          ) {
            fleetReceiptConflict('terminal Attempt has a conflicting Fleet receipt');
          }
          const receipt = firstRow(await client.query(
            'SELECT * FROM harness_result_receipts WHERE receipt_id=$1',
            [current.result_receipt_id],
          ));
          if (!exactFleetReceipt(receipt, input)) {
            fleetReceiptConflict('persisted Fleet receipt bindings conflict');
          }
          await client.query('COMMIT');
          return { attempt: current, receipt, deduped: true };
        }

        if (!['starting', 'running'].includes(current.status)) {
          fleetReceiptConflict('Attempt is not eligible for a terminal Fleet receipt');
        }

        const receipt = firstRow(await client.query(
          `INSERT INTO harness_result_receipts (
             attempt_id, run_id, task_id, role, provider, requested_provider,
             provider_session_id,
             skill_name, skill_version, skill_digest,
             task_bundle_sha256, result_authority_sha256, result_authority,
             worker_id, job_id, lease_owner, lease_generation,
             delivery_id, result_nonce, result_sha256, result_bytes,
             terminal_status, result
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,$22,$23
           )
           RETURNING *`,
          [
            input.attemptId,
            input.runId,
            input.taskId,
            input.role,
            input.resultProvider,
            input.provider,
            input.providerSessionId ?? null,
            input.skillName ?? null,
            input.skillVersion ?? null,
            input.skillDigest ?? null,
            input.taskBundleSha256,
            input.resultAuthoritySha256,
            input.resultAuthority,
            input.workerId,
            input.jobId,
            input.leaseOwner,
            input.leaseGeneration,
            input.deliveryId,
            input.resultNonce,
            input.resultSha256,
            input.resultBytes,
            input.terminalStatus,
            input.result,
          ],
        ));
        if (!receipt) fleetReceiptConflict('Fleet receipt insert returned no row');

        const error = input.result?.error;
        const errorCode = typeof error === 'object' && error
          ? error.code ?? null
          : (['failed', 'cancelled'].includes(input.terminalStatus) ? 'provider_failed' : null);
        const errorMessage = typeof error === 'string'
          ? error
          : error?.message ?? null;
        const persistedAttempt = firstRow(await client.query(
          `UPDATE harness_attempts
              SET status = $2,
                  result = $3,
                  provider_session_id = COALESCE($4, provider_session_id),
                  failure_class = $5,
                  error_code = $6,
                  error_message = $7,
                  completed_at = NOW(),
                  lease_expires_at = NULL,
                  result_receipt_id = $8,
                  result_sha256 = $9,
                  result_bytes = $10,
                  result_delivery_id = $11,
                  result_nonce = $12,
                  result_worker_id = $13,
                  result_persisted_at = $14,
                  updated_at = NOW()
            WHERE id = $1
              AND status IN ('starting','running')
              AND lease_owner = $15
              AND lease_generation = $16
              AND result_receipt_id IS NULL
            RETURNING *`,
          [
            input.attemptId,
            input.terminalStatus,
            input.result,
            input.providerSessionId ?? null,
            input.result?.failure_class ?? null,
            errorCode,
            errorMessage,
            receipt.receipt_id,
            input.resultSha256,
            input.resultBytes,
            input.deliveryId,
            input.resultNonce,
            input.workerId,
            receipt.persisted_at,
            input.leaseOwner,
            input.leaseGeneration,
          ],
        ));
        if (!persistedAttempt) {
          fleetReceiptConflict('Attempt terminal write lost its lease or generation');
        }
        await client.query('COMMIT');
        return { attempt: persistedAttempt, receipt, deduped: false };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original persistence error.
        }
        if (error?.code === '23505') {
          throw new FleetResultReceiptConflictError('Fleet receipt uniqueness conflict');
        }
        throw error;
      } finally {
        client.release();
      }
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

    async getLatestCommanderAttempt(runId) {
      return firstRow(await pool.query(
        `SELECT id,run_id,hop,phase,role,provider,account_id,
                machine_id,requested_machine_id,actual_machine_id,
                task_bundle,result,status,provider_session_id,
                failure_class,error_code,logical_cycle_id,attempt_kind,
                retry_of_attempt_id,restart_reason,workstream_key,
                created_at,updated_at,completed_at
           FROM harness_attempts
          WHERE run_id=$1
            AND role='commander'
          ORDER BY hop DESC
          LIMIT 1`,
        [runId],
      ));
    },

    async listCommanderFailoverLineage(runId, logicalCycleId) {
      const result = await pool.query(
        `SELECT id,run_id,hop,provider,account_id,requested_machine_id,
                actual_machine_id,status,failure_class,error_code,
                logical_cycle_id,attempt_kind,retry_of_attempt_id,
                restart_reason,created_at,completed_at
           FROM harness_attempts
          WHERE run_id=$1
            AND role='commander'
            AND logical_cycle_id=$2
          ORDER BY hop ASC`,
        [runId, logicalCycleId],
      );
      return result.rows;
    },

    async listFailedExecutionTargets(runId, role) {
      const result = await pool.query(
        `SELECT provider, account_id, requested_machine_id
           FROM harness_attempts
          WHERE run_id=$1 AND role=$2 AND status IN ('failed','cancelled')
          ORDER BY hop`,
        [runId, role],
      );
      return result.rows.map((row) => ({
        provider: row.provider,
        account: row.account_id,
        machine: row.requested_machine_id,
      }));
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

function attemptOwnershipError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validOwnershipTarget(target) {
  return (
    target
    && typeof target.attempt_id === 'string'
    && typeof target.lease_owner === 'string'
    && target.lease_owner.length > 0
    && typeof target.callback_owner === 'string'
    && target.callback_owner.length > 0
    && Number.isInteger(target.lease_generation)
    && target.lease_generation >= 0
    && SUCCESS_TERMINAL_STATUSES.has(target.result?.status)
    && target.result?.attempt_id === target.attempt_id
  );
}

export function createAttemptOwnershipEquivalenceSeam({
  attemptStore,
  ownershipAuthority,
  effectSigner,
} = {}) {
  if (typeof effectSigner?.signEffectResult !== 'function') {
    throw attemptOwnershipError('seam_effect_signer_unavailable');
  }
  if (
    ownershipAuthority?.owner_service !== ATTEMPT_OWNERSHIP_SEAM_ID
    || typeof ownershipAuthority?.loadTarget !== 'function'
    || typeof ownershipAuthority?.snapshot !== 'function'
    || typeof ownershipAuthority?.loadPredecessorOwnershipBinding
      !== 'function'
  ) {
    throw attemptOwnershipError(
      'attempt_ownership_authority_port_unavailable',
    );
  }
  if (
    typeof attemptStore?.complete !== 'function'
    || typeof attemptStore?.getById !== 'function'
  ) {
    throw attemptOwnershipError('attempt_ownership_store_unavailable');
  }

  return Object.freeze({
    owner_service: ATTEMPT_OWNERSHIP_SEAM_ID,

    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    }) {
      signal?.throwIfAborted();
      if (
        cell?.seam_id !== ATTEMPT_OWNERSHIP_SEAM_ID
        || resource?.resource_id !== grant?.resource_id
        || resource?.resource_ref !== grant?.resource_ref
      ) {
        throw attemptOwnershipError(
          'attempt_ownership_equivalence_resource_invalid',
        );
      }
      const effect = ATTEMPT_OWNERSHIP_EFFECTS[cell.scenario];
      if (!effect) {
        throw attemptOwnershipError(
          'attempt_ownership_equivalence_scenario_invalid',
        );
      }
      const authorityResource = Object.freeze({
        resource_id: resource.resource_id,
        resource_ref: resource.resource_ref,
      });
      const target = await ownershipAuthority.loadTarget({
        cell,
        grant,
        resource: authorityResource,
        signal,
      });
      signal?.throwIfAborted();
      if (
        !validOwnershipTarget(target)
        || target.attempt_id !== grant.attempt_id
      ) {
        throw attemptOwnershipError(
          'attempt_ownership_target_unavailable',
        );
      }
      const shouldOwn = cell.scenario !== 'violation';
      if (
        (target.callback_owner === target.lease_owner) !== shouldOwn
      ) {
        throw attemptOwnershipError(
          'attempt_ownership_scenario_invalid',
        );
      }

      if (cell.scenario === 'recovery') {
        const predecessorGrantId = predecessor?.grant?.grant_id;
        const predecessorReceiptId = predecessor?.receipt?.receipt_id;
        const binding =
          await ownershipAuthority.loadPredecessorOwnershipBinding({
            cell,
            grant,
            predecessor,
            signal,
          });
        signal?.throwIfAborted();
        if (
          !predecessorGrantId
          || !predecessorReceiptId
          || binding?.owner_service !== ATTEMPT_OWNERSHIP_SEAM_ID
          || binding?.predecessor_grant_id !== predecessorGrantId
          || binding?.predecessor_receipt_id !== predecessorReceiptId
          || binding?.denial_code !== 'cross_session_callback_denied'
          || binding?.evidence_ref
            !== `db:kernel-equivalence-receipts/${predecessorReceiptId}`
        ) {
          throw attemptOwnershipError(
            'attempt_ownership_recovery_unproven',
          );
        }
      } else if (predecessor !== null) {
        throw attemptOwnershipError(
          'attempt_ownership_predecessor_invalid',
        );
      }

      const current = await attemptStore.getById(target.attempt_id);
      signal?.throwIfAborted();
      if (
        current?.id !== target.attempt_id
        || current.run_id !== grant.run_id
        || !['starting', 'running'].includes(current.status)
        || current.lease_owner !== target.lease_owner
        || current.lease_generation !== target.lease_generation
      ) {
        throw attemptOwnershipError(
          'attempt_ownership_target_changed',
        );
      }
      const before = await ownershipAuthority.snapshot({
        phase: 'before',
        cell,
        grant,
        target,
        signal,
      });
      signal?.throwIfAborted();
      const outcome = await attemptStore.complete(
        target.attempt_id,
        target.result,
        {
          leaseOwner: target.callback_owner,
          leaseGeneration: target.lease_generation,
        },
      );
      signal?.throwIfAborted();
      const persisted = await attemptStore.getById(target.attempt_id);
      signal?.throwIfAborted();
      const completed = (
        outcome?.attempt?.id === target.attempt_id
        && SUCCESS_TERMINAL_STATUSES.has(persisted?.status)
        && stableJsonSha256(persisted?.result)
          === stableJsonSha256(target.result)
      );
      const denied = (
        outcome?.attempt == null
        && outcome?.deduped === true
        && persisted?.status === current.status
        && stableJsonSha256(persisted?.result)
          === stableJsonSha256(current.result)
      );
      if (
        (cell.scenario === 'violation' && !denied)
        || (cell.scenario !== 'violation' && !completed)
      ) {
        throw attemptOwnershipError(
          'attempt_ownership_outcome_unexpected',
        );
      }
      const after = await ownershipAuthority.snapshot({
        phase: 'after',
        cell,
        grant,
        target,
        outcome,
        persisted,
        signal,
      });
      signal?.throwIfAborted();

      return effectSigner.signEffectResult({
        cell,
        grant,
        observation: {
          observed_outcome: effect.observed_outcome,
          effect_code: effect.effect_code,
          before_hash: stableJsonSha256(before),
          after_hash: stableJsonSha256(after),
        },
        predecessor,
      });
    },

    async cancel({ signal } = {}) {
      return { confirmed: signal?.aborted === true };
    },

    async cleanup() {
      return { confirmed: true };
    },
  });
}

export const __test__ = {
  TERMINAL_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  DERIVED_TIME_ROLES,
};
