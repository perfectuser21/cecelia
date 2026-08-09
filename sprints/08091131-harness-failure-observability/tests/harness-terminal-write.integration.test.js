import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
// TDD Red: markHarnessTerminal 尚未实现 → import 失败 = 真红。
// 禁 mock 被改的边：本测试用真 Postgres 验 result.failure_class 真落库（CI brain postgres service 提供 DATABASE_URL）。
import { markHarnessTerminal } from '../../../packages/brain/src/lib/harness-failure-class.js';

const DB = process.env.DATABASE_URL || process.env.DB_URL;
const pool = DB ? new pg.Pool({ connectionString: DB }) : null;
afterAll(async () => { if (pool) await pool.end(); });

describe('harness terminal write (integration, real Postgres) [BEHAVIOR]', () => {
  it('markHarnessTerminal 写入 result.failure_class 真落库', async () => {
    if (!pool) throw new Error('DATABASE_URL/DB_URL 未注入——集成测试需真 Postgres（CI brain postgres service）');
    const { rows } = await pool.query(
      "INSERT INTO tasks (id, task_type, status, title, created_at) VALUES (gen_random_uuid(),'harness_initiative','in_progress','it-failclass',NOW()) RETURNING id",
    );
    const id = rows[0].id;
    await markHarnessTerminal(pool, { taskId: id, status: 'failed', failureClass: 'invalid_gear', failureDetail: 'integration' });
    const { rows: got } = await pool.query("SELECT result->>'failure_class' AS fc, status FROM tasks WHERE id=$1", [id]);
    await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
    expect(got[0].fc).toBe('invalid_gear');
    expect(got[0].status).toBe('failed');
  });
});
