import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { types as utilTypes } from 'node:util';

const CASE_FIELDS = Object.freeze([
  'adapter_id',
  'artifact_sha',
  'attempt_id',
  'behavior_id',
  'brain_version',
  'cell_id',
  'engine_version',
  'expires_at',
  'provider',
  'resource_id',
  'resource_prefix',
  'resource_ref',
  'resource_type',
  'run_id',
  'scenario',
  'seam_id',
]);
const TRUSTED_BINDING_FIELDS = Object.freeze(
  CASE_FIELDS.filter((field) => field !== 'expires_at'),
);
const TRANSITION_FIELDS = Object.freeze([
  'after_hash',
  'before_hash',
  'case_id',
  'event_type',
  'evidence_ref',
  'expected_generation',
  'from_state',
  'late_effect_risk',
  'lease_expires_at',
  'status',
  'to_state',
]);
const OWNER_SERVICE = 'brain.kernel_equivalence.production_cases';
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const BEHAVIOR_PATTERN = /^KERNEL-P[01]-[0-9A-Z-]+$/;
const ADAPTER_PATTERN = /^kernel\.drill\.[a-z0-9_]+\.v1$/;
const SAFE_RESOURCE_PREFIX =
  /^(?:refs\/heads\/)?equivalence-drill\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/(?:[a-z0-9][a-z0-9_-]{0,127}\/)*$/;
const FORBIDDEN_RESOURCE =
  /(?:^|[/_.:-])(?:main|master|production|prod|release)(?:$|[/_.:-])/i;
const MAXIMUM_TRANSACTION_TIMEOUT_MS = 300_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const POSTGRES_TIMEOUT_CODES = new Set(['25P03', '55P03', '57014']);
const PROVIDERS = new Set(['claude', 'codex', 'grok']);
const SCENARIOS = new Set(['normal', 'violation', 'recovery']);
const RESOURCE_TYPES = new Set([
  'ephemeral_branch',
  'ephemeral_credential_lease',
  'ephemeral_database_record',
  'ephemeral_run',
  'ephemeral_staging',
  'ephemeral_workspace',
]);
const SEAM_IDS = new Set([
  'kernel.workspace.protected_ref_guard',
  'kernel.credential.attempt_lease',
  'kernel.github.mutation_broker',
  'kernel.merge.effect_executor',
  'kernel.evaluation.independent_judge',
  'kernel.merge.human_review_authority',
  'kernel.release.staging_promotion',
  'kernel.liveness.orphan_recovery',
  'kernel.quality.devgate',
  'kernel.controller.attempt_ownership',
  'kernel.closure.report_learning',
]);
const CANONICAL_DESCRIPTORS = Object.freeze({
  'KERNEL-P0-01-BRANCH-PROTECTION': Object.freeze({
    adapter_id: 'kernel.drill.branch_protection.v1',
    resource_type: 'ephemeral_branch',
    seam_id: 'kernel.workspace.protected_ref_guard',
  }),
  'KERNEL-P0-02-CREDENTIAL-GUARD': Object.freeze({
    adapter_id: 'kernel.drill.credential_guard.v1',
    resource_type: 'ephemeral_credential_lease',
    seam_id: 'kernel.credential.attempt_lease',
  }),
  'KERNEL-P0-03-BRANCH-PUSH-GUARD': Object.freeze({
    adapter_id: 'kernel.drill.branch_push_guard.v1',
    resource_type: 'ephemeral_branch',
    seam_id: 'kernel.github.mutation_broker',
  }),
  'KERNEL-P0-04-CI-MERGE-AUTHORITY': Object.freeze({
    adapter_id: 'kernel.drill.ci_merge_authority.v1',
    resource_type: 'ephemeral_branch',
    seam_id: 'kernel.merge.effect_executor',
  }),
  'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE': Object.freeze({
    adapter_id: 'kernel.drill.independent_evaluator_judge.v1',
    resource_type: 'ephemeral_run',
    seam_id: 'kernel.evaluation.independent_judge',
  }),
  'KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY': Object.freeze({
    adapter_id: 'kernel.drill.human_review_authority.v1',
    resource_type: 'ephemeral_run',
    seam_id: 'kernel.merge.human_review_authority',
  }),
  'KERNEL-P0-07-RELEASE-PROMOTION': Object.freeze({
    adapter_id: 'kernel.drill.release_promotion.v1',
    resource_type: 'ephemeral_staging',
    seam_id: 'kernel.release.staging_promotion',
  }),
  'KERNEL-P1-08-STOP-ORPHAN-LIVENESS': Object.freeze({
    adapter_id: 'kernel.drill.stop_orphan_liveness.v1',
    resource_type: 'ephemeral_run',
    seam_id: 'kernel.liveness.orphan_recovery',
  }),
  'KERNEL-P1-09-DEVGATE-TDD-DOD': Object.freeze({
    adapter_id: 'kernel.drill.devgate_tdd_dod.v1',
    resource_type: 'ephemeral_workspace',
    seam_id: 'kernel.quality.devgate',
  }),
  'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION': Object.freeze({
    adapter_id: 'kernel.drill.controller_session_isolation.v1',
    resource_type: 'ephemeral_run',
    seam_id: 'kernel.controller.attempt_ownership',
  }),
  'KERNEL-P1-11-REPORT-LEARNING-CLOSURE': Object.freeze({
    adapter_id: 'kernel.drill.report_learning_closure.v1',
    resource_type: 'ephemeral_database_record',
    seam_id: 'kernel.closure.report_learning',
  }),
});
const STATES = new Set([
  'prepared',
  'cancelling',
  'cancelled',
  'cleanup_unconfirmed',
  'cleaned',
]);
const EVENT_TYPES = new Set([
  'prepared',
  'cancel_requested',
  'cancel_confirmed',
  'cleanup_confirmed',
  'cleanup_unconfirmed',
  'inspection',
]);
const EVENT_STATUSES = new Set(['confirmed', 'denied', 'unconfirmed']);
const TRANSITIONS = new Set([
  'prepared:cancelling',
  'prepared:cleanup_unconfirmed',
  'prepared:cleaned',
  'cancelling:cancelled',
  'cancelling:cleanup_unconfirmed',
  'cancelled:cleanup_unconfirmed',
  'cancelled:cleaned',
  'cancelling:cleaned',
  'cleanup_unconfirmed:cancelling',
  'cleanup_unconfirmed:cleaned',
]);

