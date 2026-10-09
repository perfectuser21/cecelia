/**
 * ops-scheduler-liveness.pg.integration.test.js
 *
 * 真实 pg 集成测试——只覆盖 runSchedulerLiveness 的 upsert SQL 本身。
 * fakePool 按子串匹配会漏掉列名拼错、占位符错位、RETURNING 子查询语法错这类问题，
 * 这类 bug 只有真的对着 ops_workflows/working_memory 表跑一遍才测得出。
 *
 * 门控：无真实 PG 可连时整个 describe 跳过（不 mock pg，不假装绿）。
 * 隔离：每个用例 BEGIN 一个事务，结束 ROLLBACK，不污染共享测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { runSchedulerLiveness, SCHEDULER_SOURCE, SCHEDULER_MACHINE } from '../ops-scheduler-liveness.js';

// 探活：真的连一次，连不上就整体 skip（不是靠环境变量猜）
let DB_AVAILABLE = false;
{
  let probePool;
  try {
    probePool = new pg.Pool({ ...DB_DEFAULTS, max: 1, connectionTimeoutMillis: 2000 });
    await probePool.query('SELECT 1');
    DB_AVAILABLE = true;
  } catch {
    DB_AVAILABLE = false;
  } finally {
    if (probePool) await probePool.end().catch(() => {});
  }
}

describe.skipIf(!DB_AVAILABLE)('ops-scheduler-liveness — pg 集成（真实 upsert SQL，不 mock pg）', () => {
  let pool;
  let client;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  it('warn→dead 翻转发一条 Bark；再跑一次无翻转不发、未过 10min/600s 降噪不刷新', async () => {
    const now = Date.now();

    await client.query(
      `INSERT INTO ops_workflows (source, wf_id, name, active, machine, liveness, last_run_status, last_run_at, silent_sec, updated_at)
       VALUES ('scheduler', 't-job', 't-job', FALSE, $1, 'warn', 'success', NOW() - interval '1 hour', 0, NOW())`,
      [SCHEDULER_MACHINE],
    );
    await client.query(
      `INSERT INTO working_memory (key, value_json) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
      [
        'scheduler_job_last_run:t-job',
        JSON.stringify({ at: new Date(now).toISOString(), ok: true, liveness_at: new Date(now - 2000 * 1000).toISOString() }),
      ],
    );

    const bark = vi.fn().mockResolvedValue(true);
    const raise = vi.fn().mockResolvedValue(undefined);

    const r1 = await runSchedulerLiveness(client, { jobs: [{ name: 't-job', livenessIntervalSec: 30 }], now, raise, bark });
    expect(r1.ok).toBe(true);
    expect(bark).toHaveBeenCalledTimes(1);
    expect(bark.mock.calls[0][0] + bark.mock.calls[0][1]).toMatch(/t-job/);

    const { rows: after1 } = await client.query(
      `SELECT liveness, updated_at, silent_sec FROM ops_workflows WHERE source='scheduler' AND wf_id='t-job'`,
    );
    expect(after1[0].liveness).toBe('dead');
    const updatedAtAfter1 = after1[0].updated_at;

    bark.mockClear();
    raise.mockClear();

    // 5 秒后再跑一次：liveness 不变、silent_sec 增量仅 ~5s（<600），last_run_at 未前进——不该刷新、不该再发
    const r2 = await runSchedulerLiveness(client, { jobs: [{ name: 't-job', livenessIntervalSec: 30 }], now: now + 5000, raise, bark });
    expect(r2.ok).toBe(true);
    expect(bark).not.toHaveBeenCalled();

    const { rows: after2 } = await client.query(
      `SELECT liveness, updated_at FROM ops_workflows WHERE source='scheduler' AND wf_id='t-job'`,
    );
    expect(after2[0].liveness).toBe('dead');
    expect(new Date(after2[0].updated_at).getTime()).toBe(new Date(updatedAtAfter1).getTime());
  });
});
