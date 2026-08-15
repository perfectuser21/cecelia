import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptCleanupOutboxStore } from '../../orchestrator/attempt-cleanup-outbox-store.js';
import { createAttemptCleanupWorker } from '../../orchestrator/attempt-cleanup-worker.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { LOG_ACTION } from '../../orchestrator/constants.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^cleanup_worker_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function seedIntent() {
  const taskId = randomUUID();
  const runId = randomUUID();
  const attemptId = randomUUID();
  await testPool.query(
    "INSERT INTO tasks(id,title,status) VALUES($1,$2,'in_progress')",
    [taskId, `cleanup worker ${taskId}`],
  );
  await seedOwnedActiveV2Run(testPool, { runId, taskId, phase: 'planning' });
  await createAttemptStore(testPool).createAttempt({
    id: attemptId,
    runId,
    hop: 1,
    phase: 'generate',
    role: 'generator',
    provider: 'codex',
    callbackSecretHash: 'a'.repeat(64),
    bundle: {},
  });
  const outbox = (await testPool.query(
    `INSERT INTO harness_attempt_cleanup_outbox(
       run_id,attempt_id,target_machine_id,execution_transport,remote_job_id,
       lease_owner,lease_generation,cleanup_cause,available_at
     ) VALUES(
       $1,$2,'us-mac-m4','fleet-worker','container-exact',
       'attempt-dispatcher',7,'pg_worker_test',NOW()-INTERVAL '1 second'
     ) RETURNING *`,
    [runId, attemptId],
  )).rows[0];
  return { taskId, runId, attemptId, outbox };
}

function worker(transport, overrides = {}) {
  return createAttemptCleanupWorker({
    pool: testPool,
    transport,
    claimOwner: overrides.claimOwner ?? `cleanup-${randomUUID()}`,
    leaseSeconds: 30,
    limit: 1,
    retryAfterSeconds: 60,
  });
}

async function expireClaim(id) {
  await testPool.query(
    'ALTER TABLE harness_attempt_cleanup_outbox DISABLE TRIGGER guard_harness_attempt_cleanup_outbox_mutation',
  );
  try {
    await testPool.query(
      "UPDATE harness_attempt_cleanup_outbox SET claim_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [id],
    );
  } finally {
    await testPool.query(
      'ALTER TABLE harness_attempt_cleanup_outbox ENABLE TRIGGER guard_harness_attempt_cleanup_outbox_mutation',
    );
  }
}

