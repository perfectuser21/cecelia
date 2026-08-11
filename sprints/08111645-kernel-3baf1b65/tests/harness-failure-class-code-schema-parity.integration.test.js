// 目标落位：packages/brain/src/__tests__/integration/harness-failure-class-code-schema-parity.integration.test.js
// 本文件为合同净新增交付物（Golden Path Step 3 / DoD B-02）的权威形态，generator 原样落位即可。
//
// 代码↔schema 奇偶（防未来脱钩）守卫：
//   从 execution-contract.js 的 zod schema **动态读取** failure_class 枚举全集（不硬编码复制清单），
//   在应用迁移 406 后的隔离 schema 上，对每一个枚举值真 UPDATE harness_attempts.failure_class 断言接受，
//   并对一个不在枚举内的脏值断言被拒（SQLSTATE 23514）。
//   当且仅当  zod 枚举 ⊆ DB 约束接受集  时全绿——未来给 zod 加值却漏配套迁移，本测试立即红。
//
// 禁 mock 被改的边（合同硬约束）：本测试真连 PostgreSQL，禁止 mock pool / vi.mock('pg')。
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { __test__ } from '../../orchestrator/execution-contract.js';

// 代码侧 SSOT：直接从 zod schema 取枚举，绝不复制清单
const failureClassField = __test__.harnessResultSchema.shape.failure_class;
const failureClassEnum =
  typeof failureClassField.unwrap === 'function' ? failureClassField.unwrap() : failureClassField;
const ZOD_FAILURE_CLASSES = failureClassEnum.options;

const migrationFiles = [
  '357_harness_provider_attempts.sql',
  '366_kernel_harness_failure_class.sql',
  '378_harness_attempt_needs_context_class.sql',
  '406_harness_attempt_account_exhausted.sql',
].map((name) => readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8'));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl
  ? decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1))
  : DB_DEFAULTS.database;

if (!/(_test|_scratch)$/.test(databaseName || '')) {
  throw new Error(
    `failure_class parity integration test requires a test database, got ${databaseName}`,
  );
}

const pool = new pg.Pool(
  testDatabaseUrl ? { connectionString: testDatabaseUrl, max: 1 } : { ...DB_DEFAULTS, max: 1 },
);

const schemaName = `parity_fc_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const quotedSchema = `"${schemaName}"`;
const runId = randomUUID();
const attemptId = randomUUID();
let client;

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
  for (const migration of migrationFiles) {
    await client.query(migration);
  }
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

describe('failure_class code<->schema parity [PostgreSQL]', () => {
  it('enumerates at least the five known classes from the zod schema', () => {
    expect(Array.isArray(ZOD_FAILURE_CLASSES)).toBe(true);
    expect(ZOD_FAILURE_CLASSES.length).toBeGreaterThanOrEqual(5);
    expect(ZOD_FAILURE_CLASSES).toContain('account_exhausted');
  });

  it('accepts every failure_class value declared in the execution-contract zod enum', async () => {
    for (const failureClass of ZOD_FAILURE_CLASSES) {
      await client.query('UPDATE harness_attempts SET failure_class=$1 WHERE id=$2', [
        failureClass,
        attemptId,
      ]);
      const { rows } = await client.query(
        'SELECT failure_class FROM harness_attempts WHERE id=$1',
        [attemptId],
      );
      expect(rows).toEqual([{ failure_class: failureClass }]);
    }
  });

  it('still rejects a value outside the zod enum (constraint only appended, not loosened)', async () => {
    const dirtyValue = 'arbitrary_dirty_value_not_in_zod';
    expect(ZOD_FAILURE_CLASSES).not.toContain(dirtyValue);
    await client.query('BEGIN');
    try {
      await expect(
        client.query('UPDATE harness_attempts SET failure_class=$1 WHERE id=$2', [
          dirtyValue,
          attemptId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
