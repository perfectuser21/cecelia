import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DB_DEFAULTS } from '../../db-config.js';

const databaseName = process.env.TEST_DATABASE_URL
  ? decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1))
  : DB_DEFAULTS.database;
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`Migration 411 integration test 拒绝连接非测试库: ${databaseName}`);
}

const pool = new pg.Pool(process.env.TEST_DATABASE_URL
  ? { connectionString: process.env.TEST_DATABASE_URL, max: 2 }
  : { ...DB_DEFAULTS, max: 2 });

afterAll(async () => {
  await pool.end();
});

describe('Migration 411 — 批准合同测试不可变', () => {
  it('真实 PostgreSQL 拒绝改写 approved_sha 或已冻结 artifacts', async () => {
    const client = await pool.connect();
    const initiativeId = randomUUID();
    try {
      await client.query('BEGIN');
      const { rows: [contract] } = await client.query(
        `INSERT INTO initiative_contracts (
           initiative_id, version, status, approved_sha, frozen_artifacts
         ) VALUES ($1, 1, 'approved', $2, $3::jsonb)
         RETURNING id`,
        [initiativeId, 'a'.repeat(40), JSON.stringify([{
          type: 'frozen_contract_test',
          path: 'sprints/example/tests/red.test.js',
          content: 'RED',
          sha256: 'b'.repeat(64),
          source_sha: 'a'.repeat(40),
        }])],
      );

      await client.query('SAVEPOINT before_sha_mutation');
      await expect(client.query(
        `UPDATE initiative_contracts SET approved_sha = $2 WHERE id = $1`,
        [contract.id, 'c'.repeat(40)],
      )).rejects.toThrow(/approved contract SHA is immutable/);
      await client.query('ROLLBACK TO SAVEPOINT before_sha_mutation');

      await expect(client.query(
        `UPDATE initiative_contracts SET frozen_artifacts = '[]'::jsonb WHERE id = $1`,
        [contract.id],
      )).rejects.toThrow(/approved contract artifacts are immutable/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