beforeAll(async () => {
  databaseName = `cleanup_worker_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 5 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('attempt cleanup worker on PostgreSQL', () => {
  it('atomically confirms canonical receipt and appends its run decision', async () => {
    const intent = await seedIntent();
    const cancel = vi.fn(async () => ({
      status: 'cleaned',
      attempt_id: intent.attemptId,
      extra: 'must-not-persist',
    }));

    await expect(worker({ cancel }).runOnce()).resolves.toMatchObject({ confirmed: 1 });

    const persisted = (await testPool.query(
      `SELECT status,receipt,claim_owner,claim_generation::text AS claim_generation
         FROM harness_attempt_cleanup_outbox WHERE id=$1`,
      [intent.outbox.id],
    )).rows[0];
    expect(persisted).toMatchObject({ status: 'confirmed' });
    expect(persisted.receipt).toEqual({
      contract_version: 'attempt-cleanup-confirmation/v1',
      status: 'cleaned',
      attempt_id: intent.attemptId,
      run_id: intent.runId,
      target_machine_id: 'us-mac-m4',
      execution_transport: 'fleet-worker',
      remote_job_id: 'container-exact',
      lease_owner: 'attempt-dispatcher',
      lease_generation: 7,
    });
    const decisions = await testPool.query(
      `SELECT action,observed,detail FROM orchestrator_decision_log
        WHERE run_id=$1 AND action=$2`,
      [intent.runId, LOG_ACTION.ATTEMPT_CLEANUP_CONFIRMED],
    );
    expect(decisions.rows).toHaveLength(1);
    expect(decisions.rows[0].observed).toEqual(persisted.receipt);
    expect(decisions.rows[0].detail.receipt).toEqual(persisted.receipt);
  });

  it('does not let an old claim response confirm after lease reclaim', async () => {
    const intent = await seedIntent();
    let reclaimed;
    const firstOwner = 'cleanup-old';
    const cancel = vi.fn(async () => {
      await expireClaim(intent.outbox.id);
      reclaimed = (await createAttemptCleanupOutboxStore(testPool).claimBatch({
        claimOwner: 'cleanup-new',
        leaseSeconds: 30,
        limit: 1,
      }))[0];
      return { status: 'cleaned', attempt_id: intent.attemptId };
    });

    await expect(worker({ cancel }, { claimOwner: firstOwner }).runOnce())
      .resolves.toMatchObject({ stale: 1, confirmed: 0 });

    const persisted = (await testPool.query(
      `SELECT status,claim_owner,claim_generation::text AS claim_generation,receipt
         FROM harness_attempt_cleanup_outbox WHERE id=$1`,
      [intent.outbox.id],
    )).rows[0];
    expect(persisted).toMatchObject({
      status: 'leased',
      claim_owner: 'cleanup-new',
      claim_generation: reclaimed.claim_generation,
      receipt: null,
    });
    expect((await testPool.query(
      'SELECT COUNT(*)::int AS count FROM orchestrator_decision_log WHERE run_id=$1 AND action=$2',
      [intent.runId, LOG_ACTION.ATTEMPT_CLEANUP_CONFIRMED],
    )).rows[0].count).toBe(0);
  });

  it('rolls confirmation back when its decision append fails', async () => {
    const intent = await seedIntent();
    await testPool.query(`
      CREATE OR REPLACE FUNCTION reject_cleanup_confirmation_decision()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action='effect:attempt_cleanup_confirmed' THEN
          RAISE EXCEPTION 'reject_cleanup_confirmation_decision';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_cleanup_confirmation_decision
      BEFORE INSERT ON orchestrator_decision_log
      FOR EACH ROW EXECUTE FUNCTION reject_cleanup_confirmation_decision();
    `);
    try {
      await expect(worker({
        cancel: vi.fn(async () => ({ status: 'cleaned', attempt_id: intent.attemptId })),
      }).runOnce()).rejects.toThrow(/reject_cleanup_confirmation_decision/);
      expect((await testPool.query(
        'SELECT status,receipt FROM harness_attempt_cleanup_outbox WHERE id=$1',
        [intent.outbox.id],
      )).rows[0]).toEqual({ status: 'leased', receipt: null });
    } finally {
      await testPool.query(
        'DROP TRIGGER IF EXISTS reject_cleanup_confirmation_decision ON orchestrator_decision_log',
      );
      await testPool.query('DROP FUNCTION IF EXISTS reject_cleanup_confirmation_decision()');
    }
  });

  it('persists a recoverable 5xx as a deferred retry', async () => {
    const intent = await seedIntent();

    await expect(worker({
      cancel: vi.fn(async () => { throw new Error('remote_bridge_cancel_http_503'); }),
    }).runOnce()).resolves.toMatchObject({ retried: 1 });

    expect((await testPool.query(
      `SELECT status,claim_owner,receipt,available_at>NOW() AS deferred
         FROM harness_attempt_cleanup_outbox WHERE id=$1`,
      [intent.outbox.id],
    )).rows[0]).toMatchObject({
      status: 'pending',
      claim_owner: null,
      receipt: null,
      deferred: true,
    });
  });

  it('persists quarantined evidence as blocked', async () => {
    const intent = await seedIntent();

    await expect(worker({
      cancel: vi.fn(async () => ({ status: 'quarantined', attempt_id: intent.attemptId })),
    }).runOnce()).resolves.toMatchObject({ blocked: 1 });

    expect((await testPool.query(
      'SELECT status,claim_owner,receipt,last_error_code FROM harness_attempt_cleanup_outbox WHERE id=$1',
      [intent.outbox.id],
    )).rows[0]).toMatchObject({
      status: 'blocked',
      claim_owner: null,
      receipt: null,
      last_error_code: 'cleanup_cancel_quarantined',
    });
  });
});
