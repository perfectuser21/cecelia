import {
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { load as loadYaml } from 'js-yaml';
import pg from 'pg';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { compileDrillPlan } from '../../lib/kernel-equivalence-drills.js';
import {
  createPostgresKernelEquivalenceCoordinator,
} from '../../lib/kernel-equivalence-production-coordinator.js';
import {
  createProtectedGrantFileIssuer,
} from '../../lib/kernel-equivalence-protected-grant-authority.js';
import {
  loadExecutionGrantAuthority,
  loadTrustedExecutionReadinessSigner,
} from '../../lib/kernel-equivalence-signers.js';
import {
  startBrainTrustedExecutionSocketServer,
} from '../../lib/kernel-equivalence-trusted-execution-socket-server.js';
import {
  computeFleetAuthoritySha256,
} from '../../orchestrator/fleet-callback-auth.js';
import {
  createKernelEquivalenceControllerRouter,
} from '../../routes/kernel-equivalence-controller.js';

const migration = readFileSync(
  new URL(
    '../../../migrations/381_kernel_equivalence_production_controller.sql',
    import.meta.url,
  ),
  'utf8',
);
const contract = loadYaml(readFileSync(
  new URL('../../../../../regression-contract.yaml', import.meta.url),
  'utf8',
));
const plan = compileDrillPlan(contract, {
  now: Date.parse('2026-07-29T00:00:00.000Z'),
});
const schemaName =
  `kernel_controller_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const ACTIVE_CASE = '11111111-1111-4111-8111-111111111111';
const ACTIVE_ATTEMPT = '22222222-2222-4222-8222-222222222222';
const ACTIVE_RECEIPT = '33333333-3333-4333-8333-333333333333';
const EXPIRED_CASE = '44444444-4444-4444-8444-444444444444';
const EXPIRED_ATTEMPT = '55555555-5555-4555-8555-555555555555';
const EXPIRED_RECEIPT = '66666666-6666-4666-8666-666666666666';
const RUN_ID = '77777777-7777-4777-8777-777777777777';
const OLD_CONTROLLER = '88888888-8888-4888-8888-888888888888';
const NEW_CONTROLLER = '99999999-9999-4999-8999-999999999999';
const CRASHED_RECOVERY_CONTROLLER =
  'abababab-abab-4bab-8bab-abababababab';
const TERMINAL_CASE = 'acacacac-acac-4cac-8cac-acacacacacac';
const TERMINAL_ATTEMPT = 'adadadad-adad-4dad-8dad-adadadadadad';
const TERMINAL_RECEIPT = 'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae';
const EXECUTE_CASE = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
const EXECUTE_ATTEMPT = 'bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd';
const EXECUTE_RECEIPT = 'bebebebe-bebe-4ebe-8ebe-bebebebebebe';
const REVOKED_CASE = 'cacacaca-caca-4aca-8aca-cacacacacaca';
const REVOKED_ATTEMPT = 'cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb';
const REVOKED_RECEIPT = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const SHARED_RECEIPT_CASE = 'dacadaca-daca-4aca-8aca-dacadacadaca';
const LOCKED_CASE = 'dbdbdbdb-dbdb-4bdb-8bdb-dbdbdbdbdbdb';
const LOCKED_ATTEMPT = 'dcdcdcdc-dcdc-4cdc-8cdc-dcdcdcdcdcdc';
const LOCKED_RECEIPT = 'dededede-dede-4ede-8ede-dededededede';
const ARTIFACT_SHA = 'a'.repeat(40);
const CELL_ID =
  'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::codex::normal';
const BEHAVIOR_ID = 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION';
const SEAM_ID = 'kernel.controller.attempt_ownership';
const ADAPTER_ID = 'kernel.drill.controller_session_isolation.v1';
const TASK_BUNDLE = {
  inputs: {
    workspace_spec: {
      expected_head_sha: ARTIFACT_SHA,
    },
  },
};
const TASK_BUNDLE_SHA = computeFleetAuthoritySha256(TASK_BUNDLE);

let adminPool;
let pool;

function protectedIssuer() {
  return Object.freeze({
    owner_service: 'brain.kernel_equivalence.grant_issuer',
    capability_id:
      'brain.kernel_equivalence.protected_grant_issuer.v1',
    issueProtectedGrant: async () => {
      throw new Error('startup reconciliation must not issue a grant');
    },
    cleanupExpiredGrants: async () => ({ removed: 0, retained: 0 }),
  });
}

async function insertAuthority({
  attemptId,
  caseId,
  receiptId,
  sessionId,
}) {
  const resourcePrefix =
    `equivalence-drill/${RUN_ID}/${attemptId}/controller/`;
  await pool.query(
    `INSERT INTO harness_attempts
       (id, run_id, provider, provider_session_id, actual_machine_id,
        execution_transport, remote_job_id, machine_attestation_status,
        status, result_receipt_id, task_bundle)
     VALUES
       ($1::uuid, $2::uuid, 'codex', $3, 'xian-mac-m4',
        'fleet-worker', $4, 'verified', 'completed',
        $5::uuid, $6::jsonb)`,
    [
      attemptId,
      RUN_ID,
      sessionId,
      `job-${attemptId}`,
      receiptId,
      JSON.stringify(TASK_BUNDLE),
    ],
  );
  await pool.query(
    `INSERT INTO harness_result_receipts
       (receipt_id, attempt_id, run_id, provider, requested_provider,
        provider_session_id, task_bundle_sha256)
     VALUES
       ($1::uuid, $2::uuid, $3::uuid, 'codex', 'codex', $4, $5)`,
    [receiptId, attemptId, RUN_ID, sessionId, TASK_BUNDLE_SHA],
  );
  await pool.query(
    `INSERT INTO kernel_equivalence_production_cases
       (case_id, cell_id, behavior_id, provider, scenario, seam_id,
        adapter_id, run_id, attempt_id, artifact_sha, brain_version,
        engine_version, resource_type, resource_prefix, resource_id,
        resource_ref, expires_at)
     VALUES
       ($1::uuid, $2, $3, 'codex', 'normal', $4, $5,
        $6::uuid, $7::uuid, $8, '1.268.28', '19.7.1',
        'ephemeral_run', $9, $7, $9 || $7,
        clock_timestamp() + interval '10 minutes')`,
    [
      caseId,
      CELL_ID,
      BEHAVIOR_ID,
      SEAM_ID,
      ADAPTER_ID,
      RUN_ID,
      attemptId,
      ARTIFACT_SHA,
      resourcePrefix,
    ],
  );
  await pool.query(
    `INSERT INTO kernel_equivalence_production_case_leases
       (case_id, owner_id, state, lease_expires_at)
     VALUES
       ($1::uuid, 'brain.kernel_equivalence.production_cases',
        'prepared', clock_timestamp() + interval '5 minutes')`,
    [caseId],
  );
  await pool.query(
    `INSERT INTO kernel_equivalence_production_case_bindings
       (case_id, result_receipt_id, provider_session_id,
        actual_machine_id, execution_transport, remote_job_id,
        task_bundle_sha256, artifact_sha)
     VALUES
       ($1::uuid, $2::uuid, $3, 'xian-mac-m4', 'fleet-worker',
        $4, $5, $6)`,
    [
      caseId,
      receiptId,
      sessionId,
      `job-${attemptId}`,
      TASK_BUNDLE_SHA,
      ARTIFACT_SHA,
    ],
  );
}

async function insertClaim({
  caseId,
  eventId,
  leaseSql,
}) {
  await pool.query(
    `INSERT INTO kernel_equivalence_production_execution_events
       (event_id, case_id, generation, controller_instance_id, state,
        late_effect_risk, occurred_at, controller_lease_expires_at)
     VALUES
       ($1::uuid, $2::uuid, 1, $3::uuid, 'claimed', false,
        clock_timestamp() - interval '2 minutes', ${leaseSql})`,
    [eventId, caseId, OLD_CONTROLLER],
  );
}

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  pool = new pg.Pool({
    ...DB_DEFAULTS,
    options: `-c search_path=${schemaName}`,
    max: 4,
  });
  await pool.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
    );
    CREATE TABLE harness_attempts (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL,
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
      attempt_id UUID NOT NULL,
      run_id UUID NOT NULL,
      provider TEXT NOT NULL,
      requested_provider TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      task_bundle_sha256 TEXT NOT NULL
    );
    CREATE TABLE kernel_equivalence_production_cases (
      case_id UUID PRIMARY KEY,
      cell_id TEXT NOT NULL,
      behavior_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      scenario TEXT NOT NULL,
      seam_id TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      run_id UUID NOT NULL,
      attempt_id UUID NOT NULL REFERENCES harness_attempts(id),
      artifact_sha TEXT NOT NULL,
      brain_version TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_prefix TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_ref TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE kernel_equivalence_receipt_bundles (
      bundle_hash TEXT PRIMARY KEY,
      cell_id TEXT NOT NULL,
      behavior_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      scenario TEXT NOT NULL,
      run_id UUID NOT NULL,
      attempt_id UUID NOT NULL,
      artifact_sha TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_ref TEXT NOT NULL,
      seam_id TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE kernel_equivalence_production_case_leases (
      case_id UUID PRIMARY KEY
        REFERENCES kernel_equivalence_production_cases(case_id),
      owner_id TEXT NOT NULL,
      state TEXT NOT NULL,
      lease_expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(migration);
  await pool.query(migration);
  await insertAuthority({
    attemptId: ACTIVE_ATTEMPT,
    caseId: ACTIVE_CASE,
    receiptId: ACTIVE_RECEIPT,
    sessionId: 'active-session',
  });
  await insertAuthority({
    attemptId: EXPIRED_ATTEMPT,
    caseId: EXPIRED_CASE,
    receiptId: EXPIRED_RECEIPT,
    sessionId: 'expired-session',
  });
  await insertAuthority({
    attemptId: TERMINAL_ATTEMPT,
    caseId: TERMINAL_CASE,
    receiptId: TERMINAL_RECEIPT,
    sessionId: 'terminal-session',
  });
  await insertAuthority({
    attemptId: EXECUTE_ATTEMPT,
    caseId: EXECUTE_CASE,
    receiptId: EXECUTE_RECEIPT,
    sessionId: 'execute-session',
  });
  await insertAuthority({
    attemptId: REVOKED_ATTEMPT,
    caseId: REVOKED_CASE,
    receiptId: REVOKED_RECEIPT,
    sessionId: 'revoked-session',
  });
  await insertAuthority({
    attemptId: LOCKED_ATTEMPT,
    caseId: LOCKED_CASE,
    receiptId: LOCKED_RECEIPT,
    sessionId: 'locked-session',
  });
  await insertClaim({
    caseId: ACTIVE_CASE,
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    leaseSql: "clock_timestamp() + interval '5 minutes'",
  });
  await insertClaim({
    caseId: EXPIRED_CASE,
    eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    leaseSql: "clock_timestamp() - interval '1 minute'",
  });
  await pool.query(
    `INSERT INTO kernel_equivalence_production_execution_events
       (event_id, case_id, generation, controller_instance_id, state,
        late_effect_risk, occurred_at, controller_lease_expires_at)
     VALUES
       ('bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', $1::uuid, 2,
        $2::uuid, 'reconciling', false,
        clock_timestamp() - interval '30 seconds',
        clock_timestamp() - interval '1 second')`,
    [EXPIRED_CASE, CRASHED_RECOVERY_CONTROLLER],
  );
  await insertClaim({
    caseId: TERMINAL_CASE,
    eventId: 'afafafaf-afaf-4faf-8faf-afafafafafaf',
    leaseSql: "clock_timestamp() + interval '5 minutes'",
  });
  await pool.query(
    `INSERT INTO kernel_equivalence_production_execution_events
       (event_id, case_id, generation, controller_instance_id, state,
        code, late_effect_risk)
     VALUES
       ('babebabe-babe-4abe-8abe-babebabebabe', $1::uuid, 2,
        $2::uuid, 'blocked', 'terminal_fixture', false)`,
    [TERMINAL_CASE, OLD_CONTROLLER],
  );
}, 15_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

describe('production controller restart fencing on real PostgreSQL', () => {
  it('freezes Attempt authority after a production case is bound', async () => {
    await expect(pool.query(
      `UPDATE harness_attempts
          SET provider_session_id = 'forged-session'
        WHERE id = $1::uuid`,
      [ACTIVE_ATTEMPT],
    )).rejects.toThrow(/bound Attempt authority is immutable/i);
    await expect(pool.query(
      `UPDATE harness_attempts
          SET status = 'failed'
        WHERE id = $1::uuid`,
      [ACTIVE_ATTEMPT],
    )).rejects.toThrow(/bound Attempt authority is immutable/i);
  });

  it('binds separate cells to one Attempt receipt but rejects a wrong receipt', async () => {
    const resourcePrefix =
      `equivalence-drill/${RUN_ID}/${ACTIVE_ATTEMPT}/judge/`;
    await pool.query(
      `INSERT INTO kernel_equivalence_production_cases
         (case_id, cell_id, behavior_id, provider, scenario, seam_id,
          adapter_id, run_id, attempt_id, artifact_sha, brain_version,
          engine_version, resource_type, resource_prefix, resource_id,
          resource_ref, expires_at)
       VALUES
         ($1::uuid,
          'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE::codex::normal',
          'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE', 'codex', 'normal',
          'kernel.evaluation.independent_judge',
          'kernel.drill.independent_evaluator_judge.v1',
          $2::uuid, $3::uuid, $4, '1.268.28', '19.7.1',
          'ephemeral_run', $5, $3, $5 || $3,
          clock_timestamp() + interval '10 minutes')`,
      [
        SHARED_RECEIPT_CASE,
        RUN_ID,
        ACTIVE_ATTEMPT,
        ARTIFACT_SHA,
        resourcePrefix,
      ],
    );
    await pool.query(
      `INSERT INTO kernel_equivalence_production_case_leases
         (case_id, owner_id, state, lease_expires_at)
       VALUES
         ($1::uuid, 'brain.kernel_equivalence.production_cases',
          'prepared', clock_timestamp() + interval '5 minutes')`,
      [SHARED_RECEIPT_CASE],
    );
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_case_bindings
         (case_id, result_receipt_id, provider_session_id,
          actual_machine_id, execution_transport, remote_job_id,
          task_bundle_sha256, artifact_sha)
       VALUES
         ($1::uuid, $2::uuid, 'active-session', 'xian-mac-m4',
          'fleet-worker', $3, $4, $5)`,
      [
        SHARED_RECEIPT_CASE,
        EXPIRED_RECEIPT,
        `job-${ACTIVE_ATTEMPT}`,
        TASK_BUNDLE_SHA,
        ARTIFACT_SHA,
      ],
    )).rejects.toThrow(/authority binding mismatch/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_case_bindings
         (case_id, result_receipt_id, provider_session_id,
          actual_machine_id, execution_transport, remote_job_id,
          task_bundle_sha256, artifact_sha)
       VALUES
         ($1::uuid, $2::uuid, 'active-session', 'xian-mac-m4',
          'fleet-worker', $3, $4, $5)`,
      [
        SHARED_RECEIPT_CASE,
        ACTIVE_RECEIPT,
        `job-${ACTIVE_ATTEMPT}`,
        TASK_BUNDLE_SHA,
        ARTIFACT_SHA,
      ],
    );
    const bindings = await pool.query(
      `SELECT case_id
         FROM kernel_equivalence_production_case_bindings
        WHERE result_receipt_id = $1::uuid
        ORDER BY case_id`,
      [ACTIVE_RECEIPT],
    );
    expect(bindings.rows).toHaveLength(2);
  });

  it('rejects an existing binding after its case lease is revoked', async () => {
    await pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET state = 'cancelled'
        WHERE case_id = $1::uuid`,
      [REVOKED_CASE],
    );
    const coordinator = createPostgresKernelEquivalenceCoordinator({
      pool,
      grantIssuer: protectedIssuer(),
      plan,
      socketPath: '/var/run/cecelia/kernel-equivalence.sock',
      brainVersion: '1.268.28',
      engineVersion: '19.7.1',
      grantTtlSeconds: 60,
      now: Date.now,
    });

    await expect(coordinator.executeCase(REVOKED_CASE)).rejects.toMatchObject({
      code: 'production_controller_authority_unavailable',
    });
    const events = await pool.query(
      `SELECT state
         FROM kernel_equivalence_production_execution_events
        WHERE case_id = $1::uuid`,
      [REVOKED_CASE],
    );
    expect(events.rows).toEqual([]);
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          late_effect_risk, controller_lease_expires_at)
       VALUES
         ('cececece-cece-4ece-8ece-cececececece', $1::uuid, 1,
          $2::uuid, 'claimed', false,
          clock_timestamp() + interval '1 minute')`,
      [REVOKED_CASE, NEW_CONTROLLER],
    )).rejects.toThrow(
      /production execution claim authority unavailable/i,
    );
  });

  it('rejects takeover while the prior database lease is active', async () => {
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          late_effect_risk, controller_lease_expires_at)
       VALUES
         ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1::uuid, 2,
          $2::uuid, 'reconciling', false,
          clock_timestamp() + interval '1 minute')`,
      [ACTIVE_CASE, NEW_CONTROLLER],
    )).rejects.toThrow(/controller ownership mismatch/i);
  });

  it('serializes case cancellation behind active execution settlement', async () => {
    const claimClient = await pool.connect();
    let claimCommitted = false;
    let concurrentCancellation;
    try {
      await claimClient.query('BEGIN');
      await claimClient.query(
        `INSERT INTO kernel_equivalence_production_execution_events
           (event_id, case_id, generation, controller_instance_id, state,
            late_effect_risk, controller_lease_expires_at)
         VALUES
           ('dfdfdfdf-dfdf-4fdf-8fdf-dfdfdfdfdfdf', $1::uuid, 1,
            $2::uuid, 'claimed', false,
            clock_timestamp() + interval '1 minute')`,
        [LOCKED_CASE, NEW_CONTROLLER],
      );
      concurrentCancellation = pool.query(
        `UPDATE kernel_equivalence_production_case_leases
            SET state = 'cancelling'
          WHERE case_id = $1::uuid`,
        [LOCKED_CASE],
      );
      await new Promise((resolve) => setImmediate(resolve));
      await claimClient.query('COMMIT');
      claimCommitted = true;
      await expect(concurrentCancellation).rejects.toThrow(
        /active production execution/i,
      );
    } finally {
      if (!claimCommitted) {
        await claimClient.query('ROLLBACK');
        await concurrentCancellation?.catch(() => {});
      }
      claimClient.release();
    }
    await expect(pool.query(
      `UPDATE kernel_equivalence_production_execution_fences
          SET execution_active = false
        WHERE case_id = $1::uuid`,
      [LOCKED_CASE],
    )).rejects.toThrow(/execution fence state mismatch/i);
    await expect(pool.query(
      `DELETE FROM kernel_equivalence_production_execution_fences
        WHERE case_id = $1::uuid`,
      [LOCKED_CASE],
    )).rejects.toThrow(/append-only/i);
    await pool.query(
      `ALTER TABLE kernel_equivalence_production_execution_fences
         DISABLE TRIGGER trg_kernel_equivalence_execution_fences_no_delete`,
    );
    try {
      await pool.query(
        `DELETE FROM kernel_equivalence_production_execution_fences
          WHERE case_id = $1::uuid`,
        [LOCKED_CASE],
      );
    } finally {
      await pool.query(
        `ALTER TABLE kernel_equivalence_production_execution_fences
           ENABLE TRIGGER trg_kernel_equivalence_execution_fences_no_delete`,
      );
    }
    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET state = 'cancelling'
        WHERE case_id = $1::uuid`,
      [LOCKED_CASE],
    )).rejects.toThrow(/execution fence missing/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_fences
         (case_id, execution_active)
       VALUES ($1::uuid, true)`,
      [LOCKED_CASE],
    );
    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET state = 'cancelling'
        WHERE case_id = $1::uuid`,
      [LOCKED_CASE],
    )).rejects.toThrow(/active production execution/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          code, late_effect_risk)
       VALUES
         ('eaeaeaea-eaea-4aea-8aea-eaeaeaeaeaea', $1::uuid, 2,
          $2::uuid, 'blocked', 'terminal_fixture', false)`,
      [LOCKED_CASE, NEW_CONTROLLER],
    );
    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET state = 'cancelling'
        WHERE case_id = $1::uuid`,
      [LOCKED_CASE],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it('retakes an expired reconciliation lease after a restart crash', async () => {
    const ids = [
      NEW_CONTROLLER,
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    ];
    const coordinator = createPostgresKernelEquivalenceCoordinator({
      pool,
      grantIssuer: protectedIssuer(),
      plan,
      socketPath: '/var/run/cecelia/kernel-equivalence.sock',
      brainVersion: '1.268.28',
      engineVersion: '19.7.1',
      grantTtlSeconds: 60,
      randomUUID: () => ids.shift(),
      now: () => Date.parse('2026-07-29T00:00:00.000Z'),
    });

    await expect(coordinator.reconcileStartup()).resolves.toEqual({
      inspected: 2,
      settled: 0,
      retained_unknown: 2,
    });
    const result = await pool.query(
      `SELECT generation, controller_instance_id, state,
              controller_lease_expires_at
         FROM kernel_equivalence_production_execution_events
        WHERE case_id = $1::uuid
        ORDER BY generation`,
      [EXPIRED_CASE],
    );
    expect(result.rows.map(({ state }) => state)).toEqual([
      'claimed',
      'reconciling',
      'reconciling',
      'settlement_unknown',
    ]);
    expect(result.rows[2]).toMatchObject({
      controller_instance_id: NEW_CONTROLLER,
      controller_lease_expires_at: expect.any(Date),
    });
    expect(result.rows[3]).toMatchObject({
      controller_instance_id: NEW_CONTROLLER,
      controller_lease_expires_at: null,
    });
    const terminal = await pool.query(
      `SELECT state
         FROM kernel_equivalence_production_execution_events
        WHERE case_id = $1::uuid
        ORDER BY generation`,
      [TERMINAL_CASE],
    );
    expect(terminal.rows.map(({ state }) => state)).toEqual([
      'claimed',
      'blocked',
    ]);
    await expect(pool.query(
      `UPDATE kernel_equivalence_production_case_leases
          SET state = 'cancelling'
        WHERE case_id = $1::uuid`,
      [EXPIRED_CASE],
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it('executes an authenticated HTTP case through DB authority and a real Unix socket', async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'kernel-controller-route-')),
    );
    const grantRoot = join(root, 'grants');
    mkdirSync(grantRoot, { mode: 0o700 });
    chmodSync(grantRoot, 0o700);
    const socketPath = join(root, 'trusted.sock');
    const now = Date.now;
    const notBefore = new Date(now() - 86_400_000).toISOString();
    const notAfter = new Date(now() + 86_400_000).toISOString();
    const authorityKeys = generateKeyPairSync('ed25519');
    const readinessKeys = generateKeyPairSync('ed25519');
    const authorityRecord = {
      key_id: 'controller-authority-live',
      purpose: 'execution_grant',
      service_id: 'brain.authority',
      public_key_pem: authorityKeys.publicKey.export({
        type: 'spki',
        format: 'pem',
      }),
      not_before: notBefore,
      not_after: notAfter,
      revoked_at: null,
      rotates_key_id: null,
    };
    const readinessRecord = {
      key_id: 'controller-readiness-live',
      purpose: 'trusted_execution_readiness',
      service_id: 'brain.kernel_equivalence.trusted_execution',
      public_key_pem: readinessKeys.publicKey.export({
        type: 'spki',
        format: 'pem',
      }),
      not_before: notBefore,
      not_after: notAfter,
      revoked_at: null,
      rotates_key_id: null,
    };
    const registry = {
      schema_version: 'kernel-equivalence-trust-registry/v1',
      algorithm: 'ed25519',
      grant_max_age_seconds: 300,
      effect_receipt_max_age_seconds: 86_400,
      collector_bundle_max_age_seconds: 86_400,
      replay_nonce: {
        single_use: true,
        atomic_consumer_required: true,
      },
      keys: [authorityRecord, readinessRecord],
    };
    const authorityFile = join(root, 'authority.pem');
    const readinessFile = join(root, 'readiness.pem');
    writeFileSync(
      authorityFile,
      authorityKeys.privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      readinessFile,
      readinessKeys.privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
      { mode: 0o600 },
    );
    chmodSync(authorityFile, 0o600);
    chmodSync(readinessFile, 0o600);
    const grantAuthority = loadExecutionGrantAuthority({
      secretFile: authorityFile,
      keyId: authorityRecord.key_id,
      trustRegistry: registry,
      now,
    });
    const grantIssuer = createProtectedGrantFileIssuer({
      grantRoot,
      executionGrantAuthority: grantAuthority,
      maximumTtlSeconds: 60,
      now,
    });
    const readinessSigner = loadTrustedExecutionReadinessSigner({
      secretFile: readinessFile,
      keyId: readinessRecord.key_id,
      trustRegistry: registry,
      now,
    });
    const bundleHash = 'c'.repeat(64);
    await pool.query(
      `INSERT INTO kernel_equivalence_receipt_bundles
         (bundle_hash, cell_id, behavior_id, provider, scenario,
          run_id, attempt_id, artifact_sha, resource_id, resource_ref,
          seam_id, adapter_id)
       SELECT
         $1, cell_id, behavior_id, provider, scenario, run_id,
         attempt_id, artifact_sha, resource_id, resource_ref, seam_id,
         adapter_id
       FROM kernel_equivalence_production_cases
       WHERE case_id = $2::uuid`,
      [bundleHash, EXECUTE_CASE],
    );
    const service = Object.freeze({
      schema_version:
        'kernel-equivalence-trusted-execution-service/v1',
      cell_count: 99,
      adapter_count: 10,
      plan_digest: 'd'.repeat(64),
      execute: async () => Object.freeze({
        status: 'collected',
        bundle: Object.freeze({ bundle_hash: bundleHash }),
      }),
    });
    let listener;
    try {
      listener = await startBrainTrustedExecutionSocketServer({
        service,
        readinessSigner,
        socketPath,
      });
      const controller = createPostgresKernelEquivalenceCoordinator({
        pool,
        grantIssuer,
        plan,
        socketPath,
        brainVersion: '1.268.28',
        engineVersion: '19.7.1',
        grantTtlSeconds: 60,
        now,
      });
      const token = 'production-controller-integration-token'.repeat(2);
      const http = express();
      http.use(express.json());
      http.use(
        '/api/brain/kernel-equivalence',
        createKernelEquivalenceControllerRouter({
          getController: () => controller,
          getToken: () => token,
        }),
      );

      const responses = await Promise.all([
        request(http)
          .post('/api/brain/kernel-equivalence/cases/execute')
          .set('Authorization', `Bearer ${token}`)
          .send({ case_id: EXECUTE_CASE }),
        request(http)
          .post('/api/brain/kernel-equivalence/cases/execute')
          .set('Authorization', `Bearer ${token}`)
          .send({ case_id: EXECUTE_CASE }),
      ]);
      responses.sort((left, right) => left.status - right.status);
      const [response, duplicate] = responses;

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        result: {
          case_id: EXECUTE_CASE,
          state: 'succeeded',
          bundle_hash: bundleHash,
        },
      });
      const events = await pool.query(
        `SELECT state
           FROM kernel_equivalence_production_execution_events
          WHERE case_id = $1::uuid
          ORDER BY generation`,
        [EXECUTE_CASE],
      );
      expect(events.rows.map(({ state }) => state)).toEqual([
        'claimed',
        'grant_issued',
        'executing',
        'succeeded',
      ]);
      expect(
        duplicate.status,
        JSON.stringify(duplicate.body),
      ).toBe(409);
      expect(duplicate.body.error).toBe(
        'production_controller_case_already_claimed',
      );
    } finally {
      await listener?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
