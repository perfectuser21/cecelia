import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { isAbsolute, parse, resolve } from 'node:path';

import { computeFleetAuthoritySha256 } from '../orchestrator/fleet-callback-auth.js';
import {
  createBrainTrustedExecutionClient,
  createUnixSocketTrustedExecutionTransport,
} from './kernel-equivalence-trusted-execution-client.js';
import {
  isCanonicalTrustedExecutionPlan,
} from './kernel-equivalence-canonical-plan.js';

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const GRANT_REF_PATTERN =
  /^kernel-equivalence-grant:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const MAXIMUM_GRANT_TTL_SECONDS = 3_600;
const CONTROLLER_OWNER = 'brain.kernel_equivalence.controller';

export class KernelProductionCoordinatorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelProductionCoordinatorError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelProductionCoordinatorError(code);
}

function validSocketPath(value) {
  return (
    typeof value === 'string'
    && isAbsolute(value)
    && resolve(value) === value
    && value !== parse(value).root
    && !/[\0\r\n]/.test(value)
  );
}

function validateGrantIssuer(value) {
  if (
    !Object.isFrozen(value)
    || value?.owner_service !== 'brain.kernel_equivalence.grant_issuer'
    || value?.capability_id
      !== 'brain.kernel_equivalence.protected_grant_issuer.v1'
    || typeof value?.issueProtectedGrant !== 'function'
    || typeof value?.cleanupExpiredGrants !== 'function'
  ) {
    fail('production_controller_grant_issuer_invalid');
  }
}

function pinPlan(plan) {
  let snapshot;
  try {
    snapshot = structuredClone(plan);
  } catch {
    fail('production_controller_plan_invalid');
  }
  if (
    snapshot?.schema_version !== 'kernel-equivalence-drill-plan/v1'
    || snapshot?.behavior_count !== 11
    || !Array.isArray(snapshot.cells)
    || snapshot.cells.length !== 99
    || !isCanonicalTrustedExecutionPlan(snapshot)
  ) {
    fail('production_controller_plan_invalid');
  }
  return Object.freeze(new Map(snapshot.cells.map((cell) => [
    cell.cell_id,
    Object.freeze(cell),
  ])));
}

function stableCode(error, fallback) {
  return CODE_PATTERN.test(error?.code ?? '') ? error.code : fallback;
}

