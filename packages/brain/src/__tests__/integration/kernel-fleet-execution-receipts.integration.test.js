import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';

const migration357 = readFileSync(
  new URL('../../../migrations/357_harness_provider_attempts.sql', import.meta.url),
  'utf8',
);
const migration362 = readFileSync(
  new URL('../../../migrations/362_kernel_attempt_telemetry_reconcile.sql', import.meta.url),
  'utf8',
);
const migration363 = readFileSync(
  new URL('../../../migrations/363_kernel_fleet_execution_receipts.sql', import.meta.url),
  'utf8',
);

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl
  ? decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1))
  : DB_DEFAULTS.database;

if (!/_test$|_scratch$/.test(databaseName || '')) {
  throw new Error(
    `kernel fleet receipt integration test requires a test database, got ${databaseName}`,
  );
}

const pool = new pg.Pool(testDatabaseUrl
  ? { connectionString: testDatabaseUrl, max: 1 }
  : { ...DB_DEFAULTS, max: 1 });

const schemaName = `kernel_fleet_receipts_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const legacyBackfillId = randomUUID();
const preservedTargetId = randomUUID();
const legacyRunId = randomUUID();
let client;
let store;

function attemptInput({ runId, hop, machineId }) {
  return {
    id: randomUUID(),
    runId,
    hop,
    phase: 'generate',
    role: 'generator',
    provider: 'codex',
    machineId,
    callbackSecretHash: 'a'.repeat(64),
    bundle: { inputs: { task: 'fleet receipt integration' } },
  };
}

async function loadReceipt(attemptId) {
  const result = await client.query(
    `SELECT status, lease_owner, requested_machine_id, actual_machine_id,
            execution_transport, remote_job_id, machine_attestation_status,
            lease_generation
       FROM harness_attempts
      WHERE id = $1`,
    [attemptId],
  );
  return result.rows[0];
}

async function expectCheckViolation(sql, values) {
  await client.query('SAVEPOINT fleet_receipt_check_violation');
  try {
    await expect(client.query(sql, values)).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT fleet_receipt_check_violation');
    await client.query('RELEASE SAVEPOINT fleet_receipt_check_violation');
  }
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET LOCAL search_path TO ${quotedSchema}, public`);
  await client.query(`
    CREATE TABLE schema_version (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
  `);
  await client.query(migration357);
  await client.query(migration362);

  // Reproduce a partially deployed legacy schema where requested_machine_id
  // already exists but the rest of migration 363 does not.
  await client.query('ALTER TABLE harness_attempts ADD COLUMN requested_machine_id TEXT');
  await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [legacyRunId]);
  await client.query(
    `INSERT INTO harness_attempts (
       id, run_id, hop, phase, role, provider, machine_id, requested_machine_id,
       task_bundle, callback_secret_hash
     ) VALUES
       ($1, $3, 1, 'generate', 'generator', 'codex', 'legacy-worker', NULL, '{}', 'hash-1'),
       ($2, $3, 2, 'generate', 'generator', 'codex', 'legacy-worker', 'chosen-worker', '{}', 'hash-2')`,
    [legacyBackfillId, preservedTargetId, legacyRunId],
  );

  await client.query(migration363);
  await client.query(migration363);
  store = createAttemptStore(client);
}, 15_000);

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  await pool.end();
});

