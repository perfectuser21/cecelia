import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
// TDD Red: markHarnessTaskTerminal 尚不存在 → import 失败 → red
// 禁 mock 边：真 Postgres、真 helper（code ↔ tasks.result 写路径），只在 DB_URL 存在时真跑
// @ts-ignore
import { markHarnessTaskTerminal } from '../../../packages/brain/src/harness-failure-class.js';

const DB_URL = process.env.DB_URL || process.env.DATABASE_URL;
const pool = DB_URL ? new pg.Pool({ connectionString: DB_URL }) : null;

afterAll(async () => { if (pool) await pool.end(); });

describe('markHarnessTaskTerminal 写 tasks.result [BEHAVIOR]', () => {
  it('markHarnessTaskTerminal 写 result.failure_class 与 failure_detail', async () => {
    if (!pool) { expect(typeof markHarnessTaskTerminal).toBe('function'); return; }
    const id = (await pool.query(
      "INSERT INTO tasks(task_type,title,status,payload) VALUES($1,$2,$3,$4) RETURNING id",
      ['harness_initiative', 'vitest-mark-terminal', 'in_progress', '{}'],
    )).rows[0].id;
    try {
      await markHarnessTaskTerminal(pool, id, { status: 'failed', failureClass: 'watchdog_deadline', failureDetail: 'd' });
      const r = (await pool.query('SELECT status, result FROM tasks WHERE id=$1', [id])).rows[0];
      expect(r.status).toBe('failed');
      expect(r.result.failure_class).toBe('watchdog_deadline');
      expect(r.result.failure_detail).toBe('d');
    } finally {
      await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
    }
  });
});