export class ProductionEquivalenceCaseStoreError extends Error {
  constructor(code, { lateEffectRisk = false } = {}) {
    super(code);
    this.name = 'ProductionEquivalenceCaseStoreError';
    this.code = code;
    if (lateEffectRisk) this.late_effect_risk = true;
  }
}

function fail(code, options) {
  throw new ProductionEquivalenceCaseStoreError(code, options);
}

function materializeExactRecord(value, expected) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) {
    return null;
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const actual = Reflect.ownKeys(descriptors);
  const sortedExpected = [...expected].sort();
  if (
    actual.some((field) => typeof field !== 'string')
    || actual.length !== sortedExpected.length
    || actual.sort().some((field, index) => field !== sortedExpected[index])
  ) {
    return null;
  }
  const entries = [];
  for (const field of expected) {
    const descriptor = descriptors[field];
    if (
      descriptor == null
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true
    ) {
      return null;
    }
    entries.push([field, descriptor.value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function bounded(value, maximum = 2_048) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function validTimeout(value) {
  return (
    Number.isInteger(value)
    && value >= 1
    && value <= MAXIMUM_TRANSACTION_TIMEOUT_MS
  );
}

function validSignal(signal) {
  return (
    signal == null
    || (
      typeof signal === 'object'
      && typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function'
    )
  );
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    fail('production_case_pool_invalid');
  }
}

function canonicalPrefix(input) {
  const base = `equivalence-drill/${input.run_id}/${input.attempt_id}/`;
  return input.resource_prefix.startsWith('refs/heads/')
    ? `refs/heads/${base}`
    : base;
}

function validCaseRecord(input, now) {
  const descriptor = CANONICAL_DESCRIPTORS[input.behavior_id];
  if (
    !UUID_PATTERN.test(input.run_id ?? '')
    || !UUID_PATTERN.test(input.attempt_id ?? '')
    || !BEHAVIOR_PATTERN.test(input.behavior_id ?? '')
    || !PROVIDERS.has(input.provider)
    || !SCENARIOS.has(input.scenario)
    || input.cell_id !== (
      `${input.behavior_id}::${input.provider}::${input.scenario}`
    )
    || descriptor == null
    || input.seam_id !== descriptor.seam_id
    || input.adapter_id !== descriptor.adapter_id
    || input.resource_type !== descriptor.resource_type
    || !SEAM_IDS.has(input.seam_id)
    || !ADAPTER_PATTERN.test(input.adapter_id ?? '')
    || !SHA_PATTERN.test(input.artifact_sha ?? '')
    || !VERSION_PATTERN.test(input.brain_version ?? '')
    || !VERSION_PATTERN.test(input.engine_version ?? '')
    || !RESOURCE_TYPES.has(input.resource_type)
    || !bounded(input.resource_prefix, 512)
    || !SAFE_RESOURCE_PREFIX.test(input.resource_prefix)
    || !input.resource_prefix.startsWith(canonicalPrefix(input))
    || FORBIDDEN_RESOURCE.test(input.resource_prefix)
    || !bounded(input.resource_id, 512)
    || !bounded(input.resource_ref)
    || input.resource_ref === input.resource_prefix
    || !input.resource_ref.startsWith(input.resource_prefix)
    || FORBIDDEN_RESOURCE.test(input.resource_ref)
    || typeof input.expires_at !== 'string'
  ) {
    return false;
  }
  const expiresAt = Date.parse(input.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function validNullableHash(value) {
  return value === null || HASH_PATTERN.test(value ?? '');
}

function validTransition(input, now) {
  if (
    !UUID_PATTERN.test(input.case_id ?? '')
    || !Number.isSafeInteger(input.expected_generation)
    || input.expected_generation < 1
    || !STATES.has(input.from_state)
    || !STATES.has(input.to_state)
    || !TRANSITIONS.has(`${input.from_state}:${input.to_state}`)
    || !EVENT_TYPES.has(input.event_type)
    || !EVENT_STATUSES.has(input.status)
    || typeof input.late_effect_risk !== 'boolean'
    || !validNullableHash(input.before_hash)
    || !validNullableHash(input.after_hash)
  ) {
    return false;
  }
  const expectedEvidenceRef = (
    `db:kernel-equivalence-production-cases/${input.case_id}/`
    + `${input.expected_generation + 1}/${input.event_type}`
  );
  if (input.evidence_ref !== expectedEvidenceRef) return false;
  const semanticTransition = (
    (
      input.to_state === 'cancelling'
      && input.event_type === 'cancel_requested'
      && input.status === 'confirmed'
      && input.late_effect_risk === false
    )
    || (
      input.to_state === 'cancelled'
      && input.event_type === 'cancel_confirmed'
      && input.status === 'confirmed'
      && input.late_effect_risk === false
    )
    || (
      input.to_state === 'cleanup_unconfirmed'
      && input.event_type === 'cleanup_unconfirmed'
      && input.status === 'unconfirmed'
      && input.late_effect_risk === true
    )
    || (
      input.to_state === 'cleaned'
      && input.event_type === 'cleanup_confirmed'
      && input.status === 'confirmed'
      && input.late_effect_risk === false
    )
  );
  if (!semanticTransition) return false;
  if (input.to_state === 'cleaned') return input.lease_expires_at === null;
  if (typeof input.lease_expires_at !== 'string') return false;
  const leaseExpiresAt = Date.parse(input.lease_expires_at);
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now;
}

function trustedBindingMatches(binding, input) {
  return TRUSTED_BINDING_FIELDS.every((field) => (
    binding[field] === input[field]
  ));
}

function loadTrustedBinding(resolveTrustedBinding, input) {
  let value;
  try {
    value = resolveTrustedBinding(Object.freeze({
      attempt_id: input.attempt_id,
      cell_id: input.cell_id,
      resource_id: input.resource_id,
      resource_ref: input.resource_ref,
      run_id: input.run_id,
    }));
  } catch {
    fail('production_case_trusted_binding_unavailable');
  }
  const binding = materializeExactRecord(value, TRUSTED_BINDING_FIELDS);
  if (!binding || !trustedBindingMatches(binding, input)) {
    fail('production_case_trusted_binding_invalid');
  }
  return binding;
}

async function databaseDeadlineOpen(client, absoluteDeadlineMs) {
  const result = await client.query(
    `SELECT
       clock_timestamp()
         < to_timestamp($1::double precision / 1000.0) AS before_deadline`,
    [absoluteDeadlineMs],
  );
  return (
    result?.rowCount === 1
    && result.rows?.[0]?.before_deadline === true
  );
}

function stableRow(row) {
  if (
    !UUID_PATTERN.test(row?.case_id ?? '')
    || row.owner_id !== OWNER_SERVICE
    || !Number.isSafeInteger(Number(row.generation))
    || Number(row.generation) < 1
    || !STATES.has(row.state)
    || !bounded(row.resource_id, 512)
    || !bounded(row.resource_ref)
    || !bounded(row.evidence_ref)
  ) {
    fail('production_case_readback_invalid');
  }
  return Object.freeze({
    case_id: row.case_id,
    owner_id: row.owner_id,
    generation: Number(row.generation),
    state: row.state,
    resource_id: row.resource_id,
    resource_ref: row.resource_ref,
    evidence_ref: row.evidence_ref,
  });
}

async function runTransaction({
  pool,
  signal,
  timeoutMs,
  now,
  execute,
}) {
  if (!validSignal(signal) || !validTimeout(timeoutMs)) {
    fail('production_case_transaction_invalid');
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    fail('production_case_clock_invalid');
  }
  const absoluteDeadlineMs = startedAt + timeoutMs;
  if (signal?.aborted) fail('production_case_transaction_aborted');
  let client = null;
  let began = false;
  let released = false;
  let commitStarted = false;
  let controlError = null;
  let rejectControl;
  const control = new Promise((_, reject) => {
    rejectControl = reject;
  });
  const releaseClient = (destroy = false) => {
    if (client && !released) {
      released = true;
      client.release(destroy);
    }
  };
  const stop = (error) => {
    if (controlError) return;
    controlError = error;
    releaseClient(true);
    rejectControl(error);
  };
  const onAbort = () => {
    stop(new ProductionEquivalenceCaseStoreError(
      'production_case_transaction_aborted',
    ));
  };
  const timeout = setTimeout(() => {
    stop(new ProductionEquivalenceCaseStoreError(
      'production_case_transaction_timeout',
    ));
  }, timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  const controlled = (promise) => Promise.race([
    Promise.resolve(promise),
    control,
  ]);
  try {
    const pendingClient = Promise.resolve().then(() => pool.connect());
    pendingClient.then((connected) => {
      if (controlError) connected.release(true);
    }, () => {});
    client = await controlled(pendingClient);
    await controlled(client.query('BEGIN'));
    began = true;
    const remainingMs = Math.ceil(absoluteDeadlineMs - now());
    if (remainingMs < 1) fail('production_case_transaction_timeout');
    await controlled(client.query(
      `SELECT
         set_config('statement_timeout', $1, true),
         set_config('lock_timeout', $1, true),
         set_config('idle_in_transaction_session_timeout', $1, true),
         set_config('transaction_timeout', $1, true)`,
      [`${remainingMs}ms`],
    ));
    const value = await controlled(execute(client, absoluteDeadlineMs));
    if (controlError || signal?.aborted) {
      fail('production_case_transaction_aborted');
    }
    if (!await controlled(databaseDeadlineOpen(
      client,
      absoluteDeadlineMs,
    ))) {
      fail('production_case_transaction_timeout');
    }
    if (controlError || signal?.aborted) {
      fail('production_case_transaction_aborted');
    }
    commitStarted = true;
    await controlled(client.query('COMMIT'));
    began = false;
    if (
      controlError
      || signal?.aborted
      || now() >= absoluteDeadlineMs
    ) {
      fail('production_case_commit_settlement_unknown', {
        lateEffectRisk: true,
      });
    }
    return value;
  } catch (error) {
    if (began && !released && !commitStarted) {
      await client.query('ROLLBACK').catch(() => {});
      began = false;
    }
    if (commitStarted) {
      releaseClient(true);
      fail('production_case_commit_settlement_unknown', {
        lateEffectRisk: true,
      });
    }
    if (error instanceof ProductionEquivalenceCaseStoreError) throw error;
    if (!client) fail('production_case_database_unavailable');
    if (controlError || signal?.aborted) {
      throw controlError ?? new ProductionEquivalenceCaseStoreError(
        'production_case_transaction_aborted',
      );
    }
    if (POSTGRES_TIMEOUT_CODES.has(error?.code)) {
      fail('production_case_transaction_timeout');
    }
    fail('production_case_transaction_failed');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    releaseClient();
  }
}

function prepareEvidenceRef(caseId) {
  return `db:kernel-equivalence-production-cases/${caseId}/1/prepared`;
}

export function createPostgresProductionCaseStore({
  pool,
  randomUUID = nodeRandomUUID,
  now = Date.now,
  resolveTrustedBinding,
} = {}) {
  requirePool(pool);
  if (
    typeof randomUUID !== 'function'
    || typeof now !== 'function'
    || typeof resolveTrustedBinding !== 'function'
  ) {
    fail('production_case_store_configuration_invalid');
  }

  const prepareCase = async (
    input,
    {
      signal = null,
      timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS,
    } = {},
  ) => {
    const sampledNow = now();
    const record = materializeExactRecord(input, CASE_FIELDS);
    if (
      !Number.isFinite(sampledNow)
      || !record
      || !validCaseRecord(record, sampledNow)
    ) {
      fail('production_case_record_invalid');
    }
    loadTrustedBinding(resolveTrustedBinding, record);
    const caseId = randomUUID();
    const eventId = randomUUID();
    if (
      !UUID_PATTERN.test(caseId ?? '')
      || !UUID_PATTERN.test(eventId ?? '')
      || caseId === eventId
    ) {
      fail('production_case_uuid_source_invalid');
    }
    const evidenceRef = prepareEvidenceRef(caseId);
    return runTransaction({
      pool,
      signal,
      timeoutMs,
      now,
      execute: async (client, absoluteDeadlineMs) => {
        const result = await client.query(
          `WITH inserted_case AS (
             INSERT INTO kernel_equivalence_production_cases
               (case_id, cell_id, behavior_id, provider, scenario, seam_id,
                adapter_id, run_id, attempt_id, artifact_sha, brain_version,
                engine_version, resource_type, resource_prefix, resource_id,
                resource_ref, expires_at)
             SELECT
               $1::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10::uuid,
               $11, $12, $13, $14, $15, $16, $17, $18::timestamptz
              WHERE clock_timestamp()
                < to_timestamp($21::double precision / 1000.0)
             ON CONFLICT DO NOTHING
             RETURNING case_id, resource_id, resource_ref
           ), inserted_lease AS (
             INSERT INTO kernel_equivalence_production_case_leases
               (case_id, owner_id, generation, state, lease_expires_at)
             SELECT case_id, $19, 1, 'prepared', $18::timestamptz
               FROM inserted_case
             RETURNING case_id, owner_id, generation, state
           ), inserted_event AS (
             INSERT INTO kernel_equivalence_production_case_events
               (event_id, case_id, generation, event_type, status,
                evidence_ref, before_hash, after_hash, late_effect_risk)
             SELECT
               $2::uuid, case_id, 1, 'prepared', 'confirmed',
               $20, NULL, NULL, false
               FROM inserted_lease
             RETURNING case_id, evidence_ref
           )
           SELECT
             c.case_id, l.owner_id, l.generation, l.state,
             c.resource_id, c.resource_ref, e.evidence_ref
             FROM inserted_case c
             JOIN inserted_lease l USING (case_id)
             JOIN inserted_event e USING (case_id)`,
          [
            caseId,
            eventId,
            record.cell_id,
            record.behavior_id,
            record.provider,
            record.scenario,
            record.seam_id,
            record.adapter_id,
            record.run_id,
            record.attempt_id,
            record.artifact_sha,
            record.brain_version,
            record.engine_version,
            record.resource_type,
            record.resource_prefix,
            record.resource_id,
            record.resource_ref,
            record.expires_at,
            OWNER_SERVICE,
            evidenceRef,
            absoluteDeadlineMs,
          ],
        );
        if (result.rowCount !== 1) {
          if (!await databaseDeadlineOpen(client, absoluteDeadlineMs)) {
            fail('production_case_transaction_timeout');
          }
          fail('production_case_identity_conflict');
        }
        return stableRow(result.rows[0]);
      },
    });
  };

  const transitionCase = async (
    input,
    {
      signal = null,
      timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS,
    } = {},
  ) => {
    const sampledNow = now();
    const transition = materializeExactRecord(input, TRANSITION_FIELDS);
    if (
      !Number.isFinite(sampledNow)
      || !transition
      || !validTransition(transition, sampledNow)
    ) {
      fail('production_case_transition_invalid');
    }
    const eventId = randomUUID();
    if (!UUID_PATTERN.test(eventId ?? '')) {
      fail('production_case_uuid_source_invalid');
    }
    return runTransaction({
      pool,
      signal,
      timeoutMs,
      now,
      execute: async (client, absoluteDeadlineMs) => {
        const result = await client.query(
          `WITH advanced AS (
             UPDATE kernel_equivalence_production_case_leases
                SET generation = generation + 1,
                    state = $6,
                    lease_expires_at =
                      COALESCE($7::timestamptz, lease_expires_at),
                    updated_at = clock_timestamp()
              WHERE case_id = $1::uuid
                AND owner_id = $3
                AND generation = $4
                AND state = $5
                AND clock_timestamp()
                  < to_timestamp($14::double precision / 1000.0)
             RETURNING case_id, owner_id, generation, state
           ), inserted_event AS (
             INSERT INTO kernel_equivalence_production_case_events
               (event_id, case_id, generation, event_type, status,
                evidence_ref, before_hash, after_hash, late_effect_risk)
             SELECT
               $2::uuid, case_id, generation, $8, $9, $10, $11, $12, $13
               FROM advanced
             RETURNING case_id, evidence_ref
           )
           SELECT
             a.case_id, a.owner_id, a.generation, a.state,
             c.resource_id, c.resource_ref, e.evidence_ref
             FROM advanced a
             JOIN kernel_equivalence_production_cases c USING (case_id)
             JOIN inserted_event e USING (case_id)`,
          [
            transition.case_id,
            eventId,
            OWNER_SERVICE,
            transition.expected_generation,
            transition.from_state,
            transition.to_state,
            transition.lease_expires_at,
            transition.event_type,
            transition.status,
            transition.evidence_ref,
            transition.before_hash,
            transition.after_hash,
            transition.late_effect_risk,
            absoluteDeadlineMs,
          ],
        );
        if (result.rowCount !== 1) {
          if (!await databaseDeadlineOpen(client, absoluteDeadlineMs)) {
            fail('production_case_transaction_timeout');
          }
          fail('production_case_transition_stale');
        }
        return stableRow(result.rows[0]);
      },
    });
  };

  return Object.freeze({
    owner_service: OWNER_SERVICE,
    capability_id: 'brain.kernel_equivalence.production_case_store.v1',
    prepareCase,
    transitionCase,
  });
}
