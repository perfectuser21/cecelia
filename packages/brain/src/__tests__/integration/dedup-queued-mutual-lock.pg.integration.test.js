import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

// 两张同分钟 queued 任务的标题查重走真实 SQL：更早的先走，不互锁（任务 c8320370，生产 10-12 07:30）。
const state = vi.hoisted(() => ({ pool: null, errors: [] }));
vi.mock('../../db.js', () => ({ default: { query: async (...args) => {
  try { return await state.pool.query(...args); } catch (error) { state.errors.push(error); throw error; }
} } }));
import { _internals_findDuplicateTaskSibling } from '../../dispatcher.js';

const schema = `dedup_mutual_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client(DB_DEFAULTS);
beforeAll(async () => {
  if (DB_DEFAULTS.database !== (process.env.CI === 'true' ? 'cecelia_test' : 'cecelia_scratch')) throw Error('fixture 仅允许本机 scratch/CI 测试库');
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`);
  state.pool = new pg.Pool({ ...DB_DEFAULTS, max: 2, options: `-c search_path=${schema} -c statement_timeout=3000` });
  await state.pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text,task_type text,status text,created_at timestamptz,payload jsonb,parent_task_id uuid);
    CREATE TABLE work_routing_receipts(id uuid PRIMARY KEY,task_id uuid,source text,source_id text,canonical_task_type text);
    CREATE TABLE workflows(id uuid PRIMARY KEY,status text);`);
});
afterAll(async () => { await state.pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => { state.errors = []; await state.pool.query('TRUNCATE tasks,work_routing_receipts,workflows'); });
afterEach(() => expect(state.errors).toEqual([]));

async function task(title, createdAt, status = 'queued') {
  const id = randomUUID();
  await state.pool.query("INSERT INTO tasks VALUES($1,$2,'script_run',$3,$4,'{}'::jsonb,null)", [id, title, status, createdAt]);
  return { id, title, task_type: 'script_run', created_at: createdAt, payload: {} };
}

it('真实SQL：同分钟两张 queued 单，更早的不被更新的挡、更新的仍被更早的挡', async () => {
  const older = await task('手机账号巡查运行维护检查 · 2026-10-12 07:30', '2026-10-11T23:30:02.400Z');
  const newer = await task('悦升云端增长情报日报 · 2026-10-12 07:30', '2026-10-11T23:30:02.500Z');
  expect(await _internals_findDuplicateTaskSibling(older)).toBeNull();
  expect(await _internals_findDuplicateTaskSibling(newer)).toMatchObject({ id: older.id });
});
it('真实SQL：更新的 sibling 已 in_progress 时照旧挡更早的候选', async () => {
  const older = await task('手机账号巡查运行维护检查 · 2026-10-12 07:30', '2026-10-11T23:30:02.400Z');
  const running = await task('悦升云端增长情报日报 · 2026-10-12 07:30', '2026-10-11T23:30:02.500Z', 'in_progress');
  expect(await _internals_findDuplicateTaskSibling(older)).toMatchObject({ id: running.id });
});
