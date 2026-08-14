import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  AUTONOMOUS_SINGLETON_CAPACITY_CONTENDED,
} from '../../orchestrator/attempt-machine-capacity.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';

const migrations = [357, 362, 363, 364].map((version) => readFileSync(
  new URL(`../../../migrations/${{
    357: '357_harness_provider_attempts.sql',
    362: '362_kernel_attempt_telemetry_reconcile.sql',
    363: '363_kernel_fleet_execution_receipts.sql',
    364: '364_kernel_local_container_naming.sql',
  }[version]}`, import.meta.url),
  'utf8',
));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl
  ? decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1))
  : DB_DEFAULTS.database;

if (!/_test$|_scratch$/.test(databaseName || '')) {
  throw new Error(
    `attempt machine capacity integration test requires a test database, got ${databaseName}`,
  );
}

const pool = new pg.Pool(testDatabaseUrl
  ? { connectionString: testDatabaseUrl, max: 4 }
  : { ...DB_DEFAULTS, max: 4 });
const schemaName = `attempt_machine_capacity_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
let client;

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
    bundle: { inputs: { task: 'machine capacity integration' } },
  };
}

function autonomousSingletonSnapshot(machineId) {
  return {
    verified: true,
    machine: machineId,
    capability_snapshot_id: randomUUID(),
    capacity: {
      ok: true,
      available: 1,
      physical_capacity: 1,
      autonomous_progress_floor: true,
    },
  };
}

async function connectTransactionClient() {
  const transactionClient = await pool.connect();
  await transactionClient.query(`SET search_path TO ${quotedSchema}, public`);
  await transactionClient.query('BEGIN');
  return transactionClient;
}

async function createAttempt(input) {
  const transactionClient = await connectTransactionClient();
  try {
    const attempt = await createAttemptStore(transactionClient, { transactionClient: true })
      .createAttempt(input);
    await transactionClient.query('COMMIT');
    return attempt;
  } catch (error) {
    await transactionClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    transactionClient.release();
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
      map_recovery_contract_id UUID,
      orchestrator_version TEXT NOT NULL DEFAULT 'v1'
        CHECK (orchestrator_version IN ('v1','v2'))
    );
  `);
  for (const migration of migrations) await client.query(migration);
}, 15_000);

afterAll(async () => {
  if (client) {
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => {});
    client.release();
  }
  await pool.end();
});

describe('attempt machine singleton capacity on PostgreSQL', () => {
  it.each([
    ['singleton then normal', true],
    ['normal then singleton', false],
  ])('atomically fences same-machine %s creation across different runs', async (
    _direction,
    firstIsSingleton,
  ) => {
    const machineId = `singleton-race-${randomUUID()}`;
    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version)
       VALUES ($1,'v2'),($2,'v2')`,
      [firstRunId, secondRunId],
    );
    const firstInput = {
      ...attemptInput({ runId: firstRunId, hop: 51, machineId }),
      ...(firstIsSingleton
        ? { capacitySnapshot: autonomousSingletonSnapshot(machineId) }
        : {}),
    };
    const secondInput = {
      ...attemptInput({ runId: secondRunId, hop: 52, machineId }),
      ...(!firstIsSingleton
        ? { capacitySnapshot: autonomousSingletonSnapshot(machineId) }
        : {}),
    };
    const firstClient = await connectTransactionClient();
    const secondClient = await connectTransactionClient();
    let firstCommitted = false;
    let secondSettled = false;
    try {
      const secondPid = (await secondClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await createAttemptStore(firstClient, { transactionClient: true }).createAttempt(firstInput);
      const secondOutcomePromise = createAttemptStore(secondClient, { transactionClient: true })
        .createAttempt(secondInput)
        .then(
          (value) => ({ status: 'fulfilled', value }),
          (error) => ({ status: 'rejected', error }),
        );

      let observedMachineLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await client.query(
          `SELECT wait_event_type, wait_event
             FROM pg_stat_activity
            WHERE pid = $1`,
          [secondPid],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock'
            && activity.rows[0]?.wait_event === 'advisory') {
          observedMachineLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      await firstClient.query('COMMIT');
      firstCommitted = true;
      const secondOutcome = await secondOutcomePromise;
      secondSettled = true;
      await secondClient.query(secondOutcome.status === 'fulfilled' ? 'COMMIT' : 'ROLLBACK');

      expect(observedMachineLock).toBe(true);
      expect(secondOutcome.status).toBe('rejected');
      expect(secondOutcome.error?.message).toBe(AUTONOMOUS_SINGLETON_CAPACITY_CONTENDED);
      const rows = await client.query(
        `SELECT id FROM harness_attempts
          WHERE run_id = ANY($1::uuid[])
          ORDER BY id`,
        [[firstRunId, secondRunId]],
      );
      expect(rows.rows).toEqual([{ id: firstInput.id }]);
    } finally {
      if (!firstCommitted) await firstClient.query('ROLLBACK').catch(() => {});
      if (!secondSettled) await secondClient.query('ROLLBACK').catch(() => {});
      firstClient.release();
      secondClient.release();
    }
  }, 15_000);

  it('preserves same run/hop winner and releases singleton capacity after terminal', async () => {
    const machineId = `singleton-release-${randomUUID()}`;
    const firstRunId = randomUUID();
    const nextRunId = randomUUID();
    await client.query(
      `INSERT INTO initiative_runs (id,orchestrator_version)
       VALUES ($1,'v2'),($2,'v2')`,
      [firstRunId, nextRunId],
    );
    const firstInput = {
      ...attemptInput({ runId: firstRunId, hop: 61, machineId }),
      capacitySnapshot: autonomousSingletonSnapshot(machineId),
    };
    const winner = await createAttempt(firstInput);

    await expect(createAttempt({ ...firstInput, id: randomUUID() }))
      .resolves.toMatchObject({ id: winner.id, run_id: firstRunId, hop: 61 });
    await client.query(
      `UPDATE harness_attempts SET status='completed' WHERE id=$1`,
      [winner.id],
    );

    await expect(createAttempt({
      ...attemptInput({ runId: nextRunId, hop: 62, machineId }),
      capacitySnapshot: autonomousSingletonSnapshot(machineId),
    })).resolves.toMatchObject({ run_id: nextRunId, status: 'queued' });
  });
});
