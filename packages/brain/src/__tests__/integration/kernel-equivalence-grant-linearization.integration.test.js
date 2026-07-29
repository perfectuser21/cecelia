import {
  createHash,
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { load as loadYaml } from 'js-yaml';
import pg from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  compileDrillPlan,
  executeDrillCell,
} from '../../lib/kernel-equivalence-drills.js';
import {
  createPostgresGrantExecutionAuthority,
} from '../../lib/kernel-equivalence-grant-execution-authority.js';
import {
  createPostgresAuditSink,
  createPostgresBundleChainStore,
} from '../../lib/kernel-equivalence-postgres-runtime.js';
import {
  createProtectedGrantFileAuthority,
  createProtectedGrantFileIssuer,
} from '../../lib/kernel-equivalence-protected-grant-authority.js';
import {
  createCleanupEvidence,
} from '../../lib/kernel-equivalence-runtime-registry.js';
import {
  loadExecutionGrantAuthority,
} from '../../lib/kernel-equivalence-signers.js';
import {
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS,
} from '../../lib/kernel-equivalence-trusted-assembly.js';
import {
  bootProductionBrainTrustedExecution,
} from '../../lib/kernel-equivalence-trusted-execution-boot.js';
import {
  digestTrustedExecutionPlan,
} from '../../lib/kernel-equivalence-trusted-execution-service.js';
import {
  computeFleetAuthoritySha256,
} from '../../orchestrator/fleet-callback-auth.js';

