/**
 * Harness Attempt authority store.
 *
 * 所有状态写保持单条 SQL 且显式更新 updated_at。migration 367 的数据库 trigger
 * 在同一事务中推进 event_version 并投影 lifecycle event；这里不得双写
 * harness_run_events，也不得把 task_bundle/result/error_message 投影进去。
 */
import { isDeepStrictEqual } from 'node:util';

import { normalizeFailureSignature } from './convergence-signatures.js';

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

function callbackGateVerdict(result) {
  switch (result.status) {
    case 'completed':
      return 'allow';
    case 'completed_with_concerns':
      return 'allow:concerns';
    case 'needs_context':
      return 'deny:NEEDS_CONTEXT';
    case 'blocked':
      return 'deny:BLOCKED';
    case 'failed':
      return result.failure_class === 'semantic_refusal'
        ? 'deny:SEMANTIC_REFUSAL'
        : 'deny:FAILED';
    case 'cancelled':
      return 'deny:CANCELLED';
    default:
      throw new Error(`invalid callback terminal status: ${result.status}`);
  }
}

function callbackError(result) {
  if (typeof result.error === 'string') {
    return { code: 'provider_failed', message: result.error };
  }
  return {
    code: result.error?.code ?? null,
    message: result.error?.message ?? null,
  };
}

function callbackEventDetail(attempt, result, leaseGeneration) {
  const failureSignature = normalizeFailureSignature(
    result.failure_signature ?? result.decision?.failure_signature,
  );
  const plannerGitVerification = result.server_verification?.planner_git_artifact;
  return {
    run_id: attempt.run_id,
    attempt_id: attempt.id,
    lease_owner: attempt.lease_owner,
    lease_generation: leaseGeneration,
    role: attempt.role,
    hop: attempt.hop,
    status: result.status,
    summary: result.summary ?? '',
    context_question: result.decision?.reason ?? result.summary ?? null,
    failure_class: result.failure_class ?? null,
    ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
    artifacts: result.artifacts ?? [],
    ...(plannerGitVerification == null
      ? {}
      : {
          server_verification: {
            planner_git_artifact: plannerGitVerification,
          },
        }),
  };
}

function attemptTaskBundle(attempt) {
  if (attempt?.task_bundle && typeof attempt.task_bundle === 'object') {
    return attempt.task_bundle;
  }
  if (typeof attempt?.task_bundle !== 'string') return {};
  try {
    return JSON.parse(attempt.task_bundle);
  } catch {
    return {};
  }
}

export function normalizeRoleVerdict(role, outcome) {
  const value = String(outcome ?? '').trim().toUpperCase();
  if (role === 'reviewer') {
    return ['PASS', 'APPROVED'].includes(value) ? 'APPROVED' : 'REVISION_REQUESTED';
  }
  if (role === 'evaluator') {
    if (value === 'FIXED') return 'FIXED';
    return ['PASS', 'PASS_WITH_CONCERNS'].includes(value) ? 'PASS' : 'FAIL';
  }
  return value;
}

function callbackRoleVerdictProjection(attempt, result) {
  if (attempt.role === 'commander') {
    if (result.status !== 'completed' || !result.decision) return null;
    return {
      action: 'commander.directive_proposed',
      observed: {
        commander_attempt_id: attempt.id,
        event_cursor: result.decision.event_cursor,
      },
      phase: attempt.phase,
      gateVerdict: null,
      detail: {
        attempt_id: attempt.id,
        directive: result.decision,
      },
    };
  }
  if (!result.decision || !['reviewer', 'evaluator'].includes(attempt.role)) return null;
  if (!['completed', 'completed_with_concerns'].includes(result.status)) return null;

  const inputs = attemptTaskBundle(attempt).inputs ?? {};
  const verdict = normalizeRoleVerdict(attempt.role, result.decision.outcome);
  const failureSignature = normalizeFailureSignature(result.decision.failure_signature);
  const detail = attempt.role === 'reviewer'
    ? {
        attempt_id: attempt.id,
        verdict,
        rn: inputs.contract_round ?? null,
        contract_sha: inputs.contract_sha ?? null,
        feedback: result.decision.reason,
      }
    : {
        attempt_id: attempt.id,
        verdict,
        pr_head_sha: inputs.pull_request?.head_sha ?? null,
        failure_class: result.decision.failure_class ?? null,
        ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
        feedback: result.decision.reason,
      };
  const allowed = ['APPROVED', 'PASS', 'FIXED'].includes(verdict);
  return {
    action: attempt.role === 'reviewer' ? 'verdict:reviewer' : 'verdict:evaluate',
    observed: { attempt_id: attempt.id, role: attempt.role },
    phase: attempt.role === 'reviewer' ? 'gan' : 'evaluate',
    gateVerdict: allowed ? 'allow' : `deny:${verdict.toLowerCase()}`,
    detail,
  };
}