function timestamp(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateAuthority(row, {
  cells,
  brainVersion,
  engineVersion,
  now,
}) {
  const cell = cells.get(row?.cell_id);
  const expiresAt = timestamp(row?.expires_at);
  const taskBundle = typeof row?.task_bundle === 'string'
    ? (() => {
      try {
        return JSON.parse(row.task_bundle);
      } catch {
        return null;
      }
    })()
    : row?.task_bundle;
  let taskBundleSha256 = null;
  try {
    taskBundleSha256 = computeFleetAuthoritySha256(taskBundle);
  } catch {
    taskBundleSha256 = null;
  }
  if (
    !UUID_PATTERN.test(row?.case_id ?? '')
    || !UUID_PATTERN.test(row?.run_id ?? '')
    || !UUID_PATTERN.test(row?.attempt_id ?? '')
    || !UUID_PATTERN.test(row?.result_receipt_id ?? '')
    || !cell
    || cell.behavior_id !== row.behavior_id
    || cell.provider !== row.provider
    || cell.scenario !== row.scenario
    || cell.seam_id !== row.seam_id
    || cell.adapter_id !== row.adapter_id
    || row.brain_version !== brainVersion
    || row.engine_version !== engineVersion
    || !SHA_PATTERN.test(row.artifact_sha ?? '')
    || row.resource_type !== 'ephemeral_run'
    || row.resource_id !== row.attempt_id
    || row.resource_ref !== `${row.resource_prefix}${row.attempt_id}`
    || typeof row.provider_session_id !== 'string'
    || row.provider_session_id.length === 0
    || typeof row.actual_machine_id !== 'string'
    || row.actual_machine_id.length === 0
    || row.execution_transport !== 'fleet-worker'
    || typeof row.remote_job_id !== 'string'
    || row.remote_job_id.length === 0
    || !HASH_PATTERN.test(row.task_bundle_sha256 ?? '')
    || taskBundleSha256 !== row.task_bundle_sha256
    || taskBundle?.inputs?.workspace_spec?.expected_head_sha
      !== row.artifact_sha
    || expiresAt == null
    || expiresAt <= now
  ) {
    fail('production_controller_authority_invalid');
  }
  return Object.freeze({
    ...Object.fromEntries([
      'adapter_id',
      'artifact_sha',
      'attempt_id',
      'behavior_id',
      'brain_version',
      'case_id',
      'cell_id',
      'engine_version',
      'expires_at',
      'provider',
      'resource_id',
      'resource_prefix',
      'resource_ref',
      'run_id',
      'scenario',
      'seam_id',
    ].map((field) => [field, row[field]])),
    cell,
  });
}

async function bindAndLoadAuthority(pool, caseId, context) {
  const result = await pool.query(
    `WITH authoritative AS (
       SELECT
         cases.case_id,
         receipts.receipt_id AS result_receipt_id,
         attempts.provider_session_id,
         attempts.actual_machine_id,
         attempts.execution_transport,
         attempts.remote_job_id,
         receipts.task_bundle_sha256,
         cases.artifact_sha
       FROM kernel_equivalence_production_cases cases
       JOIN kernel_equivalence_production_case_leases leases
         ON leases.case_id = cases.case_id
        AND leases.owner_id
              = 'brain.kernel_equivalence.production_cases'
        AND leases.state = 'prepared'
        AND leases.lease_expires_at > clock_timestamp()
       JOIN harness_attempts attempts
         ON attempts.id = cases.attempt_id
        AND attempts.run_id = cases.run_id
       JOIN harness_result_receipts receipts
         ON receipts.receipt_id = attempts.result_receipt_id
        AND receipts.attempt_id = attempts.id
        AND receipts.run_id = attempts.run_id
       WHERE cases.case_id = $1::uuid
         AND cases.brain_version = $2
         AND cases.engine_version = $3
         AND cases.expires_at > clock_timestamp()
         AND cases.provider = attempts.provider
         AND cases.provider = receipts.provider
         AND cases.provider = receipts.requested_provider
         AND attempts.provider_session_id IS NOT NULL
         AND receipts.provider_session_id = attempts.provider_session_id
         AND attempts.actual_machine_id IS NOT NULL
         AND attempts.execution_transport = 'fleet-worker'
         AND attempts.remote_job_id IS NOT NULL
         AND attempts.machine_attestation_status = 'verified'
         AND attempts.status IN ('completed', 'completed_with_concerns')
         AND attempts.task_bundle
               #>> '{inputs,workspace_spec,expected_head_sha}'
               = cases.artifact_sha
         AND cases.resource_type = 'ephemeral_run'
         AND cases.resource_id = attempts.id::text
         AND cases.resource_ref =
               cases.resource_prefix || attempts.id::text
     ), bound AS (
       INSERT INTO kernel_equivalence_production_case_bindings
         (case_id, result_receipt_id, provider_session_id,
          actual_machine_id, execution_transport, remote_job_id,
          task_bundle_sha256, artifact_sha)
       SELECT
         case_id, result_receipt_id, provider_session_id,
         actual_machine_id, execution_transport, remote_job_id,
         task_bundle_sha256, artifact_sha
       FROM authoritative
       ON CONFLICT (case_id) DO NOTHING
       RETURNING case_id
     )
     SELECT
       cases.case_id, cases.cell_id, cases.behavior_id, cases.provider,
       cases.scenario, cases.seam_id, cases.adapter_id, cases.run_id,
       cases.attempt_id, cases.artifact_sha, cases.brain_version,
       cases.engine_version, cases.resource_type, cases.resource_prefix,
       cases.resource_id, cases.resource_ref, cases.expires_at,
       bindings.result_receipt_id, bindings.provider_session_id,
       bindings.actual_machine_id, bindings.execution_transport,
       bindings.remote_job_id, bindings.task_bundle_sha256,
       attempts.task_bundle
     FROM kernel_equivalence_production_cases cases
     JOIN kernel_equivalence_production_case_bindings bindings
       ON bindings.case_id = cases.case_id
     JOIN kernel_equivalence_production_case_leases leases
       ON leases.case_id = cases.case_id
      AND leases.owner_id
            = 'brain.kernel_equivalence.production_cases'
      AND leases.state = 'prepared'
      AND leases.lease_expires_at > clock_timestamp()
     JOIN harness_attempts attempts
       ON attempts.id = cases.attempt_id
      AND attempts.run_id = cases.run_id
      AND attempts.machine_attestation_status = 'verified'
      AND attempts.status IN ('completed', 'completed_with_concerns')
     JOIN harness_result_receipts receipts
       ON receipts.receipt_id = bindings.result_receipt_id
      AND receipts.attempt_id = attempts.id
      AND receipts.run_id = attempts.run_id
     WHERE cases.case_id = $1::uuid
       AND cases.brain_version = $2
       AND cases.engine_version = $3
       AND cases.provider = attempts.provider
       AND cases.provider = receipts.provider
       AND cases.provider = receipts.requested_provider
       AND bindings.result_receipt_id = attempts.result_receipt_id
       AND bindings.provider_session_id = attempts.provider_session_id
       AND bindings.provider_session_id = receipts.provider_session_id
       AND bindings.actual_machine_id = attempts.actual_machine_id
       AND bindings.execution_transport = attempts.execution_transport
       AND bindings.remote_job_id = attempts.remote_job_id
       AND bindings.task_bundle_sha256 = receipts.task_bundle_sha256
       AND bindings.artifact_sha = cases.artifact_sha
       AND cases.expires_at > clock_timestamp()`,
    [caseId, context.brainVersion, context.engineVersion],
  );
  if (result?.rowCount !== 1 || !Array.isArray(result.rows)) {
    fail('production_controller_authority_unavailable');
  }
  return validateAuthority(result.rows[0], {
    ...context,
    now: context.now(),
  });
}

async function appendEvent(pool, {
  randomUUID,
  caseId,
  generation,
  controllerInstanceId,
  state,
  grantRef = null,
  grantExpiresAt = null,
  bundleHash = null,
  code = null,
  lateEffectRisk,
  controllerLeaseSeconds = null,
}) {
  const eventId = randomUUID();
  if (!UUID_PATTERN.test(eventId ?? '')) {
    fail('production_controller_uuid_source_invalid');
  }
  const result = await pool.query(
    `INSERT INTO kernel_equivalence_production_execution_events
       (event_id, case_id, generation, controller_instance_id, state,
        grant_ref, grant_expires_at, bundle_hash, code, late_effect_risk,
        controller_lease_expires_at)
     SELECT
       $1::uuid, $2::uuid, $3, $4::uuid, $5,
       $6, $7::timestamptz, $8, $9, $10,
       CASE
         WHEN $11::integer IS NULL THEN NULL
         ELSE clock_timestamp() + make_interval(secs => $11::integer)
       END
     WHERE (
       $3::bigint <> 1
       OR EXISTS (
         SELECT 1
           FROM kernel_equivalence_production_cases cases
           JOIN kernel_equivalence_production_case_leases leases
             ON leases.case_id = cases.case_id
            AND leases.owner_id
                  = 'brain.kernel_equivalence.production_cases'
            AND leases.state = 'prepared'
            AND leases.lease_expires_at > clock_timestamp()
           JOIN harness_attempts attempts
             ON attempts.id = cases.attempt_id
            AND attempts.run_id = cases.run_id
            AND attempts.machine_attestation_status = 'verified'
            AND attempts.status IN (
              'completed', 'completed_with_concerns'
            )
          WHERE cases.case_id = $2::uuid
       )
     )
       AND (
         $3::bigint <> 1
        OR NOT EXISTS (
          SELECT 1
            FROM kernel_equivalence_production_execution_events
           WHERE case_id = $2::uuid
        )
       )
     ON CONFLICT (case_id, generation) DO NOTHING
     RETURNING generation, state`,
    [
      eventId,
      caseId,
      generation,
      controllerInstanceId,
      state,
      grantRef,
      grantExpiresAt,
      bundleHash,
      code,
      lateEffectRisk,
      controllerLeaseSeconds,
    ],
  );
  return result?.rowCount === 1;
}

async function appendRequiredEvent(pool, event) {
  if (!await appendEvent(pool, event)) {
    fail('production_controller_event_append_conflict');
  }
}

async function confirmBundle(pool, authority, bundleHash) {
  if (!HASH_PATTERN.test(bundleHash ?? '')) return false;
  const result = await pool.query(
    `SELECT 1
       FROM kernel_equivalence_receipt_bundles
      WHERE bundle_hash = $1
        AND cell_id = $2
        AND behavior_id = $3
        AND provider = $4
        AND scenario = $5
        AND run_id = $6::uuid
        AND attempt_id = $7::uuid
        AND artifact_sha = $8
        AND resource_id = $9
        AND resource_ref = $10
        AND seam_id = $11
        AND adapter_id = $12`,
    [
      bundleHash,
      authority.cell_id,
      authority.behavior_id,
      authority.provider,
      authority.scenario,
      authority.run_id,
      authority.attempt_id,
      authority.artifact_sha,
      authority.resource_id,
      authority.resource_ref,
      authority.seam_id,
      authority.adapter_id,
    ],
  );
  return result?.rowCount === 1;
}

function validateConfiguration({
  pool,
  grantIssuer,
  socketPath,
  brainVersion,
  engineVersion,
  grantTtlSeconds,
  randomUUID,
  now,
}) {
  if (
    !pool
    || typeof pool.query !== 'function'
    || !validSocketPath(socketPath)
    || !VERSION_PATTERN.test(brainVersion ?? '')
    || !VERSION_PATTERN.test(engineVersion ?? '')
    || !Number.isInteger(grantTtlSeconds)
    || grantTtlSeconds < 1
    || grantTtlSeconds > MAXIMUM_GRANT_TTL_SECONDS
    || typeof randomUUID !== 'function'
    || typeof now !== 'function'
    || !Number.isFinite(now())
  ) {
    fail('production_controller_configuration_invalid');
  }
  validateGrantIssuer(grantIssuer);
}

export function createPostgresKernelEquivalenceCoordinator({
  pool,
  grantIssuer,
  plan,
  socketPath,
  brainVersion,
  engineVersion,
  grantTtlSeconds,
  randomUUID = nodeRandomUUID,
  now = Date.now,
} = {}) {
  validateConfiguration({
    pool,
    grantIssuer,
    socketPath,
    brainVersion,
    engineVersion,
    grantTtlSeconds,
    randomUUID,
    now,
  });
  const cells = pinPlan(plan);
  const controllerInstanceId = randomUUID();
  if (!UUID_PATTERN.test(controllerInstanceId ?? '')) {
    fail('production_controller_uuid_source_invalid');
  }
  const client = createBrainTrustedExecutionClient({
    transport: createUnixSocketTrustedExecutionTransport({
      socketPath,
    }),
  });
  const authorityContext = Object.freeze({
    brainVersion,
    cells,
    engineVersion,
    now,
  });

  const executeCase = async (caseId) => {
    if (!UUID_PATTERN.test(caseId ?? '')) {
      fail('production_controller_case_id_invalid');
    }
    const authority = await bindAndLoadAuthority(
      pool,
      caseId,
      authorityContext,
    );
    const operationNow = now();
    const expiresAt = timestamp(authority.expires_at);
    const ttlSeconds = Math.min(
      grantTtlSeconds,
      Math.floor((expiresAt - operationNow) / 1_000),
    );
    if (ttlSeconds < 1) {
      fail('production_controller_case_expired');
    }
    const claimed = await appendEvent(pool, {
      randomUUID,
      caseId,
      generation: 1,
      controllerInstanceId,
      state: 'claimed',
      lateEffectRisk: false,
      controllerLeaseSeconds: ttlSeconds,
    });
    if (!claimed) fail('production_controller_case_already_claimed');

    let issued;
    try {
      issued = await grantIssuer.issueProtectedGrant({
        cell: authority.cell,
        run_id: authority.run_id,
        attempt_id: authority.attempt_id,
        artifact_sha: authority.artifact_sha,
        brain_version: authority.brain_version,
        engine_version: authority.engine_version,
        resource_id: authority.resource_id,
        resource_ref: authority.resource_ref,
        ttl_seconds: ttlSeconds,
      });
    } catch (error) {
      await appendRequiredEvent(pool, {
        randomUUID,
        caseId,
        generation: 2,
        controllerInstanceId,
        state: 'blocked',
        code: stableCode(error, 'grant_issue_failed'),
        lateEffectRisk: false,
      });
      throw error;
    }
    if (
      !GRANT_REF_PATTERN.test(issued?.grant_ref ?? '')
      || timestamp(issued.expires_at) == null
      || timestamp(issued.expires_at) <= operationNow
      || timestamp(issued.expires_at) > expiresAt
    ) {
      await appendRequiredEvent(pool, {
        randomUUID,
        caseId,
        generation: 2,
        controllerInstanceId,
        state: 'blocked',
        code: 'grant_issue_invalid',
        lateEffectRisk: false,
      });
      fail('production_controller_grant_issue_invalid');
    }
    await appendRequiredEvent(pool, {
      randomUUID,
      caseId,
      generation: 2,
      controllerInstanceId,
      state: 'grant_issued',
      grantRef: issued.grant_ref,
      grantExpiresAt: issued.expires_at,
      lateEffectRisk: false,
      controllerLeaseSeconds: ttlSeconds,
    });
    await appendRequiredEvent(pool, {
      randomUUID,
      caseId,
      generation: 3,
      controllerInstanceId,
      state: 'executing',
      grantRef: issued.grant_ref,
      grantExpiresAt: issued.expires_at,
      lateEffectRisk: false,
      controllerLeaseSeconds: ttlSeconds,
    });

    let result;
    try {
      result = await client.execute({
        cell_id: authority.cell_id,
        grant_ref: issued.grant_ref,
      });
    } catch (error) {
      await appendRequiredEvent(pool, {
        randomUUID,
        caseId,
        generation: 4,
        controllerInstanceId,
        state: 'settlement_unknown',
        grantRef: issued.grant_ref,
        grantExpiresAt: issued.expires_at,
        code: stableCode(
          error,
          'trusted_execution_settlement_unknown',
        ),
        lateEffectRisk: true,
      });
      throw error;
    }

    if (result?.status === 'collected') {
      const bundleHash = result?.bundle?.bundle_hash;
      if (await confirmBundle(pool, authority, bundleHash)) {
        await appendRequiredEvent(pool, {
          randomUUID,
          caseId,
          generation: 4,
          controllerInstanceId,
          state: 'succeeded',
          grantRef: issued.grant_ref,
          grantExpiresAt: issued.expires_at,
          bundleHash,
          lateEffectRisk: false,
        });
        return Object.freeze({
          case_id: caseId,
          state: 'succeeded',
          bundle_hash: bundleHash,
        });
      }
      await appendRequiredEvent(pool, {
        randomUUID,
        caseId,
        generation: 4,
        controllerInstanceId,
        state: 'settlement_unknown',
        grantRef: issued.grant_ref,
        grantExpiresAt: issued.expires_at,
        code: 'bundle_settlement_unconfirmed',
        lateEffectRisk: true,
      });
      fail('production_controller_bundle_settlement_unconfirmed');
    }
    const code = CODE_PATTERN.test(result?.code ?? '')
      ? result.code
      : 'trusted_execution_result_blocked';
    await appendRequiredEvent(pool, {
      randomUUID,
      caseId,
      generation: 4,
      controllerInstanceId,
      state: 'blocked',
      grantRef: issued.grant_ref,
      grantExpiresAt: issued.expires_at,
      code,
      lateEffectRisk: false,
    });
    return Object.freeze({
      case_id: caseId,
      state: 'blocked',
      code,
    });
  };

  const reconcileStartup = async () => {
    const result = await pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (events.case_id)
           events.case_id,
           events.generation,
           events.state,
           events.controller_lease_expires_at,
           cases.cell_id,
           cases.behavior_id,
           cases.provider,
           cases.scenario,
           cases.run_id,
           cases.attempt_id,
           cases.artifact_sha,
           cases.resource_id,
           cases.resource_ref,
           cases.seam_id,
           cases.adapter_id
         FROM kernel_equivalence_production_execution_events events
         JOIN kernel_equivalence_production_case_bindings bindings
           ON bindings.case_id = events.case_id
         JOIN kernel_equivalence_production_cases cases
           ON cases.case_id = bindings.case_id
         ORDER BY events.case_id, events.generation DESC
       )
       SELECT
         latest.*,
         latest.controller_lease_expires_at <= clock_timestamp()
           AS lease_expired,
         bundles.bundle_hash
       FROM latest
       LEFT JOIN LATERAL (
         SELECT bundle_hash
         FROM kernel_equivalence_receipt_bundles
         WHERE cell_id = latest.cell_id
           AND behavior_id = latest.behavior_id
           AND provider = latest.provider
           AND scenario = latest.scenario
           AND run_id = latest.run_id
           AND attempt_id = latest.attempt_id
           AND artifact_sha = latest.artifact_sha
           AND resource_id = latest.resource_id
           AND resource_ref = latest.resource_ref
           AND seam_id = latest.seam_id
           AND adapter_id = latest.adapter_id
         ORDER BY committed_at DESC
         LIMIT 1
       ) bundles ON true
       WHERE latest.state IN (
         'claimed', 'grant_issued', 'executing', 'reconciling',
         'settlement_unknown'
       )
       ORDER BY latest.case_id
       LIMIT 100`,
    );
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    let settled = 0;
    let retainedUnknown = 0;
    for (const row of rows) {
      const generation = Number(row.generation);
      if (
        !UUID_PATTERN.test(row.case_id ?? '')
        || !Number.isSafeInteger(generation)
        || generation < 1
      ) {
        fail('production_controller_reconcile_readback_invalid');
      }
      if (HASH_PATTERN.test(row.bundle_hash ?? '')) {
        const appended = await appendEvent(pool, {
          randomUUID,
          caseId: row.case_id,
          generation: generation + 1,
          controllerInstanceId,
          state: 'succeeded',
          bundleHash: row.bundle_hash,
          lateEffectRisk: false,
        });
        settled += appended ? 1 : 0;
      } else if (row.state !== 'settlement_unknown') {
        if (row.lease_expired === true) {
          const tookOver = await appendEvent(pool, {
            randomUUID,
            caseId: row.case_id,
            generation: generation + 1,
            controllerInstanceId,
            state: 'reconciling',
            lateEffectRisk: false,
            controllerLeaseSeconds: grantTtlSeconds,
          });
          if (tookOver) {
            await appendEvent(pool, {
              randomUUID,
              caseId: row.case_id,
              generation: generation + 2,
              controllerInstanceId,
              state: 'settlement_unknown',
              code: 'startup_settlement_unresolved',
              lateEffectRisk: true,
            });
          }
        }
        retainedUnknown += 1;
      } else {
        retainedUnknown += 1;
      }
    }
    return Object.freeze({
      inspected: rows.length,
      settled,
      retained_unknown: retainedUnknown,
    });
  };

  return Object.freeze({
    owner_service: CONTROLLER_OWNER,
    capability_id:
      'brain.kernel_equivalence.production_controller.v1',
    schema_version:
      'kernel-equivalence-production-controller/v1',
    executeCase,
    reconcileStartup,
  });
}
