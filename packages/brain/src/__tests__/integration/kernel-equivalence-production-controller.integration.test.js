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
const RACING_CASE = 'eaeaeaea-eaea-4aea-8aea-eaeaeaeaeaea';
const RACING_ATTEMPT = 'ebebebeb-ebeb-4beb-8beb-ebebebebebeb';
const RACING_RECEIPT = 'ecececec-ecec-4cec-8cec-ecececececec';
const RECEIPT_MISMATCH_CASE = 'edededed-eded-4ded-8ded-edededededed';
const RECEIPT_MISMATCH_ATTEMPT =
  'efefefef-efef-4fef-8fef-efefefefefef';
const RECEIPT_MISMATCH_RECEIPT =
  'fafafafa-fafa-4afa-8afa-fafafafafafa';
const CLAIM_ONLY_CASE = 'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1';
const CLAIM_ONLY_ATTEMPT = 'f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2';
const CLAIM_ONLY_RECEIPT = 'f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3';
const LINEAGE_CASE = 'f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f4';
const LINEAGE_ATTEMPT = 'f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f5';
const LINEAGE_RECEIPT = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6';
const RECONCILE_CASE = '91919191-9191-4191-8191-919191919191';
const RECONCILE_ATTEMPT = '92929292-9292-4292-8292-929292929292';
const RECONCILE_RECEIPT = '93939393-9393-4393-8393-939393939393';
const MISMATCH_CASE = '94949494-9494-4494-8494-949494949494';
const MISMATCH_ATTEMPT = '95959595-9595-4595-8595-959595959595';
const MISMATCH_RECEIPT = '96969696-9696-4696-8696-969696969696';
const GRANT_A = '10101010-1010-4010-8010-101010101010';
const GRANT_B = '20202020-2020-4020-8020-202020202020';
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
    revokeProtectedGrant: async ({ grant_ref: grantRef }) => ({
      grant_ref: grantRef,
      revoked: true,
    }),
    cleanupExpiredGrants: async () => ({ removed: 0, retained: 0 }),
  });
}

async function insertAuthority({
  attemptId,
  bind = true,
  caseId,
  receiptId,
  receiptJobId = `job-${attemptId}`,
  receiptStatus = 'completed',
  receiptWorkerId = 'xian-mac-m4',
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
        provider_session_id, task_bundle_sha256, worker_id, job_id,
        terminal_status)
     VALUES
       ($1::uuid, $2::uuid, $3::uuid, 'codex', 'codex', $4, $5,
        $6, $7, $8)`,
    [
      receiptId,
      attemptId,
      RUN_ID,
      sessionId,
      TASK_BUNDLE_SHA,
      receiptWorkerId,
      receiptJobId,
      receiptStatus,
    ],
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
  if (!bind) return;
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
        clock_timestamp() - interval '2 minutes',
        LEAST(
          ${leaseSql},
          (
            SELECT lease_expires_at
              FROM kernel_equivalence_production_case_leases
             WHERE case_id = $2::uuid
          )
        ))`,
    [eventId, caseId, OLD_CONTROLLER],
  );
}