function verifiedPullRequestArtifact(attempt, result) {
  if (attempt.role !== 'generator') return null;
  return (result.artifacts ?? []).find((artifact) => (
    artifact?.type === 'pull_request'
    && artifact.verification_status === 'verified'
    && typeof artifact.url === 'string'
    && typeof artifact.head_sha === 'string'
  )) ?? null;
}

async function appendGeneratorFixProjection(client, attempt, result, pullRequest) {
  if (attempt.role !== 'generator' || pullRequest == null) return;
  if (!['completed', 'completed_with_concerns'].includes(result.status)) return;

  const context = firstRow(await client.query(
    `SELECT observed->>'trigger_sha' AS trigger_sha
       FROM orchestrator_decision_log
      WHERE run_id=$1::uuid
        AND hop=$2
        AND action='spawn:generator-fix'
      LIMIT 1`,
    [attempt.run_id, attempt.hop],
  ));
  if (!context) return;

  const observed = {
    attempt_id: attempt.id,
    trigger_hop: attempt.hop,
    pr_head_sha: pullRequest.head_sha,
    provider: result.provider_metadata?.provider ?? attempt.provider ?? null,
  };
  const detail = {
    attempt_id: attempt.id,
    pr_head_sha: pullRequest.head_sha,
    status: result.status,
    verification_status: 'verified',
    trigger_sha: context.trigger_sha ?? null,
  };
  await client.query(
    `WITH next_hop AS (
       SELECT COALESCE(MAX(hop), 0) + 1 AS hop
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
     )
     INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1::uuid, next_hop.hop, $2::jsonb, 'generate', 'allow',
            'verdict:generator-fix-callback', $3::jsonb
       FROM next_hop
      WHERE NOT EXISTS (
        SELECT 1
          FROM orchestrator_decision_log
         WHERE run_id=$1::uuid
           AND action='verdict:generator-fix-callback'
           AND detail->>'attempt_id'=$4::text
      )
     RETURNING hop`,
    [
      attempt.run_id,
      JSON.stringify(observed),
      JSON.stringify(detail),
      attempt.id,
    ],
  );
}

function firstRow(queryResult) {
  return queryResult.rows?.[0] ?? null;
}

const CREATE_ATTEMPT_WINNER_READ_ATTEMPTS = 3;
const CREATE_ATTEMPT_WINNER_READ_DELAY_MS = 5;

