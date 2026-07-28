import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const migration = readFileSync(
  new URL(
    '../../../migrations/379_codex_review_callback_idempotency.sql',
    import.meta.url,
  ),
  'utf8',
);
const schemaName =
  `codex_callback_377_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;

let adminPool;
let client;

beforeAll(async () => {
  adminPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  client = await adminPool.connect();
  await client.query(`SET search_path TO ${quotedSchema}`);
  await client.query(`
    CREATE TABLE schema_version (
      version VARCHAR(10) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE callback_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL,
      run_id TEXT,
      status TEXT NOT NULL,
      result_json JSONB,
      attempt INTEGER NOT NULL DEFAULT 1,
      exit_code INTEGER,
      failure_class TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
  `);
}, 15_000);

afterAll(async () => {
  if (client) client.release();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await adminPool.end();
  }
});

describe('migration 379 — real PostgreSQL callback idempotency', () => {
  it('permits legacy null keys but rejects duplicate non-null keys', async () => {
    await client.query(migration);
    const taskId = randomUUID();
    const runId = randomUUID();
    await expect(client.query(
      `INSERT INTO callback_queue (task_id, run_id, status)
       VALUES ($1, $2, 'AI Done'), ($1, $2, 'AI Done')`,
      [taskId, runId],
    )).resolves.toBeTruthy();

    await client.query(
      `INSERT INTO callback_queue
         (task_id, run_id, status, idempotency_key)
       VALUES ($1, $2, 'AI Done', $3)`,
      [taskId, runId, `codex-review/${taskId}/${runId}`],
    );
    await expect(client.query(
      `INSERT INTO callback_queue
         (task_id, run_id, status, idempotency_key)
       VALUES ($1, $2, 'AI Failed', $3)`,
      [taskId, runId, `codex-review/${taskId}/${runId}`],
    )).rejects.toMatchObject({ code: '23505' });
  });

  it('is idempotent and records schema version 379 once', async () => {
    await expect(client.query(migration)).resolves.toBeTruthy();
    const { rows } = await client.query(
      `SELECT version FROM schema_version WHERE version = '379'`,
    );
    expect(rows).toHaveLength(1);
  });
});
