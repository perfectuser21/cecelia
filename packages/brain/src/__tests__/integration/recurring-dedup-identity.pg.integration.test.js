import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

// 定时实例身份判重走真实 SQL（任务 c8320370）：只认 scheduler 路由收据，payload 自报不作数。
const state = vi.hoisted(() => ({ pool: null, errors: [] }));
vi.mock('../../db.js', () => ({ default: { query: async (...args) => {
  try { return await state.pool.query(...args); } catch (error) { state.errors.push(error); throw error; }
} } }));
import { _internals_findDuplicateTaskSibling } from '../../dispatcher.js';

const schema = `recurring_identity_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client(DB_DEFAULTS);
const slot = '2026-10-11T17:22:00.000Z';
beforeAll(async () => {
  if (DB_DEFAULTS.database !== (process.env.CI === 'true' ? 'cecelia_test' : 'cecelia_scratch')) throw Error('fixture 仅允许本机 scratch/CI 测试库');
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`);
  state.pool = new pg.Pool({ ...DB_DEFAULTS, max: 2, options: `-c search_path=${schema} -c statement_timeout=3000` });
  await state.pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text,task_type text,status text,created_at timestamptz,payload jsonb,parent_task_id uuid);
    CREATE TABLE work_routing_receipts(id uuid PRIMARY KEY,task_id uuid,source text,source_id text,canonical_task_type text);`);
});
afterAll(async () => { await state.pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });
beforeEach(async () => { state.errors = []; await state.pool.query('TRUNCATE tasks,work_routing_receipts'); });
afterEach(() => expect(state.errors).toEqual([]));

async function task({ title, template = randomUUID(), source = 'scheduler', sourceId = null }) {
  const id = randomUUID(), receipt = randomUUID();
  const payload = { recurring_task_id: template, recurring_slot: slot, routing_receipt_id: receipt };
  await state.pool.query("INSERT INTO tasks VALUES($1,$2,'qiumi_task','queued',$3,$4,null)", [id, title, slot, payload]);
  await state.pool.query("INSERT INTO work_routing_receipts VALUES($1,$2,$3,$4,'qiumi_task')", [receipt, id, source, sourceId ?? `recurring:${template}:${slot}`]);
  return { id, title, task_type: 'qiumi_task', created_at: slot, payload };
}

it('真实SQL：不同模板同一时间点的定时实例标题只差 agent 名也互不判重（防互锁）', async () => {
  const a = await task({ title: 'media通道复测 · 2026-10-12 01:22' });
  const b = await task({ title: 'newmedia通道复测 · 2026-10-12 01:22' });
  expect(await _internals_findDuplicateTaskSibling(a)).toBeNull();
  expect(await _internals_findDuplicateTaskSibling(b)).toBeNull();
});
it('真实SQL：收据不是 scheduler 来源（payload 自报定时）仍按标题判重复', async () => {
  const a = await task({ title: 'media通道复测 · 2026-10-12 01:22' });
  const b = await task({ title: 'newmedia通道复测 · 2026-10-12 01:22', source: 'api', sourceId: 'manual:x' });
  expect(await _internals_findDuplicateTaskSibling(a)).toMatchObject({ id: b.id });
});
it('真实SQL：收据 source_id 与 payload 模板/时间点对不上不能获得豁免', async () => {
  const a = await task({ title: 'media通道复测 · 2026-10-12 01:22', sourceId: `recurring:${randomUUID()}:${slot}` });
  const b = await task({ title: 'newmedia通道复测 · 2026-10-12 01:22' });
  expect(await _internals_findDuplicateTaskSibling(a)).toMatchObject({ id: b.id });
});
