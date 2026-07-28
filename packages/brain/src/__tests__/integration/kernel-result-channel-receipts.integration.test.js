import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const migrations = [357, 363, 369, 370].map((version) => {
  const names = {
    357: '357_harness_provider_attempts.sql',
    363: '363_kernel_fleet_execution_receipts.sql',
    369: '369_allow_fleet_worker_execution_transport.sql',
    370: '370_kernel_result_channel_receipts.sql',
  };
  return readFileSync(new URL(`../../../migrations/${names[version]}`, import.meta.url), 'utf8');
});

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(
    `Kernel result receipt integration requires a test database, got ${DB_DEFAULTS.database}`,
  );
}

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
const schemaName = `kernel_result_receipts_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const runId = randomUUID();
const attemptId = randomUUID();
const receiptId = randomUUID();
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

describe('migrations 369-370 on PostgreSQL', () => {
  it('accepts fleet-worker and persists exactly one receipt linked from its Attempt', async () => {
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
      `INSERT INTO harness_result_receipts (
         receipt_id, attempt_id, run_id, task_id, role, provider, requested_provider,
         task_bundle_sha256, result_authority_sha256, result_authority,
         worker_id, job_id, lease_owner, lease_generation, delivery_id,
         result_nonce, result_sha256, result_bytes, terminal_status, result
       ) VALUES (
         $1,$2,$3,$4,'planner','claude','claude',$5,$6,'{}',
         'xian-mac-m4','job-7','brain-1:123',2,$7,$8,$9,321,
         'completed',$10::jsonb
       )`,
      [
        receiptId,
        attemptId,
        runId,
        randomUUID(),
        'd'.repeat(64),
        'e'.repeat(64),
        randomUUID(),
        randomUUID(),
        'a'.repeat(64),
        JSON.stringify({ status: 'completed' }),
      ],
    );
    await client.query(
      'UPDATE harness_attempts SET result_receipt_id=$2 WHERE id=$1',
      [attemptId, receiptId],
    );

    const linked = await client.query(
      `SELECT a.result_receipt_id, r.attempt_id, r.result_sha256
         FROM harness_attempts a
         JOIN harness_result_receipts r ON r.receipt_id=a.result_receipt_id
        WHERE a.id=$1`,
      [attemptId],
    );
    expect(linked.rows).toEqual([{
      result_receipt_id: receiptId,
      attempt_id: attemptId,
      result_sha256: 'a'.repeat(64),
    }]);
  });

  it('is rerunnable and enforces append-only retention plus one receipt per Attempt', async () => {
    for (const migration of migrations.slice(2)) await client.query(migration);

    await expectTransactionFailure(
      () => client.query(
        'UPDATE harness_result_receipts SET result_sha256=$2 WHERE receipt_id=$1',
        [receiptId, 'b'.repeat(64)],
      ),
      'P0001',
    );
    await expectTransactionFailure(
      () => client.query('DELETE FROM harness_result_receipts WHERE receipt_id=$1', [receiptId]),
      'P0001',
    );
    await expectTransactionFailure(
      () => client.query('DELETE FROM harness_attempts WHERE id=$1', [attemptId]),
      '23503',
    );
    await expectTransactionFailure(
      () => client.query(
        `INSERT INTO harness_result_receipts (
           attempt_id, run_id, task_id, role, provider, requested_provider,
           task_bundle_sha256, result_authority_sha256, result_authority,
           worker_id, job_id, lease_owner, lease_generation, delivery_id,
           result_nonce, result_sha256, result_bytes, terminal_status, result
         ) VALUES (
           $1,$2,$3,'planner','claude','claude',$4,$5,'{}',
           'xian-mac-m4','job-8','brain-1:123',3,$6,$7,$8,10,'completed','{}'
         )`,
        [
          attemptId,
          runId,
          randomUUID(),
          'f'.repeat(64),
          '1'.repeat(64),
          randomUUID(),
          randomUUID(),
          'c'.repeat(64),
        ],
      ),
      '23505',
    );

    const versions = await client.query(
      `SELECT version, COUNT(*)::int AS count
         FROM schema_version
        WHERE version IN ('369','370')
        GROUP BY version
        ORDER BY version`,
    );
    expect(versions.rows).toEqual([
      { version: '369', count: 1 },
      { version: '370', count: 1 },
    ]);
  });
});
