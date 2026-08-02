import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { createDispatcher } from '../../orchestrator/dispatcher.js';

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
const migration364 = readFileSync(
  new URL('../../../migrations/364_kernel_local_container_naming.sql', import.meta.url),
  'utf8',
);
const migration366 = readFileSync(
  new URL('../../../migrations/366_kernel_harness_failure_class.sql', import.meta.url),
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
  ? { connectionString: testDatabaseUrl, max: 4 }
  : { ...DB_DEFAULTS, max: 4 });

const schemaName = `kernel_fleet_receipts_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const legacyBackfillId = randomUUID();
const preservedTargetId = randomUUID();
const oldBinaryInsertId = randomUUID();
const legacyRunId = randomUUID();
const oldBinaryRunId = randomUUID();
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
  await client.query('BEGIN');
  try {
    await expect(client.query(sql, values)).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
  }
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query(`CREATE SCHEMA ${quotedSchema}`);
  await client.query(`SET search_path TO ${quotedSchema}, public`);
  await client.query(`
    CREATE TABLE schema_version (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE initiative_runs (
      id UUID PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'planning',
      orchestrator_version TEXT NOT NULL DEFAULT 'v1'
        CHECK (orchestrator_version IN ('v1','v2'))
    );
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
  await client.query(migration364);
  await client.query(migration364);
  await client.query(migration366);
  await client.query(migration366);
  await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [oldBinaryRunId]);
  await client.query(
    `INSERT INTO harness_attempts (
       id, run_id, hop, phase, role, provider, machine_id,
       task_bundle, callback_secret_hash
     ) VALUES ($1,$2,1,'generate','generator','codex','us-mac-m4','{}','old-binary-hash')`,
    [oldBinaryInsertId, oldBinaryRunId],
  );
  store = createAttemptStore(client);
}, 15_000);

afterAll(async () => {
  if (client) {
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => {});
    client.release();
  }
  await pool.end();
});

