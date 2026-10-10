import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

const state = vi.hoisted(() => ({ pool: null, errors: [] }));
// 原始生产查询透传私有真实 PostgreSQL；不伪造 Workflow 或 receipt 判定结果。
vi.mock('../../db.js', () => ({ default: { query: async (...args) => {
  try { return await state.pool.query(...args); } catch (error) { state.errors.push(error); throw error; }
} } }));
import { _internals_findDuplicateTaskSibling } from '../../dispatcher.js';

const schema = `code_identity_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client(DB_DEFAULTS);
const workflow = randomUUID(), otherWorkflow = randomUUID(), parent = randomUUID();
const slot = '2026-10-10T15:16:00.000Z';
beforeAll(async () => {
  if (DB_DEFAULTS.database !== (process.env.CI === 'true' ? 'cecelia_test' : 'cecelia_scratch')) throw Error('身份判重fixture仅允许本机scratch/CI测试库');
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`);
  state.pool = new pg.Pool({ ...DB_DEFAULTS, max: 2, options: `-c search_path=${schema} -c statement_timeout=3000` });
  await state.pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text,task_type text,status text,created_at timestamptz,payload jsonb,parent_task_id uuid);
    CREATE TABLE workflows(id uuid PRIMARY KEY,status text);
    CREATE TABLE work_routing_receipts(id uuid PRIMARY KEY,task_id uuid,source text,source_id text,canonical_task_type text,router_version text DEFAULT 'work-router-v1',anchor_generation integer DEFAULT 1,
      UNIQUE(source,source_id,router_version,anchor_generation));`);
  expect((await state.pool.query('SELECT current_database() AS db,current_schema() AS schema')).rows[0]).toEqual({db:DB_DEFAULTS.database,schema});
});
afterAll(async () => {
  await state.pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
});
beforeEach(async () => {
  state.errors = []; await state.pool.query('TRUNCATE tasks,workflows,work_routing_receipts');
  await state.pool.query("INSERT INTO workflows VALUES($1,'active'),($2,'active')", [workflow, otherWorkflow]);
});
afterEach(() => expect(state.errors).toEqual([]));

async function task({serial = null, wf = workflow, schedule = randomUUID(), title = '账号巡查 · 同一格式标题', patch = {}, parentId = parent} = {}) {
  const id = randomUUID(), receipt = randomUUID();
  const payload = {runtime_requires_llm:false,multi_task:true,workflow_id:wf,routing_receipt_id:receipt,
    ...(serial ? {phone_serial:serial} : {recurring_task_id:schedule,recurring_slot:slot}), ...patch};
  const source = serial ? 'api' : 'scheduler';
  const sourceId = serial ? `phone-account-patrol:${parentId}:${serial}` : `recurring:${schedule}:${slot}`;
  await state.pool.query("INSERT INTO tasks VALUES($1,$2,'script_run','queued',$3,$4,$5)", [id,title,slot,payload,serial ? parentId : null]);
  await state.pool.query("INSERT INTO work_routing_receipts(id,task_id,source,source_id,canonical_task_type) VALUES($1,$2,$3,$4,'script_run')", [receipt,id,source,sourceId]);
  return {id,title,task_type:'script_run',created_at:slot,payload,receipt,source,sourceId};
}

it('真实SQL：批次与维护不同active Workflow、同标题均可独立派发', async () => {
  const a = await task(), b = await task({wf:otherWorkflow});
  expect(await _internals_findDuplicateTaskSibling(a)).toBeNull();
  expect(await _internals_findDuplicateTaskSibling(b)).toBeNull();
});
it('真实SQL：同父批次四个serial的脚本任务互不判重', async () => {
  const phones = [];
  for (const serial of ['white','blue','color','yellow']) phones.push(await task({serial}));
  for (const phone of phones) expect(await _internals_findDuplicateTaskSibling(phone)).toBeNull();
});
it('真实SQL：同手机、同slot的两个正式定时来源，即使不同标题仍抑制重复', async () => {
  const a = await task(), b = await task({title:'完全不同标题'});
  await state.pool.query("UPDATE tasks SET payload=payload||'{\"phone_serial\":\"white\"}'::jsonb WHERE id=ANY($1::uuid[])", [[a.id,b.id]]);
  expect(await _internals_findDuplicateTaskSibling(a)).toMatchObject({id:b.id,duplicate_reason:'duplicate_code_task_business_identity_match'});
});
it('真实ledger同source不能创建第二个任务的相同来源收据', async () => {
  const a = await task({serial:'white'});
  await expect(state.pool.query("INSERT INTO work_routing_receipts(id,task_id,source,source_id,canonical_task_type) VALUES($1,$2,$3,$4,'script_run')", [randomUUID(),randomUUID(),a.source,a.sourceId])).rejects.toMatchObject({code:'23505'});
});
it.each([
  ['inactive Workflow',{}], ['字符串false LLM',{runtime_requires_llm:'false'}], ['字符串true multi',{multi_task:'true'}],
  ['伪造slot',{recurring_slot:'2026-10-10T15:17:00.000Z'}],
])('真实SQL：%s 不能获得标题豁免', async (name, patch) => {
  const a = await task({patch}), b = await task({wf:otherWorkflow});
  if (name === 'inactive Workflow') await state.pool.query("UPDATE workflows SET status='inactive' WHERE id=$1", [workflow]);
  expect(await _internals_findDuplicateTaskSibling(a)).toMatchObject({id:b.id});
});
it('真实SQL：盗用另一任务routing_receipt_id不能冒充真实来源', async () => {
  const a = await task(), b = await task({wf:otherWorkflow});
  await state.pool.query('UPDATE tasks SET payload=payload||jsonb_build_object(\'routing_receipt_id\',$2::text) WHERE id=$1', [a.id,b.receipt]);
  expect(await _internals_findDuplicateTaskSibling(a)).toMatchObject({id:b.id});
});
it('真实SQL：候选对象声称active不会覆盖持久任务的非法Workflow', async () => {
  const a = await task({wf:randomUUID()}), b = await task({wf:otherWorkflow});
  expect(await _internals_findDuplicateTaskSibling({...a,payload:{...a.payload,workflow_id:workflow}})).toMatchObject({id:b.id});
});
