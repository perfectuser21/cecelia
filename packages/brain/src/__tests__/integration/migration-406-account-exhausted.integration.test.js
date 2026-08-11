import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const migration357 = readFileSync(
  new URL('../../../migrations/357_harness_provider_attempts.sql', import.meta.url),
  'utf8',
);
const migration366 = readFileSync(
  new URL('../../../migrations/366_kernel_harness_failure_class.sql', import.meta.url),
  'utf8',
);
const migration378 = readFileSync(
  new URL('../../../migrations/378_harness_attempt_needs_context_class.sql', import.meta.url),
  'utf8',
);
const migration406 = readFileSync(
  new URL('../../../migrations/406_harness_attempt_account_exhausted.sql', import.meta.url),
  'utf8',
);

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl
  ? decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1))
  : DB_DEFAULTS.database;

if (!/(_test|_scratch)$/.test(databaseName || '')) {
  throw new Error(`migration 406 integration test requires a test database, got ${databaseName}`);
}

const pool = new pg.Pool(testDatabaseUrl
  ? { connectionString: testDatabaseUrl, max: 1 }
  : { ...DB_DEFAULTS, max: 1 });

const schemaName = `migration_406_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const runId = randomUUID();
const attemptId = randomUUID();
let client;

async function expectCheckViolation(failureClass) {
  await client.query('BEGIN');
  try {
    await expect(client.query(
      'UPDATE harness_attempts SET failure_class=$1 WHERE id=$2',
      [failureClass, attemptId],
    )).rejects.toMatchObject({ code: '23514' });
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
      id UUID PRIMARY KEY
    );
  `);
  await client.query(migration357);
  await client.query(migration366);
  await client.query(migration378);
  await client.query('INSERT INTO initiative_runs (id) VALUES ($1)', [runId]);
  await client.query(
    `INSERT INTO harness_attempts (
       id, run_id, hop, phase, role, provider, task_bundle, callback_secret_hash
     ) VALUES ($1,$2,1,'evaluate','evaluator','claude','{}','callback-hash')`,
    [attemptId, runId],
  );
}, 15_000);

afterAll(async () => {
  if (client) {
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => {});
    client.release();
  }
  await pool.end();
});

describe('migration 406 account_exhausted failure class [PostgreSQL]', () => {
  it('reproduces the production callback check violation before migration 406', async () => {
    await expectCheckViolation('account_exhausted');
  });

  it('accepts account_exhausted after migration 406 and remains idempotent', async () => {
    await client.query(migration406);
    await client.query(migration406);
    await client.query(
      'UPDATE harness_attempts SET failure_class=$1 WHERE id=$2',
      ['account_exhausted', attemptId],
    );
    const { rows } = await client.query(
      'SELECT failure_class FROM harness_attempts WHERE id=$1',
      [attemptId],
    );
    expect(rows).toEqual([{ failure_class: 'account_exhausted' }]);
    expect((await client.query(
      "SELECT COUNT(*)::int AS count FROM schema_version WHERE version='406'",
    )).rows[0].count).toBe(1);
  });

  it('still rejects an unknown failure class', async () => {
    await expectCheckViolation('arbitrary_dirty_value');
  });
});