async function insertBundle({
  bundleHash,
  caseId,
  grantId,
}) {
  await pool.query(
    `INSERT INTO kernel_equivalence_receipt_bundles
       (bundle_hash, cell_id, behavior_id, provider, scenario,
        run_id, attempt_id, artifact_sha, resource_id, resource_ref,
        seam_id, adapter_id, grant_id)
     SELECT
       $1, cell_id, behavior_id, provider, scenario, run_id,
       attempt_id, artifact_sha, resource_id, resource_ref, seam_id,
       adapter_id, $2::uuid
     FROM kernel_equivalence_production_cases
     WHERE case_id = $3::uuid`,
    [bundleHash, grantId, caseId],
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
      task_bundle_sha256 TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      terminal_status TEXT NOT NULL
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
      grant_id UUID NOT NULL,
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
  await pool.query(
    `UPDATE kernel_equivalence_production_case_leases
        SET lease_expires_at = clock_timestamp() + interval '10 seconds'
      WHERE case_id = $1::uuid`,
    [EXPIRED_CASE],
  );
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
  await insertAuthority({
    attemptId: MISMATCH_ATTEMPT,
    caseId: MISMATCH_CASE,
    receiptId: MISMATCH_RECEIPT,
    sessionId: 'mismatch-session',
  });
  await insertClaim({
    caseId: ACTIVE_CASE,
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    leaseSql: "clock_timestamp() + interval '5 minutes'",
  });
  await insertClaim({
    caseId: EXPIRED_CASE,
    eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    leaseSql: "clock_timestamp() + interval '25 milliseconds'",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await pool.query(
    `INSERT INTO kernel_equivalence_production_execution_events
       (event_id, case_id, generation, controller_instance_id, state,
        late_effect_risk, occurred_at, controller_lease_expires_at)
     VALUES
       ('bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc', $1::uuid, 2,
        $2::uuid, 'reconciling', false,
        clock_timestamp(),
        clock_timestamp() + interval '25 milliseconds')`,
    [EXPIRED_CASE, CRASHED_RECOVERY_CONTROLLER],
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
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
  it('samples DB time after locking the production lease', async () => {
    const caseId = '01010101-0101-4101-8101-010101010101';
    await insertAuthority({
      attemptId: '02020202-0202-4202-8202-020202020202',
      caseId,
      receiptId: '03030303-0303-4303-8303-030303030303',
      sessionId: 'post-lock-db-time-session',
    });
    const locker = await pool.connect();
    const claimant = await pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(
        `SELECT case_id
           FROM kernel_equivalence_production_case_leases
          WHERE case_id = $1::uuid
          FOR UPDATE`,
        [caseId],
      );
      const claim = claimant.query(
        `INSERT INTO kernel_equivalence_production_execution_events
           (event_id, case_id, generation, controller_instance_id, state,
            late_effect_risk, occurred_at,
            controller_lease_expires_at)
         VALUES
           ('04040404-0404-4404-8404-040404040404', $1::uuid, 1,
            $2::uuid, 'claimed', false, clock_timestamp(),
            clock_timestamp() + interval '100 milliseconds')`,
        [caseId, OLD_CONTROLLER],
      ).then(
        (value) => ({ status: 'fulfilled', value }),
        (error) => ({ status: 'rejected', error }),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await locker.query('COMMIT');

      const outcome = await claim;
      expect(outcome.status).toBe('rejected');
      expect(outcome.error?.message).toMatch(
        /claim authority unavailable/i,
      );
    } finally {
      await locker.query('ROLLBACK').catch(() => {});
      locker.release();
      claimant.release();
    }
  });

  it('rejects expired active authority but permits terminal history', async () => {
    const claimCaseId = '05050505-0505-4505-8505-050505050505';
    await insertAuthority({
      attemptId: '06060606-0606-4606-8606-060606060606',
      caseId: claimCaseId,
      receiptId: '07070707-0707-4707-8707-070707070707',
      sessionId: 'expired-active-claim-session',
    });
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          late_effect_risk, occurred_at, controller_lease_expires_at)
       VALUES
         ('08080808-0808-4808-8808-080808080808', $1::uuid, 1,
          $2::uuid, 'claimed', false,
          clock_timestamp() - interval '2 minutes',
          clock_timestamp() - interval '1 minute')`,
      [claimCaseId, OLD_CONTROLLER],
    )).rejects.toThrow(/claim authority unavailable/i);

    const grantCaseId = '09090909-0909-4909-8909-090909090909';
    await insertAuthority({
      attemptId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',
      caseId: grantCaseId,
      receiptId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',
      sessionId: 'expired-active-grant-session',
    });
    await insertClaim({
      caseId: grantCaseId,
      eventId: '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c',
      leaseSql: "clock_timestamp() + interval '1 minute'",
    });
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, late_effect_risk, occurred_at,
          controller_lease_expires_at)
       VALUES
         ('0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', $1::uuid, 2,
          $2::uuid, 'grant_issued', $3,
          clock_timestamp() - interval '1 minute', false,
          clock_timestamp() - interval '2 minutes',
          clock_timestamp() + interval '1 minute')`,
      [
        grantCaseId,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_A}`,
      ],
    )).rejects.toThrow(/authority (?:expiry )?unavailable/i);
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, code, late_effect_risk)
       VALUES
         ('0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e', $1::uuid, 2,
          $2::uuid, 'blocked', NULL,
          clock_timestamp() - interval '1 minute',
          'expired_terminal_history', false)`,
      [grantCaseId, OLD_CONTROLLER],
    )).resolves.toMatchObject({ rowCount: 1 });

    const reconcileCaseId = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
    await insertAuthority({
      attemptId: '12121212-1212-4212-8212-121212121212',
      caseId: reconcileCaseId,
      receiptId: '13131313-1313-4313-8313-131313131313',
      sessionId: 'expired-active-reconcile-session',
    });
    await insertClaim({
      caseId: reconcileCaseId,
      eventId: '14141414-1414-4414-8414-141414141414',
      leaseSql: "clock_timestamp() + interval '25 milliseconds'",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          late_effect_risk, occurred_at, controller_lease_expires_at)
       VALUES
         ('15151515-1515-4515-8515-151515151515', $1::uuid, 2,
          $2::uuid, 'reconciling', false,
          clock_timestamp() - interval '2 minutes',
          clock_timestamp() - interval '1 minute')`,
      [reconcileCaseId, NEW_CONTROLLER],
    )).rejects.toThrow(/authority expiry unavailable/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          code, late_effect_risk)
       VALUES
         ('16161616-1616-4616-8616-161616161616', $1::uuid, 2,
          $2::uuid, 'settlement_unknown',
          'expired_reconcile_fixture', true)`,
      [reconcileCaseId, OLD_CONTROLLER],
    );
  });

  it('rejects a binding whose durable receipt contradicts Attempt authority', async () => {
    await insertAuthority({
      attemptId: RECEIPT_MISMATCH_ATTEMPT,
      bind: false,
      caseId: RECEIPT_MISMATCH_CASE,
      receiptId: RECEIPT_MISMATCH_RECEIPT,
      receiptJobId: 'forged-job',
      receiptStatus: 'failed',
      receiptWorkerId: 'forged-machine',
      sessionId: 'mismatch-session',
    });

    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_case_bindings
         (case_id, result_receipt_id, provider_session_id,
          actual_machine_id, execution_transport, remote_job_id,
          task_bundle_sha256, artifact_sha)
       VALUES
         ($1::uuid, $2::uuid, 'mismatch-session', 'xian-mac-m4',
          'fleet-worker', $3, $4, $5)`,
      [
        RECEIPT_MISMATCH_CASE,
        RECEIPT_MISMATCH_RECEIPT,
        `job-${RECEIPT_MISMATCH_ATTEMPT}`,
        TASK_BUNDLE_SHA,
        ARTIFACT_SHA,
      ],
    )).rejects.toThrow(/authority binding mismatch/i);
  });

  it('serializes first authority binding against an in-flight Attempt rewrite', async () => {
    await insertAuthority({
      attemptId: RACING_ATTEMPT,
      bind: false,
      caseId: RACING_CASE,
      receiptId: RACING_RECEIPT,
      sessionId: 'original-session',
    });
    const writer = await pool.connect();
    const binder = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `UPDATE harness_attempts
            SET provider_session_id = 'forged-session'
          WHERE id = $1::uuid`,
        [RACING_ATTEMPT],
      );
      const binding = binder.query(
        `INSERT INTO kernel_equivalence_production_case_bindings
           (case_id, result_receipt_id, provider_session_id,
            actual_machine_id, execution_transport, remote_job_id,
            task_bundle_sha256, artifact_sha)
         VALUES
           ($1::uuid, $2::uuid, 'original-session', 'xian-mac-m4',
            'fleet-worker', $3, $4, $5)`,
        [
          RACING_CASE,
          RACING_RECEIPT,
          `job-${RACING_ATTEMPT}`,
          TASK_BUNDLE_SHA,
          ARTIFACT_SHA,
        ],
      ).then(
        (value) => ({ status: 'fulfilled', value }),
        (error) => ({ status: 'rejected', error }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writer.query('COMMIT');

      const outcome = await binding;
      expect(outcome.status).toBe('rejected');
      expect(outcome.error?.message).toMatch(
        /authority binding mismatch/i,
      );
      const readback = await pool.query(
        `SELECT count(*)::integer AS count
           FROM kernel_equivalence_production_case_bindings
          WHERE case_id = $1::uuid`,
        [RACING_CASE],
      );
      expect(readback.rows[0].count).toBe(0);
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
      binder.release();
    }
  });

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

  it('rejects success when a claimed execution never issued a grant', async () => {
    await insertAuthority({
      attemptId: CLAIM_ONLY_ATTEMPT,
      caseId: CLAIM_ONLY_CASE,
      receiptId: CLAIM_ONLY_RECEIPT,
      sessionId: 'claim-only-session',
    });
    await insertClaim({
      caseId: CLAIM_ONLY_CASE,
      eventId: '30303030-3030-4030-8030-303030303030',
      leaseSql: "clock_timestamp() + interval '25 milliseconds'",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          late_effect_risk, controller_lease_expires_at)
       VALUES
         ('40404040-4040-4040-8040-404040404040', $1::uuid, 2,
          $2::uuid, 'reconciling', false,
          clock_timestamp() + interval '1 minute')`,
      [CLAIM_ONLY_CASE, NEW_CONTROLLER],
    );
    const bundleHash = 'e'.repeat(64);
    await insertBundle({
      bundleHash,
      caseId: CLAIM_ONLY_CASE,
      grantId: GRANT_B,
    });

    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          bundle_hash, late_effect_risk)
       VALUES
         ('50505050-5050-4050-8050-505050505050', $1::uuid, 3,
          $2::uuid, 'succeeded', $3, false)`,
      [CLAIM_ONLY_CASE, NEW_CONTROLLER, bundleHash],
    )).rejects.toThrow(/grant lineage/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          code, late_effect_risk)
       VALUES
         ('51515151-5151-4151-8151-515151515151', $1::uuid, 3,
          $2::uuid, 'settlement_unknown', 'claim_without_grant', true)`,
      [CLAIM_ONLY_CASE, NEW_CONTROLLER],
    );
  });

  it('rejects an executing event whose grant differs from grant_issued', async () => {
    await insertAuthority({
      attemptId: LINEAGE_ATTEMPT,
      caseId: LINEAGE_CASE,
      receiptId: LINEAGE_RECEIPT,
      sessionId: 'lineage-session',
    });
    await insertClaim({
      caseId: LINEAGE_CASE,
      eventId: '60606060-6060-4060-8060-606060606060',
      leaseSql: "clock_timestamp() + interval '5 minutes'",
    });
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, late_effect_risk,
          controller_lease_expires_at)
       VALUES
         ('70707070-7070-4070-8070-707070707070', $1::uuid, 2,
          $2::uuid, 'grant_issued', $3,
          clock_timestamp() + interval '4 minutes', false,
          clock_timestamp() + interval '4 minutes')`,
      [
        LINEAGE_CASE,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_A}`,
      ],
    );

    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, late_effect_risk,
          controller_lease_expires_at)
       VALUES
         ('80808080-8080-4080-8080-808080808080', $1::uuid, 3,
          $2::uuid, 'executing', $3,
          clock_timestamp() + interval '4 minutes', false,
          clock_timestamp() + interval '4 minutes')`,
      [
        LINEAGE_CASE,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_B}`,
      ],
    )).rejects.toThrow(/grant lineage/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, late_effect_risk,
          controller_lease_expires_at)
       VALUES
         ('81818181-8181-4181-8181-818181818181', $1::uuid, 3,
          $2::uuid, 'executing', $3,
          clock_timestamp() + interval '4 minutes', false,
          clock_timestamp() + interval '4 minutes')`,
      [
        LINEAGE_CASE,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_A}`,
      ],
    );
    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, code, late_effect_risk)
       VALUES
         ('82828282-8282-4282-8282-828282828282', $1::uuid, 4,
          $2::uuid, 'blocked', $3,
          clock_timestamp() + interval '4 minutes',
          'terminal_fixture', false)`,
      [
        LINEAGE_CASE,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_B}`,
      ],
    )).rejects.toThrow(/grant lineage/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, code, late_effect_risk)
       VALUES
         ('83838383-8383-4383-8383-838383838383', $1::uuid, 4,
          $2::uuid, 'blocked', $3,
          clock_timestamp() + interval '4 minutes',
          'terminal_fixture', false)`,
      [
        LINEAGE_CASE,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_A}`,
      ],
    );
  });

  it('rejects a grant whose expiry exceeds the production lease', async () => {
    const caseId = '84848484-8484-4484-8484-848484848484';
    await insertAuthority({
      attemptId: '85858585-8585-4585-8585-858585858585',
      caseId,
      receiptId: '86868686-8686-4686-8686-868686868686',
      sessionId: 'lease-cap-session',
    });
    await insertClaim({
      caseId,
      eventId: '87878787-8787-4787-8787-878787878787',
      leaseSql: "clock_timestamp() + interval '1 minute'",
    });

    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, late_effect_risk,
          controller_lease_expires_at)
       VALUES
         ('89898989-8989-4989-8989-898989898989', $1::uuid, 2,
          $2::uuid, 'grant_issued', $3,
          clock_timestamp() + interval '6 minutes', false,
          clock_timestamp() + interval '1 minute')`,
      [
        caseId,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_A}`,
      ],
    )).rejects.toThrow(/authority expiry unavailable/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          code, late_effect_risk)
       VALUES
         ('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', $1::uuid, 2,
          $2::uuid, 'blocked', 'lease_cap_fixture', false)`,
      [caseId, OLD_CONTROLLER],
    );
  });

  it('records the exact live grant when revocation cannot be confirmed', async () => {
    const caseId = '90909090-9090-4090-8090-909090909090';
    const grantRef = `kernel-equivalence-grant:${GRANT_A}`;
    await insertAuthority({
      attemptId: '91919191-9191-4191-8191-919191919191',
      caseId,
      receiptId: '92929292-9292-4292-8292-929292929292',
      sessionId: 'revoke-unknown-session',
    });
    await insertClaim({
      caseId,
      eventId: '93939393-9393-4393-8393-939393939393',
      leaseSql: "clock_timestamp() + interval '1 minute'",
    });

    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, code, late_effect_risk)
       VALUES
         ('94949494-9494-4494-8494-949494949494', $1::uuid, 2,
          $2::uuid, 'settlement_unknown', $3,
          clock_timestamp() + interval '1 minute',
          'grant_revoke_unconfirmed', true)`,
      [caseId, OLD_CONTROLLER, grantRef],
    )).resolves.toMatchObject({ rowCount: 1 });
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

  it('rejects a reconciliation lease beyond production authority', async () => {
    const caseId = 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4';
    await insertAuthority({
      attemptId: 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5',
      caseId,
      receiptId: 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',
      sessionId: 'reconcile-cap-session',
    });
    await insertClaim({
      caseId,
      eventId: 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7',
      leaseSql: "clock_timestamp() + interval '25 milliseconds'",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          late_effect_risk, controller_lease_expires_at)
       VALUES
         ('a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8', $1::uuid, 2,
          $2::uuid, 'reconciling', false,
          clock_timestamp() + interval '6 minutes')`,
      [caseId, NEW_CONTROLLER],
    )).rejects.toThrow(/authority expiry unavailable/i);
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          code, late_effect_risk)
       VALUES
         ('a9a9a9a9-a9a9-49a9-89a9-a9a9a9a9a9a9', $1::uuid, 2,
          $2::uuid, 'settlement_unknown',
          'reconcile_cap_fixture', true)`,
      [caseId, OLD_CONTROLLER],
    );
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

    const reconciliation = await coordinator.reconcileStartup();
    expect(reconciliation).toMatchObject({ settled: 0 });
    expect(reconciliation.inspected).toBeGreaterThanOrEqual(2);
    expect(reconciliation.retained_unknown).toBe(
      reconciliation.inspected,
    );
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
    const productionLease = await pool.query(
      `SELECT lease_expires_at
         FROM kernel_equivalence_production_case_leases
        WHERE case_id = $1::uuid`,
      [EXPIRED_CASE],
    );
    expect(
      result.rows[2].controller_lease_expires_at.getTime(),
    ).toBeLessThanOrEqual(
      productionLease.rows[0].lease_expires_at.getTime(),
    );
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

  it('does not reconcile a bundle from a different execution grant', async () => {
    await insertAuthority({
      attemptId: RECONCILE_ATTEMPT,
      caseId: RECONCILE_CASE,
      receiptId: RECONCILE_RECEIPT,
      sessionId: 'reconcile-lineage-session',
    });
    await insertClaim({
      caseId: RECONCILE_CASE,
      eventId: 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
      leaseSql: "clock_timestamp() + interval '25 milliseconds'",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, late_effect_risk, occurred_at,
          controller_lease_expires_at)
       VALUES
         ('a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2', $1::uuid, 2,
          $2::uuid, 'grant_issued', $3,
          clock_timestamp() + interval '4 minutes', false,
          clock_timestamp() - interval '2 minutes',
          clock_timestamp() - interval '1 minute')`,
      [
        RECONCILE_CASE,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_A}`,
      ],
    );
    await pool.query(
      `INSERT INTO kernel_equivalence_production_execution_events
         (event_id, case_id, generation, controller_instance_id, state,
          grant_ref, grant_expires_at, late_effect_risk, occurred_at,
          controller_lease_expires_at)
       VALUES
         ('a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3', $1::uuid, 3,
          $2::uuid, 'executing', $3,
          clock_timestamp() + interval '4 minutes', false,
          clock_timestamp() - interval '90 seconds',
          clock_timestamp() - interval '30 seconds')`,
      [
        RECONCILE_CASE,
        OLD_CONTROLLER,
        `kernel-equivalence-grant:${GRANT_A}`,
      ],
    );
    await insertBundle({
      bundleHash: 'f'.repeat(64),
      caseId: RECONCILE_CASE,
      grantId: GRANT_B,
    });
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

    await coordinator.reconcileStartup();

    const events = await pool.query(
      `SELECT state, grant_ref
         FROM kernel_equivalence_production_execution_events
        WHERE case_id = $1::uuid
        ORDER BY generation`,
      [RECONCILE_CASE],
    );
    expect(events.rows).toEqual([
      { state: 'claimed', grant_ref: null },
      {
        state: 'grant_issued',
        grant_ref: `kernel-equivalence-grant:${GRANT_A}`,
      },
      {
        state: 'executing',
        grant_ref: `kernel-equivalence-grant:${GRANT_A}`,
      },
      {
        state: 'reconciling',
        grant_ref: null,
      },
      {
        state: 'settlement_unknown',
        grant_ref: `kernel-equivalence-grant:${GRANT_A}`,
      },
    ]);
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
    const mismatchedBundleHash = 'b'.repeat(64);
    let executionMode = 'mismatched';
    const service = Object.freeze({
      schema_version:
        'kernel-equivalence-trusted-execution-service/v1',
      cell_count: 99,
      adapter_count: 10,
      plan_digest: 'd'.repeat(64),
      execute: async ({ grant_ref: grantRef }) => {
        const actualGrantId = grantRef.slice(
          'kernel-equivalence-grant:'.length,
        );
        const mismatchedGrantId = actualGrantId === GRANT_A
          ? GRANT_B
          : GRANT_A;
        const mismatched = executionMode === 'mismatched';
        const currentBundleHash = mismatched
          ? mismatchedBundleHash
          : bundleHash;
        await insertBundle({
          bundleHash: currentBundleHash,
          caseId: mismatched ? MISMATCH_CASE : EXECUTE_CASE,
          grantId: mismatched ? mismatchedGrantId : actualGrantId,
        });
        return Object.freeze({
          status: 'collected',
          bundle: Object.freeze({ bundle_hash: currentBundleHash }),
        });
      },
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

      const mismatched = await request(http)
        .post('/api/brain/kernel-equivalence/cases/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({ case_id: MISMATCH_CASE });
      expect(mismatched.status, JSON.stringify(mismatched.body)).toBe(503);
      expect(mismatched.body).toEqual({
        ok: false,
        error: 'production_controller_bundle_settlement_unconfirmed',
      });
      const mismatchedEvents = await pool.query(
        `SELECT state
           FROM kernel_equivalence_production_execution_events
          WHERE case_id = $1::uuid
          ORDER BY generation`,
        [MISMATCH_CASE],
      );
      expect(mismatchedEvents.rows.map(({ state }) => state)).toEqual([
        'claimed',
        'grant_issued',
        'executing',
        'settlement_unknown',
      ]);

      executionMode = 'matching';
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
      const response = responses.find(({ status }) => status === 200);
      const duplicate = responses.find(({ status }) => status === 409);

      expect(
        response,
        JSON.stringify(responses.map(({ status, body }) => ({
          status,
          body,
        }))),
      ).toBeDefined();
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
      expect(duplicate).toBeDefined();
      expect(duplicate.body.error).toBe(
        'production_controller_case_already_claimed',
      );
    } finally {
      await listener?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