async function readConcurrentAttemptWinner(pool, runId, hop) {
  for (let attempt = 0; attempt < CREATE_ATTEMPT_WINNER_READ_ATTEMPTS; attempt += 1) {
    const winner = firstRow(await pool.query(
      `SELECT attempt.*
         FROM harness_attempts attempt
         JOIN initiative_runs run
           ON run.id = attempt.run_id
          AND run.orchestrator_version = 'v2'
          AND run.phase NOT IN ('done','failed')
        WHERE attempt.run_id=$1
          AND attempt.hop=$2
        FOR KEY SHARE OF run`,
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
        `WITH guarded_run AS (
           SELECT id
             FROM initiative_runs
            WHERE id = $2
              AND orchestrator_version = 'v2'
              AND phase NOT IN ('done','failed')
            FOR KEY SHARE
         ),
         inserted AS (
           INSERT INTO harness_attempts (
             id, run_id, hop, phase, role, provider, account_id, machine_id,
             requested_machine_id, local_container_naming,
             skill_name, skill_version, skill_digest, task_bundle,
             callback_secret_hash, logical_cycle_id, attempt_kind, retry_of_attempt_id,
             restart_reason, workstream_key, time_derived
           )
           SELECT
             $1, guarded_run.id, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             $15,$16,$17,$18,$19,$20,$21
             FROM guarded_run
           ON CONFLICT (run_id, hop) DO NOTHING
           RETURNING *
         )
         SELECT * FROM inserted
         UNION ALL
         SELECT attempt.*
           FROM harness_attempts attempt
           JOIN guarded_run ON guarded_run.id = attempt.run_id
          WHERE attempt.hop=$3
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
      const winner = firstRow(result)
        ?? await readConcurrentAttemptWinner(pool, input.runId, input.hop);
      if (!winner) {
        throw new Error(`Kernel run is terminal or missing: ${input.runId}`);
      }
      return winner;
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

    async markRunning(id, {
      leaseOwner,
      leaseGeneration,
      providerSessionId,
      leaseSeconds,
    }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('markRunning requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET status = 'running',
                provider_session_id = $4,
                lease_expires_at = NOW() + ($5 * INTERVAL '1 second'),
                heartbeat_at = NOW(),
                started_at = COALESCE(started_at, NOW()),
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $3
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, leaseGeneration, providerSessionId, leaseSeconds],
      );
      return firstRow(result);
    },

    async heartbeat(id, { leaseOwner, leaseGeneration, leaseSeconds }) {
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('heartbeat requires leaseGeneration');
      }
      const result = await pool.query(
        `UPDATE harness_attempts
            SET heartbeat_at = NOW(),
                lease_expires_at = NOW() + ($4 * INTERVAL '1 second'),
                updated_at = NOW()
          WHERE id = $1
            AND lease_owner = $2
            AND lease_generation = $3
            AND status IN ('starting','running')
          RETURNING *`,
        [id, leaseOwner, leaseGeneration, leaseSeconds],
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
                failure_class = $5,
                completed_at = NOW(),
                lease_expires_at = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND status NOT IN (${TERMINAL_SQL})
            AND ($6::text IS NULL OR lease_owner = $6)
          RETURNING *`,
        [
          id,
          resultPayload.status,
          resultPayload,
          resultPayload.provider_metadata?.session_id ?? null,
          resultPayload.failure_class ?? null,
          leaseOwner,
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

    /**
     * Authoritative callback boundary. The Attempt terminal projection and the
     * append-only callback event either commit together or not at all.
     */
    async recordCallbackTerminal({
      attemptId,
      runId,
      leaseOwner,
      leaseGeneration,
      result,
    }) {
      if (typeof pool.connect !== 'function') {
        throw new Error('recordCallbackTerminal requires a transactional PostgreSQL pool');
      }
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('recordCallbackTerminal requires leaseGeneration');
      }
      const gateVerdict = callbackGateVerdict(result);
      const client = await pool.connect();
      let transactionOpen = false;
      const rollbackConflict = async (conflict) => {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { attempt: null, deduped: false, conflict };
      };
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const attempt = firstRow(await client.query(
          `WITH decision_lock AS MATERIALIZED (
             SELECT pg_advisory_xact_lock(hashtext($2::text)) AS locked
           ),
           locked_run AS MATERIALIZED (
             SELECT run.id, run.phase
               FROM decision_lock
               JOIN initiative_runs run ON run.id=$2::uuid
              WHERE run.orchestrator_version='v2'
              FOR UPDATE OF run
           )
           SELECT attempt.*, locked_run.phase AS run_phase
             FROM locked_run
             JOIN harness_attempts attempt
               ON attempt.run_id=locked_run.id
            WHERE attempt.id=$1
            FOR UPDATE OF attempt`,
          [attemptId, runId],
        ));
        if (!attempt) return await rollbackConflict('attempt_identity_mismatch');
        if (attempt.lease_owner !== leaseOwner) {
          return await rollbackConflict('lease_owner_mismatch');
        }
        if (attempt.lease_generation !== leaseGeneration) {
          return await rollbackConflict('lease_generation_mismatch');
        }

        const isTerminal = TERMINAL_STATUSES.includes(attempt.status);
        const exactDuplicate = isTerminal
          && attempt.status === result.status
          && isDeepStrictEqual(attempt.result, result);
        if (
          ['done', 'failed'].includes(attempt.run_phase)
          && !isTerminal
        ) {
          return await rollbackConflict('parent_run_terminal');
        }
        if (isTerminal && !exactDuplicate) {
          return await rollbackConflict('terminal_payload_conflict');
        }

        let terminalAttempt = attempt;
        if (!isTerminal) {
          const error = callbackError(result);
          terminalAttempt = firstRow(await client.query(
            `UPDATE harness_attempts
                SET status=$5,
                    result=$6::jsonb,
                    provider_session_id=COALESCE($7, provider_session_id),
                    failure_class=$8,
                    error_code=$9,
                    error_message=$10,
                    completed_at=NOW(),
                    lease_expires_at=NULL,
                    updated_at=NOW()
              WHERE id=$1
                AND run_id=$2
                AND lease_owner=$3
                AND lease_generation=$4
                AND status NOT IN (${TERMINAL_SQL})
              RETURNING *`,
            [
              attemptId,
              runId,
              leaseOwner,
              leaseGeneration,
              result.status,
              JSON.stringify(result),
              result.provider_metadata?.session_id ?? null,
              result.failure_class ?? null,
              error.code,
              error.message,
            ],
          ));
          if (!terminalAttempt) {
            return await rollbackConflict('attempt_changed_before_terminal_write');
          }
        }

        const detail = callbackEventDetail(terminalAttempt, result, leaseGeneration);
        await client.query(
          `WITH next_hop AS (
             SELECT COALESCE(MAX(hop), 0) + 1 AS hop
               FROM orchestrator_decision_log
              WHERE run_id=$1::uuid
           )
           INSERT INTO orchestrator_decision_log
             (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
           SELECT $1::uuid, next_hop.hop, $2::jsonb, $3, $4,
                  'verdict:attempt_callback', $5::jsonb
             FROM next_hop
            WHERE NOT EXISTS (
              SELECT 1
                FROM orchestrator_decision_log
               WHERE run_id=$1::uuid
                 AND action='verdict:attempt_callback'
                 AND detail->>'attempt_id'=$6::text
            )
           RETURNING hop`,
          [
            runId,
            JSON.stringify({
              attempt_id: attemptId,
              role: terminalAttempt.role,
              status: result.status,
            }),
            terminalAttempt.phase,
            gateVerdict,
            JSON.stringify(detail),
            attemptId,
          ],
        );

        // All role-specific projections were committed with the first terminal
        // write. An exact retry only confirms the generic callback receipt; it
        // must never replay mutable projections into a run that advanced.
        if (!isTerminal) {
          const roleProjection = callbackRoleVerdictProjection(terminalAttempt, result);
          if (roleProjection) {
            await client.query(
              `WITH next_hop AS (
                 SELECT COALESCE(MAX(hop), 0) + 1 AS hop
                   FROM orchestrator_decision_log
                  WHERE run_id=$1::uuid
               )
               INSERT INTO orchestrator_decision_log
                 (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
               SELECT $1::uuid, next_hop.hop, $2::jsonb, $3, $4, $5, $6::jsonb
                 FROM next_hop
                WHERE NOT EXISTS (
                  SELECT 1
                    FROM orchestrator_decision_log
                   WHERE run_id=$1::uuid
                     AND action=$5
                     AND detail->>'attempt_id'=$7::text
                )
               RETURNING hop`,
              [
                runId,
                JSON.stringify(roleProjection.observed),
                roleProjection.phase,
                roleProjection.gateVerdict,
                roleProjection.action,
                JSON.stringify(roleProjection.detail),
                attemptId,
              ],
            );
          }

          const pullRequest = verifiedPullRequestArtifact(terminalAttempt, result);
          await appendGeneratorFixProjection(client, terminalAttempt, result, pullRequest);
          if (pullRequest) {
            const projection = await client.query(
              `UPDATE initiative_runs
                  SET pr_url=$2, updated_at=NOW()
                WHERE id=$1
                  AND phase NOT IN ('done', 'failed')
                RETURNING id`,
              [runId, pullRequest.url],
            );
            if (!firstRow(projection)) {
              throw new Error(`generator PR projection lost run authority: ${runId}`);
            }
          }
        }

        await client.query('COMMIT');
        transactionOpen = false;
        return { attempt: terminalAttempt, deduped: exactDuplicate };
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // Preserve the authoritative persistence failure.
          }
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
          WHERE run_id=$1
            AND role=$2
            AND (
              status IN ('failed','cancelled')
              OR (status='blocked' AND failure_class='infrastructure_blocked')
            )
            AND (
              error_code IS NULL
              OR error_code NOT IN (
                'worker_attempt_missing_after_lease',
                'worker_attempt_replacement_required_after_lease'
              )
            )
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

export const __test__ = {
  TERMINAL_STATUSES,
  SUCCESS_TERMINAL_STATUSES,
  DERIVED_TIME_ROLES,
};