describe('migrations 363-366 and fleet execution receipts on PostgreSQL', () => {
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
    expect((await client.query(
      `SELECT COUNT(*)::int AS count FROM schema_version WHERE version = '364'`,
    )).rows[0].count).toBe(1);
    expect((await client.query(
      `SELECT COUNT(*)::int AS count FROM schema_version WHERE version = '366'`,
    )).rows[0].count).toBe(1);
    expect((await client.query(
      `SELECT id,orchestrator_version
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[legacyRunId, oldBinaryRunId]],
    )).rows).toEqual(expect.arrayContaining([
      { id: legacyRunId, orchestrator_version: 'v1' },
      { id: oldBinaryRunId, orchestrator_version: 'v1' },
    ]));
  });

  it('backfills existing rows and old-binary omitted inserts as durable legacy naming', async () => {
    const rows = await client.query(
      `SELECT id, local_container_naming
         FROM harness_attempts
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[legacyBackfillId, preservedTargetId, oldBinaryInsertId]],
    );

    expect(rows.rows).toHaveLength(3);
    expect(rows.rows).toEqual(expect.arrayContaining([
      { id: legacyBackfillId, local_container_naming: 'legacy-unsuffixed' },
      { id: preservedTargetId, local_container_naming: 'legacy-unsuffixed' },
      { id: oldBinaryInsertId, local_container_naming: 'legacy-unsuffixed' },
    ]));
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

  it('persists bounded canonical failure classes for semantic and runner terminal states', async () => {
    const runId = randomUUID();
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version) VALUES ($1,'v2')`,
      [runId],
    );
    const semanticAttempt = attemptInput({ runId, hop: 31, machineId: 'us-mac-m4' });
    const runnerAttempt = attemptInput({ runId, hop: 32, machineId: 'us-mac-m4' });
    await store.createAttempt(semanticAttempt);
    await store.createAttempt(runnerAttempt);

    await store.complete(semanticAttempt.id, {
      status: 'blocked',
      summary: 'structured context required',
      failure_class: 'semantic_refusal',
    });
    await store.fail(runnerAttempt.id, {
      status: 'failed',
      code: 'runner_exit',
      message: 'bounded diagnostic',
      failureClass: 'runner_failure',
    });

    const rows = await client.query(
      `SELECT id, failure_class
         FROM harness_attempts
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[semanticAttempt.id, runnerAttempt.id]],
    );
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.failure_class]))).toEqual({
      [semanticAttempt.id]: 'semantic_refusal',
      [runnerAttempt.id]: 'runner_failure',
    });
    await expectCheckViolation(
      'UPDATE harness_attempts SET failure_class = $2 WHERE id = $1',
      [semanticAttempt.id, 'natural_language_guess'],
    );
  });

  it('createAttempt persists the requested machine in both machine columns', async () => {
    const runId = randomUUID();
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version) VALUES ($1,'v2')`,
      [runId],
    );
    const input = attemptInput({ runId, hop: 1, machineId: 'verified-worker' });

    await store.createAttempt(input);

    const row = await client.query(
      `SELECT machine_id, requested_machine_id, lease_generation, local_container_naming
         FROM harness_attempts WHERE id = $1`,
      [input.id],
    );
    expect(row.rows[0]).toEqual({
      machine_id: 'verified-worker',
      requested_machine_id: 'verified-worker',
      lease_generation: 0,
      local_container_naming: 'generation-v1',
    });
  });

  it('returns the committed winner after a concurrent ON CONFLICT snapshot sees zero rows', async () => {
    const runId = randomUUID();
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version) VALUES ($1,'v2')`,
      [runId],
    );
    const winnerInput = attemptInput({ runId, hop: 41, machineId: 'us-mac-m4' });
    const duplicateInput = {
      ...attemptInput({ runId, hop: 41, machineId: 'xian-mac-m4' }),
      id: randomUUID(),
    };
    const winnerClient = await pool.connect();
    const duplicateClient = await pool.connect();
    let winnerCommitted = false;
    try {
      await winnerClient.query(`SET search_path TO ${quotedSchema}, public`);
      await duplicateClient.query(`SET search_path TO ${quotedSchema}, public`);
      const duplicatePid = (await duplicateClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await winnerClient.query('BEGIN');
      await duplicateClient.query('BEGIN');

      const winner = await createAttemptStore(winnerClient).createAttempt(winnerInput);
      expect(winner.id).toBe(winnerInput.id);

      const duplicatePromise = createAttemptStore(duplicateClient).createAttempt(duplicateInput);
      let observedConflictWait = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query(
          `SELECT wait_event_type, wait_event
             FROM pg_stat_activity
            WHERE pid = $1`,
          [duplicatePid],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock'
            && activity.rows[0]?.wait_event === 'transactionid') {
          observedConflictWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(observedConflictWait).toBe(true);

      await winnerClient.query('COMMIT');
      winnerCommitted = true;
      await expect(duplicatePromise).resolves.toMatchObject({
        id: winnerInput.id,
        run_id: runId,
        hop: 41,
      });
      await duplicateClient.query('COMMIT');

      const rows = await client.query(
        'SELECT id, requested_machine_id FROM harness_attempts WHERE run_id=$1 AND hop=$2',
        [runId, 41],
      );
      expect(rows.rows).toEqual([{
        id: winnerInput.id,
        requested_machine_id: 'us-mac-m4',
      }]);

      const launch = vi.fn();
      const start = vi.fn();
      const duplicateDispatch = createDispatcher({
        attemptStore: createAttemptStore(client),
        registry: {
          resolve: vi.fn(() => ({
            name: 'codex',
            capabilities: ['structured_output'],
            start,
          })),
        },
        launcher: { launch, cancel: vi.fn() },
        handlers: {},
        loadSkill: vi.fn(() => ({
          name: 'harness-generator',
          version: '1.0.0',
          digest: `sha256:${'d'.repeat(64)}`,
          content: 'generate',
        })),
        machineId: 'us-mac-m4',
        randomUUID: () => duplicateInput.id,
        createCallbackSecret: () => 'duplicate-callback-secret',
      });
      await expect(duplicateDispatch('spawn:generator', {
        taskId: 'task-concurrent-duplicate',
        runId,
        hop: 41,
        decision: { phase: 'generate' },
        observed: {
          task: {
            id: 'task-concurrent-duplicate',
            title: 'duplicate dispatch suppression',
            payload: {
              sprint_dir: 'sprints/concurrent-dispatch',
              worktree_path: '/workspace',
            },
          },
          run: { id: runId, phase: 'generate' },
          contract: { row: {} },
          pr: null,
        },
      })).resolves.toMatchObject({
        status: 'DONE_WITH_CONCERNS',
        attemptId: winnerInput.id,
      });
      expect(start).not.toHaveBeenCalled();
      expect(launch).not.toHaveBeenCalled();
    } finally {
      if (!winnerCommitted) await winnerClient.query('ROLLBACK').catch(() => {});
      await duplicateClient.query('ROLLBACK').catch(() => {});
      winnerClient.release();
      duplicateClient.release();
    }
  });

  it('fences launch receipts by lease owner and active status without mutating rejected writes', async () => {
    const runId = randomUUID();
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version) VALUES ($1,'v2')`,
      [runId],
    );
    const input = attemptInput({ runId, hop: 1, machineId: 'requested-worker' });
    await store.createAttempt(input);
    await client.query(
      'UPDATE harness_attempts SET lease_owner = $2 WHERE id = $1',
      [input.id, 'brain-1'],
    );

    const queuedReceipt = {
      leaseOwner: 'brain-1',
      leaseGeneration: 0,
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
      leaseGeneration: 0,
      providerSessionId: 'provider-session',
      leaseSeconds: 90,
    });
    const runningReceipt = await store.recordLaunchReceipt(input.id, {
      leaseOwner: 'brain-1',
      leaseGeneration: 0,
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
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version) VALUES ($1,'v2')`,
      [runId],
    );
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

  it('rejects stale receipt and failure writes from an older generation with the same owner', async () => {
    const runId = randomUUID();
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version) VALUES ($1,'v2')`,
      [runId],
    );
    const input = attemptInput({ runId, hop: 1, machineId: 'reclaim-worker' });
    await store.createAttempt(input);
    await store.markStarting(input.id, { leaseOwner: 'same-owner', leaseSeconds: 90 });
    await client.query(
      `UPDATE harness_attempts SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [input.id],
    );
    await store.reclaim(input.id, {
      leaseOwner: 'same-owner',
      leaseSeconds: 180,
    });

    expect(await store.recordLaunchReceipt(input.id, {
      leaseOwner: 'same-owner',
      leaseGeneration: 0,
      actualMachineId: 'stale-worker',
      executionTransport: 'remote-bridge',
      remoteJobId: 'stale-job',
      attestationStatus: 'verified',
    })).toBeNull();
    expect(await store.fail(input.id, {
      code: 'stale_failure',
      message: 'old generation must not terminate the attempt',
    }, {
      leaseOwner: 'same-owner',
      leaseGeneration: 0,
    })).toEqual({ attempt: null, deduped: true });
    expect(await loadReceipt(input.id)).toMatchObject({
      status: 'starting',
      lease_owner: 'same-owner',
      lease_generation: 1,
      actual_machine_id: null,
      execution_transport: null,
      remote_job_id: null,
    });

    expect(await store.recordLaunchReceipt(input.id, {
      leaseOwner: 'same-owner',
      leaseGeneration: 1,
      actualMachineId: 'current-worker',
      executionTransport: 'remote-bridge',
      remoteJobId: 'current-job',
      attestationStatus: 'verified',
    })).toMatchObject({
      actual_machine_id: 'current-worker',
      remote_job_id: 'current-job',
      lease_generation: 1,
    });
    expect(await store.fail(input.id, {
      code: 'current_failure',
      message: 'current generation may terminate the attempt',
    }, {
      leaseOwner: 'same-owner',
      leaseGeneration: 1,
    })).toMatchObject({
      deduped: false,
      attempt: {
        status: 'failed',
        error_code: 'current_failure',
        lease_generation: 1,
      },
    });
  });
});
