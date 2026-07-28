import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';

const migrationNames = [
  '357_harness_provider_attempts.sql',
  '363_kernel_fleet_execution_receipts.sql',
  '369_allow_fleet_worker_execution_transport.sql',
  '371_kernel_heartbeat_receipts.sql',
];
const migrations = migrationNames.map((name) => readFileSync(
  new URL(`../../../migrations/${name}`, import.meta.url),
  'utf8',
));

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(
    `Kernel heartbeat receipt integration requires a test database, got ${DB_DEFAULTS.database}`,
  );
}

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
const schemaName = `kernel_heartbeat_receipts_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const runId = randomUUID();
const attemptId = randomUUID();
const nonce = randomUUID();
let client;

async function expectTransactionFailure(operation, code) {
  await client.query('BEGIN');
  try {
    await expect(operation()).rejects.toMatchObject({ code });
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
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE initiative_runs (id UUID PRIMARY KEY);
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

describe('migration 371 on PostgreSQL', () => {
  it('persists one immutable nonce receipt without deleting expired audit evidence', async () => {
    await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [runId]);
    await client.query(
      `INSERT INTO harness_attempts (
         id, run_id, hop, phase, role, provider, task_bundle,
         callback_secret_hash, status, execution_transport
       ) VALUES (
         $1,$2,1,'planning','planner','claude','{}','hash','running','fleet-worker'
       )`,
      [attemptId, runId],
    );
    await client.query(
      `INSERT INTO harness_heartbeat_receipts (
         attempt_id, run_id, worker_id, job_id, lease_owner, lease_generation,
         heartbeat_nonce, request_sha256, observed_at, lease_seconds,
         provider_session_id, heartbeat_at, lease_expires_at
       ) VALUES (
         $1,$2,'xian-mac-m4','job-7','brain-1:123',2,$3,$4,
         NOW() - INTERVAL '1 day',180,'session-1',
         NOW() - INTERVAL '1 day',NOW() - INTERVAL '23 hours'
       )`,
      [attemptId, runId, nonce, 'a'.repeat(64)],
    );

    const retained = await client.query(
      `SELECT attempt_id, lease_generation, heartbeat_nonce, request_sha256
         FROM harness_heartbeat_receipts
        WHERE attempt_id=$1`,
      [attemptId],
    );
    expect(retained.rows).toEqual([{
      attempt_id: attemptId,
      lease_generation: 2,
      heartbeat_nonce: nonce,
      request_sha256: 'a'.repeat(64),
    }]);
  });

  it('is rerunnable and rejects mutation, deletion, nonce reuse, and parent deletion', async () => {
    await client.query(migrations.at(-1));

    await expectTransactionFailure(
      () => client.query(
        `UPDATE harness_heartbeat_receipts
            SET request_sha256=$2
          WHERE attempt_id=$1`,
        [attemptId, 'b'.repeat(64)],
      ),
      'P0001',
    );
    await expectTransactionFailure(
      () => client.query(
        'DELETE FROM harness_heartbeat_receipts WHERE attempt_id=$1',
        [attemptId],
      ),
      'P0001',
    );
    await expectTransactionFailure(
      () => client.query(
        `INSERT INTO harness_heartbeat_receipts (
           attempt_id, run_id, worker_id, job_id, lease_owner, lease_generation,
           heartbeat_nonce, request_sha256, observed_at, lease_seconds,
           heartbeat_at, lease_expires_at
         ) VALUES (
           $1,$2,'xian-mac-m4','job-8','brain-1:123',2,$3,$4,
           NOW(),180,NOW(),NOW() + INTERVAL '180 seconds'
         )`,
        [attemptId, runId, nonce, 'c'.repeat(64)],
      ),
      '23505',
    );
    await expectTransactionFailure(
      () => client.query('DELETE FROM harness_attempts WHERE id=$1', [attemptId]),
      '23503',
    );

    const version = await client.query(
      `SELECT version, COUNT(*)::int AS count
         FROM schema_version
        WHERE version='371'
        GROUP BY version`,
    );
    expect(version.rows).toEqual([{ version: '371', count: 1 }]);
  });

  it('atomically dedupes an exact heartbeat and conflicts on altered nonce reuse', async () => {
    await client.query(
      `UPDATE harness_attempts
          SET actual_machine_id='xian-mac-m4',
              remote_job_id='job-7',
              lease_owner='brain-1:123',
              lease_generation=2,
              machine_attestation_status='verified',
              provider_session_id='session-1',
              status='running'
        WHERE id=$1`,
      [attemptId],
    );
    const observedAt = new Date().toISOString();
    const durableNonce = randomUUID();
    const heartbeatInput = {
      attemptId,
      runId,
      workerId: 'xian-mac-m4',
      jobId: 'job-7',
      leaseOwner: 'brain-1:123',
      leaseGeneration: 2,
      heartbeatNonce: durableNonce,
      requestSha256: 'd'.repeat(64),
      observedAt,
      leaseSeconds: 180,
      providerSessionId: 'session-1',
    };
    const transactionalPool = {
      query: (...args) => client.query(...args),
      connect: async () => ({
        query: (...args) => client.query(...args),
        release() {},
      }),
    };
    const store = createAttemptStore(transactionalPool);

    const first = await store.persistFleetHeartbeat(heartbeatInput);
    const retry = await store.persistFleetHeartbeat(heartbeatInput);
    expect(first.deduped).toBe(false);
    expect(retry.deduped).toBe(true);
    expect(retry.receipt.receipt_id).toBe(first.receipt.receipt_id);
    expect(retry.receipt.heartbeat_at).toEqual(first.receipt.heartbeat_at);
    expect(retry.receipt.lease_expires_at).toEqual(first.receipt.lease_expires_at);

    await expect(store.persistFleetHeartbeat({
      ...heartbeatInput,
      requestSha256: 'e'.repeat(64),
      leaseSeconds: 240,
    })).rejects.toMatchObject({ code: 'fleet_heartbeat_conflict' });

    const receipts = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM harness_heartbeat_receipts
        WHERE attempt_id=$1 AND heartbeat_nonce=$2`,
      [attemptId, durableNonce],
    );
    expect(receipts.rows).toEqual([{ count: 1 }]);
  });
});
