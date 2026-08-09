import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// 禁 mock 边：代码 ↔ tasks.result 写路径必须真 Postgres 验证（brain-integration job 提供真 PG）。
// 本文件走真实 dbPool，禁 stub。DB_URL 缺失时该 job 会注入；本地无 PG 时此 integration 由 CI 真跑。
import pg from 'pg';
import {
  persistTerminalFailure,
  FAILURE_CLASSES,
} from '../../../packages/brain/src/orchestrator/failure-class.js';

const DB_URL = process.env.DB_URL || process.env.DATABASE_URL;

describe('persistTerminalFailure real Postgres [BEHAVIOR]', () => {
  let pool: any;
  const createdIds: string[] = [];

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    if (createdIds.length) {
      await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [createdIds]);
    }
    await pool.end();
  });

  it('persistTerminalFailure writes result failure_class', async () => {
    const { rows } = await pool.query(
      `INSERT INTO tasks(id, task_type, status, title, created_at)
       VALUES (gen_random_uuid(), 'harness_initiative', 'in_progress', 'pg-int-failclass', NOW())
       RETURNING id`,
    );
    const id = rows[0].id;
    createdIds.push(id);

    await persistTerminalFailure(pool, id, 'timeout', 'pg integration detail');

    const { rows: after } = await pool.query(
      `SELECT result->>'failure_class' AS fc, result->>'failure_detail' AS fd FROM tasks WHERE id=$1`,
      [id],
    );
    expect(after[0].fc).toBe('timeout');
    expect(FAILURE_CLASSES).toContain(after[0].fc);
    expect(after[0].fd).toBe('pg integration detail');
  });

  it('persistTerminalFailure rejects non-enum failure_class (fail-closed, no free text in result)', async () => {
    const { rows } = await pool.query(
      `INSERT INTO tasks(id, task_type, status, title, created_at)
       VALUES (gen_random_uuid(), 'harness_initiative', 'in_progress', 'pg-int-reject', NOW())
       RETURNING id`,
    );
    const id = rows[0].id;
    createdIds.push(id);

    await expect(persistTerminalFailure(pool, id, 'free_text_bogus', 'x')).rejects.toThrow(
      /invalid failure_class/i,
    );
    const { rows: after } = await pool.query(
      `SELECT result->>'failure_class' AS fc FROM tasks WHERE id=$1`,
      [id],
    );
    expect(after[0].fc).toBeNull();
  });
});
