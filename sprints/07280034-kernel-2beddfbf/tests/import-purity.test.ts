import { describe, expect, it } from 'vitest';

import pg from 'pg';

const { Pool } = pg;

describe('kernel-harness-f1-baseline 生产 consumer import purity', () => {
  it('无 psql PATH 导入真实 orchestrator/run.js 时 catalog、env 与进程语义不变', async () => {
    const url = process.env.HARNESS_OPERATOR_BOOTSTRAP_URL;
    if (!url) {
      throw new Error(
        'FAKE_RED: HARNESS_OPERATOR_BOOTSTRAP_URL 缺失；禁止用 DB_NAME 或默认 cecelia 顶替',
      );
    }
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3_000 });
    const catalogBefore = await pool.query(
      `SELECT count(*)::int AS databases FROM pg_database
       WHERE datname LIKE 'harness_attempt_%'`,
    );
    const envBefore = { ...process.env };
    const pathBefore = process.env.PATH;
    process.env.PATH = '/usr/bin:/bin';
    try {
      const consumer = await import('../../../packages/brain/src/orchestrator/run.js');
      expect(
        consumer.parseArgs(['--task-id', '11111111-1111-4111-8111-111111111111']),
      ).toEqual({
        taskId: '11111111-1111-4111-8111-111111111111',
        runId: null,
        dryRun: false,
      });
    } finally {
      process.env.PATH = pathBefore;
    }
    const catalogAfter = await pool.query(
      `SELECT count(*)::int AS databases FROM pg_database
       WHERE datname LIKE 'harness_attempt_%'`,
    );
    expect(catalogAfter.rows[0]).toEqual(catalogBefore.rows[0]);
    expect({ ...process.env }).toEqual(envBefore);
    await pool.end();
  });
});
