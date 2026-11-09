import { describe, it, expect, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const boundary = vi.hoisted(() => ({
  thalamus: vi.fn(async () => ({ actions: [] })),
  decision: vi.fn(async () => ({ actions: [] })),
  rumination: vi.fn(async () => undefined),
  plan: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [{ id: 'isolated-kr' }] })),
}));
vi.mock('../../thalamus.js', () => ({ processEvent: boundary.thalamus, EVENT_TYPES: { TICK: 'tick' } }));
vi.mock('../../decision.js', () => ({ generateDecision: boundary.decision }));
vi.mock('../../rumination.js', () => ({ runRumination: boundary.rumination }));
vi.mock('../../planner.js', () => ({ planNextTask: boundary.plan }));
vi.mock('../../guidance.js', () => ({ setGuidance: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: boundary.query } }));

import { buildConsciousnessGraph } from '../../workflows/consciousness.graph.js';
import { buildPgCheckpointer } from '../../orchestrator/pg-checkpointer.js';

function checkedTestUrl(value) {
  if (!value) throw new Error('显式 TEST_DATABASE_URL 必填');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/cecelia_(?:scratch|test)(?:_[a-z0-9_]+)?$/.test(url.pathname)
    || url.search || url.hash) throw new Error('仅允许 loopback 隔离测试库，不接受生产或连接参数');
  return url;
}

describe('现役意识图真实 PostgreSQL checkpoint 跨进程恢复', () => {
  it('缺连接、生产库、远端及覆盖 search_path 的参数均在连接前拒绝', () => {
    for (const value of [undefined, 'postgresql://localhost/cecelia',
      'postgresql://example.invalid/cecelia_scratch',
      'postgresql://localhost/cecelia_scratch?options=-csearch_path=public']) {
      expect(() => checkedTestUrl(value)).toThrow();
    }
  });

  it('关闭 writer 后独立进程读回 thalamus，fresh graph 以 null 恢复且不重放已完成节点', async () => {
    const url = checkedTestUrl(process.env.TEST_DATABASE_URL);
    const thread = { configurable: { thread_id: `consciousness-pg-test:${randomUUID()}` } };
    const admin = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    const savers = [];
    let setup = false;
    try {
      const identity = (await admin.query('SELECT current_database() AS name')).rows[0];
      expect(identity.name).toBe(decodeURIComponent(url.pathname.slice(1)));
      const saver = () => {
        const value = buildPgCheckpointer(url.href);
        savers.push(value);
        return value;
      };
      const writer = saver();
      // 生产 factory 固定使用 public；隔离边界是显式测试库及本测试唯一 thread。
      await writer.setup();
      setup = true;
      const interrupted = buildConsciousnessGraph().compile({ checkpointer: writer, interruptBefore: ['decision'] });
      const partial = await interrupted.invoke({ completed_steps: [], errors: [], run_ts: '2026-11-09T00:00:00.000Z' },
        { ...thread, durability: 'sync' });
      expect(partial.completed_steps).toEqual(['thalamus']);
      expect((await interrupted.getState(thread)).next).toEqual(['decision']);
      expect(boundary.thalamus).toHaveBeenCalledTimes(1);
      expect(boundary.decision).not.toHaveBeenCalled();
      await writer.pool.end();
      savers.splice(savers.indexOf(writer), 1);

      // 新 Node 进程只能从 PG 读取；没有父进程图对象、MemorySaver 或共享连接池。
      const child = execFileSync(process.execPath, ['--input-type=module', '-e', `
        import pg from 'pg';
        import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
        const pool = new pg.Pool({connectionString: process.env.CHECKPOINT_TEST_URL});
        try {
          const saver = new PostgresSaver(pool);
          const tuple = await saver.getTuple(JSON.parse(process.env.CHECKPOINT_THREAD));
          console.log(JSON.stringify({pid:process.pid, steps:tuple?.checkpoint.channel_values.completed_steps,
            run_ts:tuple?.checkpoint.channel_values.run_ts}));
        } finally { await pool.end(); }
      `], { cwd: fileURLToPath(new URL('../../../', import.meta.url)),
        env: { ...process.env, CHECKPOINT_TEST_URL: url.href, CHECKPOINT_THREAD: JSON.stringify(thread) },
        encoding: 'utf8', timeout: 15000 });
      const persisted = JSON.parse(child);
      expect(persisted.pid).not.toBe(process.pid);
      expect(persisted.steps).toEqual(['thalamus']);
      expect(persisted.run_ts).toBe('2026-11-09T00:00:00.000Z');

      const reader = saver();
      const fresh = buildConsciousnessGraph().compile({ checkpointer: reader });
      const result = await fresh.invoke(null, { ...thread, durability: 'sync' });
      expect(result.completed_steps).toEqual(['thalamus', 'decision', 'rumination', 'plan']);
      expect(result.errors).toEqual([]);
      expect(boundary.thalamus).toHaveBeenCalledTimes(1);
      expect(boundary.decision).toHaveBeenCalledTimes(1);
      expect(boundary.rumination).toHaveBeenCalledTimes(1);
      expect(boundary.plan).toHaveBeenCalledTimes(1);
      expect((await fresh.getState(thread)).next).toEqual([]);
      const stored = await admin.query('SELECT count(*)::int AS total FROM public.checkpoints WHERE thread_id=$1',
        [thread.configurable.thread_id]);
      expect(stored.rows[0].total).toBeGreaterThan(1);
    } finally {
      await Promise.all(savers.map(value => value.pool.end()));
      if (setup) {
        for (const table of ['checkpoint_writes', 'checkpoint_blobs', 'checkpoints']) {
          await admin.query(`DELETE FROM public.${table} WHERE thread_id=$1`, [thread.configurable.thread_id]);
        }
        expect((await admin.query('SELECT count(*)::int AS total FROM public.checkpoints WHERE thread_id=$1',
          [thread.configurable.thread_id])).rows[0].total).toBe(0);
      }
      await admin.end();
    }
  }, 30000);
});