const MIGRATIONS = [
  '376_kernel_equivalence_runtime.sql',
  '377_kernel_equivalence_production_cases.sql',
  '378_kernel_equivalence_production_case_authority.sql',
  '381_kernel_equivalence_production_controller.sql',
  '382_kernel_equivalence_grant_authority.sql',
];
const schemaName =
  `kernel_grant_linear_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const applicationName = `kernel-grant-linear-${process.pid}`;
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CONTROLLER_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_SHA = 'a'.repeat(40);
const TASK_BUNDLE = Object.freeze({
  inputs: Object.freeze({
    workspace_spec: Object.freeze({
      expected_head_sha: ARTIFACT_SHA,
    }),
  }),
});
const TASK_BUNDLE_SHA = computeFleetAuthoritySha256(TASK_BUNDLE);
const BRAIN_VERSION = JSON.parse(readFileSync(
  new URL('../../../package.json', import.meta.url),
  'utf8',
)).version;
const ENGINE_VERSION = readFileSync(
  new URL('../../../../engine/VERSION', import.meta.url),
  'utf8',
).trim();
const CELL = Object.freeze({
  cell_id:
    'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::codex::normal',
  behavior_id: 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
  priority: 'P1',
  owner: 'kernel-runtime',
  provider: 'codex',
  scenario: 'normal',
  seam_id: 'kernel.controller.attempt_ownership',
  seam_ref: 'packages/brain/src/orchestrator/attempt-store.js',
  adapter_id: 'kernel.drill.controller_session_isolation.v1',
  effect_signer_status: 'available',
  effect_key_id: 'unused-before-revocation',
  blocked_by: null,
  isolation: Object.freeze({
    environment: 'isolated',
    resource_type: 'ephemeral_run',
    resource_prefix:
      'equivalence-drill/{run_id}/{attempt_id}/controller/',
  }),
  expected: Object.freeze({
    expected_outcome: 'confirmed',
    effect_code: 'single_controller_ownership_confirmed',
  }),
});
const migrations = MIGRATIONS.map((fileName) => {
  const sql = readFileSync(
    new URL(`../../../migrations/${fileName}`, import.meta.url),
    'utf8',
  );
  return sql.replaceAll(
    'SET search_path = public, pg_temp',
    `SET search_path = ${schemaName}, pg_temp`,
  );
});

let adminPool;
let pool;
let fixtureRoot;
let grantRoot;
let trustRegistry;
let grantSigner;
let grantExecutionAuthority;
let grantFileAuthority;
let grantFileIssuer;
let productionControl;
let productionHarness;
let socketRoot;
const expectedConnectionErrors = [];

function privateKeyFile(root, keyId, privateKey) {
  const path = join(root, `${keyId}.pem`);
  writeFileSync(
    path,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  return path;
}

function keyRecord(keyId, purpose, serviceId, publicKey, now) {
  return {
    key_id: keyId,
    purpose,
    service_id: serviceId,
    public_key_pem: publicKey.export({
      type: 'spki',
      format: 'pem',
    }),
    not_before: new Date(now - 60_000).toISOString(),
    not_after: new Date(now + 3_600_000).toISOString(),
    revoked_at: null,
    rotates_key_id: null,
  };
}

function operation(value = undefined) {
  return async () => value;
}

function authority(ownerService, functions) {
  return Object.fromEntries([
    ['owner_service', ownerService],
    ...functions.map((name) => [name, operation()]),
  ]);
}

function createProductionControl() {
  const control = {
    actualSeamCalls: 0,
    cleanupCalls: 0,
    mode: null,
    prepareBarrier: null,
    prepareCalls: 0,
    seamBarrier: null,
    states: new Map(),
    reset(mode) {
      this.actualSeamCalls = 0;
      this.cleanupCalls = 0;
      this.mode = mode;
      this.prepareBarrier = barrier(`${mode} production prepare`);
      this.prepareCalls = 0;
      this.seamBarrier = barrier(`${mode} production actual seam`);
      this.states.clear();
    },
  };
  return control;
}

function productionSeamPorts(control) {
  const dependencies = {
    protectedRefGuard: { execute: operation() },
    credentialGuard: { issue: operation() },
    branchPushGuard: { execute: operation() },
    ciMergeEffect: { execute: operation() },
    independentJudge: {
      pool: { query: operation() },
      attemptStore: {
        complete: operation(),
        getById: operation(),
      },
      judgeGate: operation(),
      promptDir: '/var/lib/cecelia/equivalence-prompts',
    },
    devgate: { spawnGuarded: operation() },
    attemptOwnership: {
      async complete(attemptId, result) {
        control.actualSeamCalls += 1;
        if (control.mode === 'execution-first') {
          control.seamBarrier.enter();
          await control.seamBarrier.waitUntilReleased();
        }
        const current = control.states.get(attemptId);
        control.states.set(attemptId, {
          ...current,
          status: 'completed',
          result,
        });
        return {
          attempt: { id: attemptId },
          deduped: false,
        };
      },
      async getById(attemptId) {
        return control.states.get(attemptId) ?? null;
      },
    },
    reportLearning: {
      dbQuery: operation(),
      learningQuery: operation(),
    },
  };
  const authorities = {
    protectedRefGuard: authority(
      'kernel.workspace.protected_ref_guard',
      [
        'loadInput',
        'snapshot',
        'confirmDenial',
        'confirmSuccess',
        'confirmRecovery',
        'cancel',
        'cleanup',
      ],
    ),
    credentialGuard: authority(
      'kernel.credential.attempt_lease',
      [
        'loadIssueRequest',
        'snapshot',
        'confirmDenial',
        'confirmRefresh',
        'cancel',
        'cleanup',
      ],
    ),
    branchPushGuard: authority(
      'kernel.github.mutation_broker',
      [
        'loadInput',
        'snapshot',
        'confirmDenial',
        'confirmSuccess',
        'confirmRecovery',
        'cancel',
        'cleanup',
      ],
    ),
    ciMergeEffect: authority(
      'kernel.merge.effect_executor',
      [
        'loadExecution',
        'snapshot',
        'confirmDenial',
        'confirmSuccess',
        'confirmRecovery',
        'cancel',
        'cleanup',
      ],
    ),
    humanReview: authority(
      'kernel.merge.human_review_authority',
      [
        'loadEvidence',
        'snapshot',
        'confirmDenial',
        'confirmRenewal',
        'cancel',
        'cleanup',
      ],
    ),
    independentJudge: authority(
      'kernel.evaluation.independent_judge',
      ['loadContext', 'snapshot', 'loadPredecessorActorBinding'],
    ),
    orphanLiveness: authority(
      'kernel.liveness.orphan_recovery',
      [
        'loadTarget',
        'snapshot',
        'recoverDeadAttempt',
        'now',
        'hostFn',
        'killFn',
      ],
    ),
    devgate: authority(
      'kernel.quality.devgate',
      ['loadTarget'],
    ),
    attemptOwnership: {
      owner_service: 'kernel.controller.attempt_ownership',
      async loadTarget({ grant }) {
        const result = {
          status: 'completed',
          attempt_id: grant.attempt_id,
        };
        control.states.set(grant.attempt_id, {
          id: grant.attempt_id,
          run_id: grant.run_id,
          status: 'running',
          lease_owner: 'linearization-owner',
          lease_generation: 1,
          result: null,
        });
        return {
          attempt_id: grant.attempt_id,
          lease_owner: 'linearization-owner',
          callback_owner: 'linearization-owner',
          lease_generation: 1,
          result,
        };
      },
      async snapshot({ phase, grant }) {
        return {
          phase,
          grant_id: grant.grant_id,
          attempt_id: grant.attempt_id,
        };
      },
      loadPredecessorOwnershipBinding: operation(),
    },
    reportLearning: authority(
      'kernel.closure.report_learning',
      [
        'now',
        'loadEvidence',
        'snapshot',
        'loadPredecessorEvidenceBinding',
      ],
    ),
  };
  authorities.protectedRefGuard.sandbox_repo =
    'perfectuser21/cecelia-kernel-equivalence-drills';
  authorities.branchPushGuard.sandbox_repo =
    'perfectuser21/cecelia-kernel-equivalence-drills';
  return { authorities, dependencies };
}

function productionAssemblyPorts(control) {
  return {
    cleanupInspector: Object.freeze({
      owner_service: 'kernel.equivalence.cleanup_inspector',
      capability_id: 'grant-linearization-cleanup-inspector-v1',
      async inspect() {
        return {
          exists: control.mode === 'execution-first',
          evidence_ref: `cleanup-evidence:${'c'.repeat(64)}`,
        };
      },
    }),
    profile_id: 'grant-linearization-isolated',
    qualityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.quality_isolation',
      capability_id: 'grant-linearization-quality-isolation-v1',
      async prepare({ authorization }) {
        control.prepareCalls += 1;
        if (control.mode === 'revoke-first') {
          control.prepareBarrier.enter();
          await control.prepareBarrier.waitUntilReleased();
        }
        return {
          resource_id: authorization.resource_id,
          resource_ref: authorization.resource_ref,
        };
      },
      cancel: operation({ confirmed: true }),
      async cleanup() {
        control.cleanupCalls += 1;
        return { confirmed: true };
      },
    }),
    seamPorts: productionSeamPorts(control),
    securityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.isolation',
      capability_id: 'grant-linearization-security-isolation-v1',
      prepare: operation(),
      cancel: operation({ confirmed: true }),
      cleanup: operation({ confirmed: true }),
    }),
  };
}

function createProductionManifest(root, now) {
  const grantDirectory = join(root, 'production-grants');
  mkdirSync(grantDirectory, { mode: 0o700 });
  chmodSync(grantDirectory, 0o700);
  socketRoot = realpathSync(mkdtempSync('/tmp/keq-grant-linear-'));
  chmodSync(socketRoot, 0o700);
  const contract = loadYaml(readFileSync(
    new URL('../../../../../regression-contract.yaml', import.meta.url),
    'utf8',
  ));
  const plan = compileDrillPlan(contract, { now });
  const keys = [];
  const effectSigningKeys = {};
  for (
    const [index, descriptor]
    of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS.entries()
  ) {
    const pair = generateKeyPairSync('ed25519');
    const keyId = `linear-effect-${String(index + 1).padStart(2, '0')}`;
    effectSigningKeys[descriptor.seam_id] = {
      key_id: keyId,
      secret_file: privateKeyFile(root, keyId, pair.privateKey),
    };
    keys.push(keyRecord(
      keyId,
      'effect_receipt',
      descriptor.seam_id,
      pair.publicKey,
      now,
    ));
    for (const cell of plan.cells) {
      if (cell.behavior_id !== descriptor.behavior_id) continue;
      cell.effect_signer_status = 'available';
      cell.effect_key_id = keyId;
      cell.blocked_by = null;
      cell.assembly_status = 'assembled';
    }
  }
  const collector = generateKeyPairSync('ed25519');
  const collectorKeyId = 'linear-collector';
  keys.push(keyRecord(
    collectorKeyId,
    'collector_bundle',
    'kernel.equivalence.collector',
    collector.publicKey,
    now,
  ));
  const execution = generateKeyPairSync('ed25519');
  const executionKeyId = 'linear-grant-authority';
  keys.push(keyRecord(
    executionKeyId,
    'execution_grant',
    'brain.authority',
    execution.publicKey,
    now,
  ));
  const readiness = generateKeyPairSync('ed25519');
  const readinessKeyId = 'linear-readiness';
  keys.push(keyRecord(
    readinessKeyId,
    'trusted_execution_readiness',
    'brain.kernel_equivalence.trusted_execution',
    readiness.publicKey,
    now,
  ));
  const trust = {
    schema_version: 'kernel-equivalence-trust-registry/v1',
    algorithm: 'ed25519',
    grant_max_age_seconds: 300,
    effect_receipt_max_age_seconds: 300,
    collector_bundle_max_age_seconds: 300,
    replay_nonce: {
      single_use: true,
      atomic_consumer_required: true,
    },
    keys,
  };
  const manifest = {
    schema_version: 'kernel-equivalence-production-wiring/v1',
    expected_plan_digest: digestTrustedExecutionPlan(plan),
    trust_registry: trust,
    collector_key: {
      key_id: collectorKeyId,
      secret_file: privateKeyFile(
        root,
        collectorKeyId,
        collector.privateKey,
      ),
    },
    execution_grant_key: {
      key_id: executionKeyId,
      secret_file: privateKeyFile(
        root,
        executionKeyId,
        execution.privateKey,
      ),
    },
    readiness_signing_key: {
      key_id: readinessKeyId,
      secret_file: privateKeyFile(
        root,
        readinessKeyId,
        readiness.privateKey,
      ),
    },
    effect_signing_keys: effectSigningKeys,
    grant_root: grantDirectory,
    grant_ttl_seconds: 60,
    socket_path: join(socketRoot, 'trusted.sock'),
    resource_ports: {
      schema_version: 'kernel-equivalence-resource-ports/v1',
      profile_id: 'grant-linearization-isolated',
    },
  };
  const configFile = join(root, 'production-wiring.json');
  writeFileSync(configFile, `${JSON.stringify(manifest)}\n`, {
    mode: 0o600,
  });
  chmodSync(configFile, 0o600);
  return {
    env: {
      KERNEL_EQ_PRODUCTION_CONFIG_FILE: configFile,
    },
    plan,
  };
}

function timeoutAfter(promise, label, timeoutMs = 4_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function barrier(label) {
  let enter;
  let release;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  return Object.freeze({
    enter,
    release,
    waitUntilEntered: () => timeoutAfter(entered, `${label} entry`),
    waitUntilReleased: () => timeoutAfter(released, `${label} release`),
  });
}

function advisoryKey(grantId) {
  return createHash('sha256')
    .update(grantId, 'utf8')
    .digest()
    .readBigInt64BE(0)
    .toString();
}

function advisoryLockIdentity(grantId) {
  const unsigned = BigInt.asUintN(64, BigInt(advisoryKey(grantId)));
  return {
    classId: ((unsigned >> 32n) & 0xffff_ffffn).toString(),
    objectId: (unsigned & 0xffff_ffffn).toString(),
  };
}

async function waitForLockWaiter(mode, grantId) {
  const identity = advisoryLockIdentity(grantId);
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const result = await adminPool.query(
      `SELECT count(*)::integer AS count
         FROM pg_locks locks
         JOIN pg_stat_activity activity
           ON activity.pid = locks.pid
        WHERE activity.application_name = $1
          AND locks.locktype = 'advisory'
          AND locks.mode = $2
          AND locks.classid = $3::oid
          AND locks.objid = $4::oid
          AND locks.objsubid = 1
          AND locks.granted = false`,
      [
        applicationName,
        mode,
        identity.classId,
        identity.objectId,
      ],
    );
    if (result.rows[0]?.count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no waiting ${mode} advisory lock was observed`);
}

