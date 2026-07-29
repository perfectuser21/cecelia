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

import pg from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { executeDrillCell } from '../../lib/kernel-equivalence-drills.js';
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
const RUNTIME_ID = '33333333-3333-4333-8333-333333333333';
const ARTIFACT_SHA = 'a'.repeat(40);
const TASK_BUNDLE_SHA = 'b'.repeat(64);
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
const expectedConnectionErrors = [];

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

async function waitForLockWaiter(mode) {
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
          AND locks.granted = false`,
      [applicationName, mode],
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
        JSON.stringify({
          inputs: {
            workspace_spec: {
              expected_head_sha: ARTIFACT_SHA,
            },
          },
        }),
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
          $7::uuid, $8, '1.268.29', '19.7.1', 'ephemeral_run', $9,
          $7, $10, clock_timestamp() + interval '10 minutes')`,
      [
        caseId,
        CELL.cell_id,
        CELL.behavior_id,
        CELL.seam_id,
        CELL.adapter_id,
        RUN_ID,
        attemptId,
        ARTIFACT_SHA,
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
  const published = await grantFileIssuer.issueProtectedGrant({
    case_id: productionCase.caseId,
    cell: CELL,
    run_id: RUN_ID,
    attempt_id: productionCase.attemptId,
    artifact_sha: ARTIFACT_SHA,
    brain_version: '1.268.29',
    engine_version: '19.7.1',
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
    client.on('error', (error) => {
      expectedConnectionErrors.push(error);
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
}, 20_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('real PostgreSQL grant revocation linearization barriers', () => {
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
    await waitForLockWaiter('ExclusiveLock');
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
      `SELECT DISTINCT activity.pid
         FROM pg_stat_activity activity
         JOIN pg_locks locks ON locks.pid = activity.pid
        WHERE activity.application_name = $1
          AND locks.locktype = 'advisory'
          AND locks.mode = 'ShareLock'
          AND locks.granted = true`,
      [applicationName],
    );
    expect(lockedBackend.rowCount).toBe(1);
    await expect(adminPool.query(
      'SELECT pg_terminate_backend($1::integer) AS terminated',
      [lockedBackend.rows[0].pid],
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
    expect(expectedConnectionErrors.some((error) => (
      error?.code === '57P01'
      || error?.message === 'Connection terminated unexpectedly'
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
          await waitForLockWaiter('ShareLock');
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
          await waitForLockWaiter('ExclusiveLock');
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