describe('migration 363 and fleet execution receipts on PostgreSQL', () => {
  it('reruns safely, backfills legacy targets, and preserves explicit targets', async () => {
    const rows = await client.query(
      `SELECT id, requested_machine_id
         FROM harness_attempts
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[legacyBackfillId, preservedTargetId]],
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.requested_machine_id]));

    expect(byId[legacyBackfillId]).toBe('legacy-worker');
    expect(byId[preservedTargetId]).toBe('chosen-worker');
    expect((await client.query(
      `SELECT COUNT(*)::int AS count FROM schema_version WHERE version = '363'`,
    )).rows[0].count).toBe(1);
  });

  it('accepts every fleet receipt enum value and rejects values outside the contract', async () => {
    for (const transport of ['local-docker', 'remote-bridge']) {
      await client.query(
        'UPDATE harness_attempts SET execution_transport = $2 WHERE id = $1',
        [legacyBackfillId, transport],
      );
    }
    for (const attestation of ['local', 'verified', 'rejected', 'pending']) {
      await client.query(
        'UPDATE harness_attempts SET machine_attestation_status = $2 WHERE id = $1',
        [legacyBackfillId, attestation],
      );
    }

    await expectCheckViolation(
      'UPDATE harness_attempts SET execution_transport = $2 WHERE id = $1',
      [legacyBackfillId, 'ssh'],
    );
    await expectCheckViolation(
      'UPDATE harness_attempts SET machine_attestation_status = $2 WHERE id = $1',
      [legacyBackfillId, 'unknown'],
    );
  });

  it('createAttempt persists the requested machine in both machine columns', async () => {
    const runId = randomUUID();
    await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [runId]);
    const input = attemptInput({ runId, hop: 1, machineId: 'verified-worker' });

    await store.createAttempt(input);

    const row = await client.query(
      'SELECT machine_id, requested_machine_id, lease_generation FROM harness_attempts WHERE id = $1',
      [input.id],
    );
    expect(row.rows[0]).toEqual({
      machine_id: 'verified-worker',
      requested_machine_id: 'verified-worker',
      lease_generation: 0,
    });
  });

  it('fences launch receipts by lease owner and active status without mutating rejected writes', async () => {
    const runId = randomUUID();
    await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [runId]);
    const input = attemptInput({ runId, hop: 1, machineId: 'requested-worker' });
    await store.createAttempt(input);
    await client.query(
      'UPDATE harness_attempts SET lease_owner = $2 WHERE id = $1',
      [input.id, 'brain-1'],
    );

    const queuedReceipt = {
      leaseOwner: 'brain-1',
      actualMachineId: 'queued-worker',
      executionTransport: 'local-docker',
      remoteJobId: 'queued-job',
      attestationStatus: 'local',
    };
    expect(await store.recordLaunchReceipt(input.id, queuedReceipt)).toBeNull();
    expect(await loadReceipt(input.id)).toMatchObject({
      actual_machine_id: null,
      execution_transport: null,
      remote_job_id: null,
      machine_attestation_status: null,
    });

    await store.markStarting(input.id, { leaseOwner: 'brain-1', leaseSeconds: 90 });
    expect(await store.recordLaunchReceipt(input.id, {
      ...queuedReceipt,
      leaseOwner: 'brain-2',
    })).toBeNull();
    expect(await loadReceipt(input.id)).toMatchObject({
      actual_machine_id: null,
      execution_transport: null,
      remote_job_id: null,
      machine_attestation_status: null,
    });

    const startingReceipt = await store.recordLaunchReceipt(input.id, {
      ...queuedReceipt,
      actualMachineId: 'starting-worker',
      remoteJobId: null,
    });
    expect(startingReceipt).toMatchObject({
      actual_machine_id: 'starting-worker',
      execution_transport: 'local-docker',
      remote_job_id: null,
      machine_attestation_status: 'local',
    });

    await store.markRunning(input.id, {
      leaseOwner: 'brain-1',
      providerSessionId: 'provider-session',
      leaseSeconds: 90,
    });
    const runningReceipt = await store.recordLaunchReceipt(input.id, {
      leaseOwner: 'brain-1',
      actualMachineId: 'running-worker',
      executionTransport: 'remote-bridge',
      remoteJobId: 'remote-job',
      attestationStatus: 'verified',
    });
    expect(runningReceipt).toMatchObject({
      actual_machine_id: 'running-worker',
      execution_transport: 'remote-bridge',
      remote_job_id: 'remote-job',
      machine_attestation_status: 'verified',
    });

    await client.query(
      `UPDATE harness_attempts SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [input.id],
    );
    expect(await store.recordLaunchReceipt(input.id, {
      ...queuedReceipt,
      leaseOwner: 'brain-1',
    })).toBeNull();
    expect(await loadReceipt(input.id)).toMatchObject({
      status: 'completed',
      actual_machine_id: 'running-worker',
      execution_transport: 'remote-bridge',
      remote_job_id: 'remote-job',
      machine_attestation_status: 'verified',
    });
  });

  it('increments lease_generation atomically when reclaiming an expired attempt', async () => {
    const runId = randomUUID();
    await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [runId]);
    const input = attemptInput({ runId, hop: 1, machineId: 'reclaim-worker' });
    await store.createAttempt(input);
    await store.markStarting(input.id, { leaseOwner: 'brain-1', leaseSeconds: 90 });
    await client.query(
      `UPDATE harness_attempts SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [input.id],
    );

    expect((await loadReceipt(input.id)).lease_generation).toBe(0);
    const reclaimed = await store.reclaim(input.id, {
      leaseOwner: 'watchdog-1',
      leaseSeconds: 180,
    });

    expect(reclaimed).toMatchObject({
      status: 'starting',
      lease_owner: 'watchdog-1',
      lease_generation: 1,
    });
    expect((await loadReceipt(input.id)).lease_generation).toBe(1);
  });
});