async function createProductionCase() {
  const caseId = randomUUID();
  const attemptId = randomUUID();
  const receiptId = randomUUID();
  const sessionId = `session-${attemptId}`;
  const jobId = `job-${attemptId}`;
  const resourcePrefix =
    `equivalence-drill/${RUN_ID}/${attemptId}/controller/`;
  const resourceRef = `${resourcePrefix}${attemptId}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO harness_attempts
         (id, run_id, provider, provider_session_id, actual_machine_id,
          execution_transport, remote_job_id, machine_attestation_status,
          status, result_receipt_id, task_bundle)
       VALUES
         ($1::uuid, $2::uuid, 'codex', $3, 'linearization-worker',
          'fleet-worker', $4, 'verified', 'completed', $5::uuid,
          $6::jsonb)`,
      [
        attemptId,
        RUN_ID,
        sessionId,
        jobId,
        receiptId,
        JSON.stringify(TASK_BUNDLE),
      ],
    );
    await client.query(
      `INSERT INTO harness_result_receipts
         (receipt_id, attempt_id, run_id, provider, requested_provider,
          provider_session_id, task_bundle_sha256, worker_id, job_id,
          terminal_status)
       VALUES
         ($1::uuid, $2::uuid, $3::uuid, 'codex', 'codex', $4, $5,
          'linearization-worker', $6, 'completed')`,
      [
        receiptId,
        attemptId,
        RUN_ID,
        sessionId,
        TASK_BUNDLE_SHA,
        jobId,
      ],
    );
    await client.query(
      `INSERT INTO kernel_equivalence_production_cases
         (case_id, cell_id, behavior_id, provider, scenario, seam_id,
          adapter_id, run_id, attempt_id, artifact_sha, brain_version,
          engine_version, resource_type, resource_prefix, resource_id,
          resource_ref, expires_at)
       VALUES
         ($1::uuid, $2, $3, 'codex', 'normal', $4, $5, $6::uuid,
          $7::uuid, $8, $9, $10, 'ephemeral_run', $11,
          $7, $12, clock_timestamp() + interval '10 minutes')`,
      [
        caseId,
        CELL.cell_id,
        CELL.behavior_id,
        CELL.seam_id,
        CELL.adapter_id,
        RUN_ID,
        attemptId,
        ARTIFACT_SHA,
        BRAIN_VERSION,
        ENGINE_VERSION,
        resourcePrefix,
        resourceRef,
      ],
    );
    await client.query(
      `INSERT INTO kernel_equivalence_production_case_leases
         (case_id, owner_id, state, lease_expires_at)
       VALUES
         ($1::uuid, 'brain.kernel_equivalence.production_cases',
          'prepared', clock_timestamp() + interval '5 minutes')`,
      [caseId],
    );
    await client.query(
      `INSERT INTO kernel_equivalence_production_case_events
         (event_id, case_id, generation, event_type, status, evidence_ref,
          late_effect_risk)
       VALUES
         ($1::uuid, $2::uuid, 1, 'prepared', 'confirmed',
          'db:kernel-equivalence-production-cases/' || $2::text ||
            '/1/prepared',
          false)`,
      [randomUUID(), caseId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await pool.query(
    `INSERT INTO kernel_equivalence_production_case_bindings
       (case_id, result_receipt_id, provider_session_id,
        actual_machine_id, execution_transport, remote_job_id,
        task_bundle_sha256, artifact_sha)
     VALUES
       ($1::uuid, $2::uuid, $3, 'linearization-worker', 'fleet-worker',
        $4, $5, $6)`,
    [
      caseId,
      receiptId,
      sessionId,
      jobId,
      TASK_BUNDLE_SHA,
      ARTIFACT_SHA,
    ],
  );
  return {
    attemptId,
    caseId,
    resourceRef,
  };
}

async function issueGrant() {
  const productionCase = await createProductionCase();
  await pool.query(
    `INSERT INTO kernel_equivalence_production_execution_events
       (event_id, case_id, generation, controller_instance_id, state,
        late_effect_risk, controller_lease_expires_at)
     VALUES
       ($1::uuid, $2::uuid, 1, $3::uuid, 'claimed', false,
        LEAST(
          clock_timestamp() + interval '2 minutes',
          (
            SELECT lease_expires_at
              FROM kernel_equivalence_production_case_leases
             WHERE case_id = $2::uuid
          )
        ))`,
    [randomUUID(), productionCase.caseId, CONTROLLER_ID],
  );
  const published = await grantFileIssuer.issueProtectedGrant({
    case_id: productionCase.caseId,
    cell: CELL,
    run_id: RUN_ID,
    attempt_id: productionCase.attemptId,
    artifact_sha: ARTIFACT_SHA,
    brain_version: BRAIN_VERSION,
    engine_version: ENGINE_VERSION,
    resource_id: productionCase.attemptId,
    resource_ref: productionCase.resourceRef,
    ttl_seconds: 120,
  });
  const resolved = await grantFileAuthority.resolveProtectedGrant({
    cellId: CELL.cell_id,
    grantRef: published.grant_ref,
  });
  return {
    ...productionCase,
    ...published,
    resolved,
  };
}

async function grantEvents(grantId) {
  const result = await pool.query(
    `SELECT generation, state
       FROM kernel_equivalence_grant_events
      WHERE grant_id = $1::uuid
      ORDER BY generation`,
    [grantId],
  );
  return result.rows.map(({ generation, state }) => ({
    generation: Number(generation),
    state,
  }));
}

async function readCaseGrant(caseId) {
  const result = await pool.query(
    `SELECT grant_id, grant_digest,
            'kernel-equivalence-grant:' || grant_id::text AS grant_ref
       FROM kernel_equivalence_grant_authorities
      WHERE case_id = $1::uuid`,
    [caseId],
  );
  expect(result.rowCount).toBe(1);
  return result.rows[0];
}

async function createPublishedActorRevoker(grantId) {
  const actor = await pool.query(
    `SELECT actor_instance_id
       FROM kernel_equivalence_grant_events
      WHERE grant_id = $1::uuid
        AND generation = 1
        AND state = 'published'
        AND actor_kind = 'controller'`,
    [grantId],
  );
  expect(actor.rows).toEqual([{
    actor_instance_id: expect.any(String),
  }]);
  return createPostgresGrantExecutionAuthority({
    pool,
    actorInstanceId: actor.rows[0].actor_instance_id,
    lockTimeoutMs: 3_000,
  });
}

async function controllerEvents(caseId) {
  const result = await pool.query(
    `SELECT generation, state, grant_ref, code, late_effect_risk
       FROM kernel_equivalence_production_execution_events
      WHERE case_id = $1::uuid
      ORDER BY generation`,
    [caseId],
  );
  return result.rows.map((row) => ({
    ...row,
    generation: Number(row.generation),
  }));
}

async function expectExactBlockedEvidence({
  caseId,
  code,
  grant,
  stage = 'seam_execution',
}) {
  const evidence = await pool.query(
    `SELECT audits.code, audits.stage, audits.cell_id, audits.run_id,
            audits.attempt_id, authorities.grant_id,
            authorities.grant_digest,
            'kernel-equivalence-grant:' || authorities.grant_id::text
              AS grant_ref,
            lineage.grant_ref AS lineage_grant_ref
       FROM kernel_equivalence_denial_audits audits
       JOIN kernel_equivalence_production_cases cases
         ON cases.case_id = $1::uuid
        AND cases.cell_id = audits.cell_id
        AND cases.run_id = audits.run_id
        AND cases.attempt_id = audits.attempt_id
       JOIN kernel_equivalence_grant_authorities authorities
         ON authorities.case_id = cases.case_id
       JOIN LATERAL (
         SELECT events.grant_ref
           FROM kernel_equivalence_production_execution_events events
          WHERE events.case_id = cases.case_id
            AND events.grant_ref IS NOT NULL
          ORDER BY events.generation DESC
          LIMIT 1
       ) lineage ON true
      WHERE audits.code = $2
      ORDER BY audits.occurred_at DESC
      LIMIT 1`,
    [caseId, code],
  );
  expect(evidence.rows).toEqual([{
    code,
    stage,
    cell_id: CELL.cell_id,
    run_id: RUN_ID,
    attempt_id: expect.any(String),
    grant_id: grant.grant_id,
    grant_digest: grant.grant_digest,
    grant_ref: grant.grant_ref,
    lineage_grant_ref: grant.grant_ref,
  }]);
}

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  pool = new pg.Pool({
    ...DB_DEFAULTS,
    application_name: applicationName,
    options: `-c search_path=${schemaName}`,
    max: 12,
  });
  pool.on('connect', (client) => {
    const backendPid = client.processID;
    client.on('error', (error) => {
      expectedConnectionErrors.push({
        backendPid,
        error,
      });
    });
  });
  await pool.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
    );
    CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
    CREATE TABLE harness_attempts (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL REFERENCES initiative_runs(id),
      provider TEXT NOT NULL,
      provider_session_id TEXT,
      actual_machine_id TEXT,
      execution_transport TEXT,
      remote_job_id TEXT,
      machine_attestation_status TEXT,
      status TEXT,
      result_receipt_id UUID,
      task_bundle JSONB
    );
    CREATE TABLE harness_result_receipts (
      receipt_id UUID PRIMARY KEY,
      attempt_id UUID NOT NULL REFERENCES harness_attempts(id),
      run_id UUID NOT NULL REFERENCES initiative_runs(id),
      provider TEXT NOT NULL,
      requested_provider TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      task_bundle_sha256 TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      terminal_status TEXT NOT NULL
    );
    INSERT INTO initiative_runs (id) VALUES ('${RUN_ID}');
  `);
  for (const migration of migrations) {
    await pool.query(migration);
  }

  fixtureRoot = realpathSync(
    mkdtempSync(join(tmpdir(), 'kernel-grant-linearization-')),
  );
  grantRoot = join(fixtureRoot, 'grants');
  mkdirSync(grantRoot, { mode: 0o700 });
  chmodSync(grantRoot, 0o700);
  const keyPair = generateKeyPairSync('ed25519');
  const secretFile = join(fixtureRoot, 'authority.pem');
  writeFileSync(
    secretFile,
    keyPair.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
    { mode: 0o600 },
  );
  chmodSync(secretFile, 0o600);
  const now = Date.now();
  const authorityKey = {
    key_id: 'grant-linearization-authority',
    purpose: 'execution_grant',
    service_id: 'brain.authority',
    public_key_pem: keyPair.publicKey.export({
      type: 'spki',
      format: 'pem',
    }),
    not_before: new Date(now - 60_000).toISOString(),
    not_after: new Date(now + 3_600_000).toISOString(),
    revoked_at: null,
    rotates_key_id: null,
  };
  trustRegistry = Object.freeze({
    schema_version: 'kernel-equivalence-trust-registry/v1',
    algorithm: 'ed25519',
    grant_max_age_seconds: 300,
    effect_receipt_max_age_seconds: 300,
    collector_bundle_max_age_seconds: 300,
    replay_nonce: Object.freeze({
      single_use: true,
      atomic_consumer_required: true,
    }),
    keys: Object.freeze([Object.freeze(authorityKey)]),
  });
  grantSigner = loadExecutionGrantAuthority({
    secretFile,
    keyId: authorityKey.key_id,
    trustRegistry,
  });
  grantExecutionAuthority = createPostgresGrantExecutionAuthority({
    pool,
    actorInstanceId: CONTROLLER_ID,
    lockTimeoutMs: 3_000,
  });
  grantFileIssuer = createProtectedGrantFileIssuer({
    grantRoot,
    executionGrantAuthority: grantSigner,
    grantExecutionAuthority,
    maximumTtlSeconds: 120,
  });
  grantFileAuthority = createProtectedGrantFileAuthority({
    grantRoot,
    grantExecutionAuthority,
    authorityTimeoutMs: 3_000,
  });
  productionControl = createProductionControl();
  const production = createProductionManifest(fixtureRoot, now);
  const boot = await bootProductionBrainTrustedExecution({
    env: production.env,
    pool,
    assemblyPorts: productionAssemblyPorts(productionControl),
    now: Date.now,
  });
  expect(boot.getReadiness()).toMatchObject({
    ready: true,
    socket_path: join(socketRoot, 'trusted.sock'),
  });
  expect(boot.controller).not.toBeNull();
  productionHarness = Object.freeze({
    boot,
    controller: boot.controller,
  });
}, 20_000);

afterAll(async () => {
  if (productionHarness) await productionHarness.boot.close();
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  if (socketRoot) rmSync(socketRoot, { recursive: true, force: true });
});

describe('real PostgreSQL grant revocation linearization barriers', () => {
  it('production controller revoke-first blocks after trusted UDS prepare with exact grant evidence', async () => {
    productionControl.reset('revoke-first');
    const fixture = await createProductionCase();
    const execution = productionHarness.controller.executeCase(
      fixture.caseId,
    );
    await productionControl.prepareBarrier.waitUntilEntered();
    const grant = await readCaseGrant(fixture.caseId);
    const revoker = await createPublishedActorRevoker(grant.grant_id);

    await expect(timeoutAfter(
      revoker.revokeGrant({
        grant_id: grant.grant_id,
        grant_sha256: grant.grant_digest,
        reason: 'grant_authority_revalidation_failed',
        timeoutMs: 3_000,
      }),
      'production revoke-first revocation',
    )).resolves.toEqual({
      grant_ref: grant.grant_ref,
      revoked: true,
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
    });
    productionControl.prepareBarrier.release();
    await expect(timeoutAfter(
      execution,
      'production revoke-first controller',
      8_000,
    )).rejects.toMatchObject({
      code: 'production_controller_trusted_execution_result_invalid',
    });

    expect(await controllerEvents(fixture.caseId)).toEqual([
      {
        generation: 1,
        state: 'claimed',
        grant_ref: null,
        code: null,
        late_effect_risk: false,
      },
      {
        generation: 2,
        state: 'grant_issued',
        grant_ref: grant.grant_ref,
        code: null,
        late_effect_risk: false,
      },
      {
        generation: 3,
        state: 'executing',
        grant_ref: grant.grant_ref,
        code: null,
        late_effect_risk: false,
      },
      {
        generation: 4,
        state: 'blocked',
        grant_ref: grant.grant_ref,
        code: 'grant_authority_revalidation_failed',
        late_effect_risk: false,
      },
    ]);
    expect({
      prepareCalls: productionControl.prepareCalls,
      actualSeamCalls: productionControl.actualSeamCalls,
      cleanupCalls: productionControl.cleanupCalls,
    }).toEqual({
      prepareCalls: 1,
      actualSeamCalls: 0,
      cleanupCalls: 1,
    });
    const durableCounts = await pool.query(
      `SELECT
         (SELECT count(*)::integer
            FROM kernel_equivalence_execution_nonces
           WHERE grant_id = $1::uuid) AS nonce_count,
         (SELECT count(*)::integer
            FROM kernel_equivalence_receipt_bundles
           WHERE grant_id = $1::uuid) AS collector_count`,
      [grant.grant_id],
    );
    expect(durableCounts.rows).toEqual([{
      nonce_count: 1,
      collector_count: 0,
    }]);
    await expectExactBlockedEvidence({
      caseId: fixture.caseId,
      code: 'grant_authority_revalidation_failed',
      grant,
    });
  }, 15_000);

  it('production controller execution-first settles unknown after the actual UDS seam', async () => {
    productionControl.reset('execution-first');
    const fixture = await createProductionCase();
    const execution = productionHarness.controller.executeCase(
      fixture.caseId,
    );
    await productionControl.seamBarrier.waitUntilEntered();
    const grant = await readCaseGrant(fixture.caseId);
    const revoker = await createPublishedActorRevoker(grant.grant_id);

    let revokeSettled = false;
    const revocation =
      revoker.revokeGrant({
        grant_id: grant.grant_id,
        grant_sha256: grant.grant_digest,
        reason: 'adapter_cleanup_unconfirmed',
        timeoutMs: 6_000,
      }).finally(() => {
        revokeSettled = true;
      });
    await waitForLockWaiter('ExclusiveLock', grant.grant_id);
    expect(revokeSettled).toBe(false);
    productionControl.seamBarrier.release();
    await expect(timeoutAfter(
      revocation,
      'production execution-first revocation',
    )).resolves.toEqual({
      grant_ref: grant.grant_ref,
      revoked: true,
      safe_no_effect: false,
      effect_possible: true,
      disposition: 'effect_possible',
    });
    await expect(timeoutAfter(
      execution,
      'production execution-first controller',
      8_000,
    )).rejects.toMatchObject({
      code: 'production_controller_trusted_execution_result_invalid',
    });

    expect((await controllerEvents(fixture.caseId)).at(-1)).toEqual({
      generation: 4,
      state: 'settlement_unknown',
      grant_ref: grant.grant_ref,
      code: 'grant_revoke_unconfirmed',
      late_effect_risk: true,
    });
    expect({
      prepareCalls: productionControl.prepareCalls,
      actualSeamCalls: productionControl.actualSeamCalls,
      cleanupCalls: productionControl.cleanupCalls,
    }).toEqual({
      prepareCalls: 1,
      actualSeamCalls: 1,
      cleanupCalls: 1,
    });
    const bundles = await pool.query(
      `SELECT count(*)::integer AS collector_count
         FROM kernel_equivalence_receipt_bundles
        WHERE grant_id = $1::uuid`,
      [grant.grant_id],
    );
    expect(bundles.rows).toEqual([{ collector_count: 0 }]);
    await expectExactBlockedEvidence({
      caseId: fixture.caseId,
      code: 'adapter_cleanup_unconfirmed',
      grant,
      stage: 'adapter_cleanup',
    });
  }, 15_000);

  it('revoke-first denies the post-prepare seam and cannot be undone by restoring the file', async () => {
    const fixture = await issueGrant();
    const prepareBarrier = barrier('adapter prepare');
    let actualSeamCalls = 0;
    let collectorCalls = 0;
    let cleanupCalls = 0;
    const adapter = Object.freeze({
      prepare: async () => {
        prepareBarrier.enter();
        await prepareBarrier.waitUntilReleased();
        return Object.freeze({ prepared: true });
      },
      invokeActualSeam: async () => {
        actualSeamCalls += 1;
        throw new Error('revoked grant reached the actual seam');
      },
      observe: async () => {
        throw new Error('revoked grant reached observation');
      },
      cleanup: async () => {
        cleanupCalls += 1;
        return Object.freeze({ cleaned: true });
      },
      cancel: async () => Object.freeze({ confirmed: true }),
    });
    const cleanupVerifier = async (context) => Object.freeze({
      confirmed: true,
      evidence: createCleanupEvidence(context),
    });
    const execution = executeDrillCell({
      cell: CELL,
      grant: fixture.resolved.grant,
      trustRegistry,
      grantExecutionAuthority,
      adapters: { [CELL.adapter_id]: adapter },
      collector: async () => {
        collectorCalls += 1;
        throw new Error('revoked grant reached collection');
      },
      bundleChainStore: createPostgresBundleChainStore({ pool }),
      cleanupVerifier,
      auditSink: createPostgresAuditSink({ pool }),
      timeoutMs: 6_000,
    });

    await prepareBarrier.waitUntilEntered();
    const revoked = await timeoutAfter(
      grantExecutionAuthority.revokeGrant({
        grant_id: fixture.grant_id,
        grant_sha256: fixture.grant_sha256,
        reason: 'operator_cancelled',
        timeoutMs: 3_000,
      }),
      'revoke-first revocation',
    );
    expect(revoked).toMatchObject({
      safe_no_effect: true,
      effect_possible: false,
      disposition: 'safe_no_effect',
    });
    prepareBarrier.release();
    const result = await timeoutAfter(execution, 'revoke-first execution');
    expect(result).toMatchObject({
      status: 'blocked',
      code: 'grant_authority_revalidation_failed',
      bundle: null,
    });
    expect({
      actualSeamCalls,
      collectorCalls,
      cleanupCalls,
    }).toEqual({
      actualSeamCalls: 0,
      collectorCalls: 0,
      cleanupCalls: 1,
    });

    const grantPath = join(grantRoot, `${fixture.grant_id}.json`);
    const savedPath = join(grantRoot, `${fixture.grant_id}.saved`);
    const original = readFileSync(grantPath);
    renameSync(grantPath, savedPath);
    writeFileSync(grantPath, original, { mode: 0o600 });
    chmodSync(grantPath, 0o600);
    await expect(grantFileAuthority.resolveProtectedGrant({
      cellId: CELL.cell_id,
      grantRef: fixture.grant_ref,
    })).rejects.toMatchObject({
      code: 'protected_grant_authority_denied',
    });
    unlinkSync(grantPath);
    renameSync(savedPath, grantPath);
    await expect(grantFileAuthority.resolveProtectedGrant({
      cellId: CELL.cell_id,
      grantRef: fixture.grant_ref,
    })).rejects.toMatchObject({
      code: 'protected_grant_authority_denied',
    });
  }, 10_000);

  it('execution-first holds revocation until the actual seam is terminal', async () => {
    const fixture = await issueGrant();
    const seamBarrier = barrier('actual seam');
    let actualSeamCalls = 0;
    let cleanupCalls = 0;
    const adapter = Object.freeze({
      prepare: async () => Object.freeze({ prepared: true }),
      invokeActualSeam: async () => {
        actualSeamCalls += 1;
        seamBarrier.enter();
        await seamBarrier.waitUntilReleased();
        return 'actual-effect-completed';
      },
      observe: async () => {
        throw new Error('stop after durable actual-seam completion');
      },
      cleanup: async () => {
        cleanupCalls += 1;
        return Object.freeze({ cleaned: true });
      },
      cancel: async () => Object.freeze({ confirmed: true }),
    });
    const execution = executeDrillCell({
      cell: CELL,
      grant: fixture.resolved.grant,
      trustRegistry,
      grantExecutionAuthority,
      adapters: { [CELL.adapter_id]: adapter },
      collector: async () => {
        throw new Error('execution-first proof must stop before collection');
      },
      bundleChainStore: createPostgresBundleChainStore({ pool }),
      cleanupVerifier: async (context) => Object.freeze({
        confirmed: true,
        evidence: createCleanupEvidence(context),
      }),
      auditSink: createPostgresAuditSink({ pool }),
      timeoutMs: 6_000,
    });
    await seamBarrier.waitUntilEntered();

    let revokeSettled = false;
    const revocation = grantExecutionAuthority.revokeGrant({
      grant_id: fixture.grant_id,
      grant_sha256: fixture.grant_sha256,
      reason: 'operator_cancelled',
      timeoutMs: 6_000,
    }).finally(() => {
      revokeSettled = true;
    });
    await waitForLockWaiter('ExclusiveLock', fixture.grant_id);
    expect(revokeSettled).toBe(false);

    seamBarrier.release();
    await expect(timeoutAfter(execution, 'execution-first seam'))
      .resolves.toMatchObject({
        status: 'blocked',
        code: 'grant_effect_unknown',
      });
    await expect(timeoutAfter(revocation, 'execution-first revocation'))
      .resolves.toMatchObject({
        safe_no_effect: false,
        effect_possible: true,
        disposition: 'effect_possible',
      });
    expect({ actualSeamCalls, cleanupCalls }).toEqual({
      actualSeamCalls: 1,
      cleanupCalls: 1,
    });
    expect(await grantEvents(fixture.grant_id)).toEqual([
      { generation: 1, state: 'published' },
      { generation: 2, state: 'execution_intent' },
      { generation: 3, state: 'effect_completed' },
    ]);
  }, 10_000);

  it('connection death after committed intent releases the lock but remains effect_possible', async () => {
    const fixture = await issueGrant();
    const lockIdentity = advisoryLockIdentity(fixture.grant_id);
    const seamBarrier = barrier('connection-death seam');
    const execution = grantExecutionAuthority.invokeWhileActive({
      grant: fixture.resolved.grant,
      timeoutMs: 6_000,
      invoke: async () => {
        seamBarrier.enter();
        await seamBarrier.waitUntilReleased();
        return 'backend-was-killed';
      },
    });
    await seamBarrier.waitUntilEntered();

    const lockedBackend = await adminPool.query(
      `SELECT DISTINCT activity.pid, activity.backend_start,
              activity.application_name
         FROM pg_stat_activity activity
         JOIN pg_locks locks ON locks.pid = activity.pid
        WHERE activity.application_name = $1
          AND locks.locktype = 'advisory'
          AND locks.mode = 'ShareLock'
          AND locks.classid = $2::oid
          AND locks.objid = $3::oid
          AND locks.objsubid = 1
          AND locks.granted = true`,
      [
        applicationName,
        lockIdentity.classId,
        lockIdentity.objectId,
      ],
    );
    expect(lockedBackend.rowCount).toBe(1);
    expect(lockedBackend.rows[0]).toMatchObject({
      pid: expect.any(Number),
      backend_start: expect.any(Date),
      application_name: applicationName,
    });
    const killedPid = lockedBackend.rows[0].pid;
    await expect(adminPool.query(
      'SELECT pg_terminate_backend($1::integer) AS terminated',
      [killedPid],
    )).resolves.toMatchObject({
      rows: [{ terminated: true }],
    });

    await expect(timeoutAfter(
      grantExecutionAuthority.revokeGrant({
        grant_id: fixture.grant_id,
        grant_sha256: fixture.grant_sha256,
        reason: 'connection_lost',
        timeoutMs: 3_000,
      }),
      'connection-death revocation',
    )).resolves.toMatchObject({
      safe_no_effect: false,
      effect_possible: true,
      disposition: 'effect_possible',
    });
    seamBarrier.release();
    await expect(timeoutAfter(execution, 'connection-death execution'))
      .rejects.toMatchObject({
        safe_no_effect: false,
        effect_possible: true,
      });
    expect(expectedConnectionErrors.some((entry) => (
      entry.backendPid === killedPid
      && (
        entry.error?.code === '57P01'
        || entry.error?.message === 'Connection terminated unexpectedly'
      )
    ))).toBe(true);
    expect(await grantEvents(fixture.grant_id)).toEqual([
      { generation: 1, state: 'published' },
      { generation: 2, state: 'execution_intent' },
    ]);
  }, 10_000);

  it('nonce consumption and revocation expose exactly one first linearization', async () => {
    for (const first of ['nonce', 'revoke']) {
      const fixture = await issueGrant();
      const blocker = await adminPool.connect();
      const key = advisoryKey(fixture.grant_id);
      await blocker.query(
        'SELECT pg_advisory_lock($1::bigint)',
        [key],
      );
      try {
        let nonce;
        let revoke;
        if (first === 'nonce') {
          nonce = grantExecutionAuthority.consumeNonceIfActive({
            grant: fixture.resolved.grant,
            timeoutMs: 6_000,
          });
          await waitForLockWaiter('ShareLock', fixture.grant_id);
          revoke = grantExecutionAuthority.revokeGrant({
            grant_id: fixture.grant_id,
            grant_sha256: fixture.grant_sha256,
            reason: 'nonce_race',
            timeoutMs: 6_000,
          });
        } else {
          revoke = grantExecutionAuthority.revokeGrant({
            grant_id: fixture.grant_id,
            grant_sha256: fixture.grant_sha256,
            reason: 'nonce_race',
            timeoutMs: 6_000,
          });
          await waitForLockWaiter('ExclusiveLock', fixture.grant_id);
          nonce = grantExecutionAuthority.consumeNonceIfActive({
            grant: fixture.resolved.grant,
            timeoutMs: 6_000,
          });
        }
        await blocker.query(
          'SELECT pg_advisory_unlock($1::bigint)',
          [key],
        );
        const [nonceResult, revokeResult] = await timeoutAfter(
          Promise.allSettled([nonce, revoke]),
          `${first}-first nonce/revoke race`,
        );
        expect(revokeResult).toMatchObject({
          status: 'fulfilled',
          value: {
            safe_no_effect: true,
            effect_possible: false,
            disposition: 'safe_no_effect',
          },
        });
        const durableNonce = await pool.query(
          `SELECT consumed_at
             FROM kernel_equivalence_execution_nonces
            WHERE grant_id = $1::uuid`,
          [fixture.grant_id],
        );
        if (first === 'nonce') {
          expect(nonceResult.status).toBe('fulfilled');
          expect(nonceResult.value).toEqual({ consumed: true });
          expect(durableNonce.rowCount).toBe(1);
          const ordering = await pool.query(
            `SELECT nonce.consumed_at <= revoke.revoked_at AS nonce_first
               FROM kernel_equivalence_execution_nonces nonce
               JOIN kernel_equivalence_grant_revocations revoke
                 USING (grant_id)
              WHERE nonce.grant_id = $1::uuid`,
            [fixture.grant_id],
          );
          expect(ordering.rows).toEqual([{ nonce_first: true }]);
        } else {
          expect(nonceResult.status).toBe('rejected');
          expect(nonceResult.reason).toMatchObject({
            code: 'grant_authority_revalidation_failed',
          });
          expect(durableNonce.rowCount).toBe(0);
        }
      } finally {
        await blocker.query(
          'SELECT pg_advisory_unlock($1::bigint)',
          [key],
        );
        blocker.release();
      }
    }
  }, 15_000);
});
