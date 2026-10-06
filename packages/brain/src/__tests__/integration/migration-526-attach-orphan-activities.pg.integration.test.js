/**
 * 迁移 526（v3.0 第 5 刀①）：没有生效流程引用的 Activity，挂进所属能力的流程。
 * 在真库的事务里造数据重放迁移正文，断言后整体回滚，不污染共享库。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

const SQL = readFileSync(fileURLToPath(new URL('../../../migrations/526_attach_orphan_activities_to_workflows.sql', import.meta.url)), 'utf8')
  .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '');

let client;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw new Error('仅允许scratch/CI隔离库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  await client.query('BEGIN');
  await client.query('ALTER TABLE activities ADD COLUMN IF NOT EXISTS journey_id uuid, ADD COLUMN IF NOT EXISTS step_number integer'); // 迁移 528 前的列：526 按它们挂靠，事务回滚即还原
});
afterEach(async () => { await client.query('ROLLBACK'); await client.end(); });

async function capability(name) {
  const vs = (await client.query("INSERT INTO journeys (name, description) VALUES ($1, 'v') RETURNING id", [`${name}-价值流`])).rows[0].id;
  const cap = randomUUID();
  await client.query("INSERT INTO journeys (id, name, parent_journey_id, description) VALUES ($1, $2, $3, 'c')", [cap, name, vs]);
  return cap;
}
async function workflow(cap, key) {
  return (await client.query("INSERT INTO workflows (capability_id, key, name, channel) VALUES ($1, $2, $2, 'internal') RETURNING id", [cap, key])).rows[0].id;
}
async function activity(cap, number, status = 'planned') {
  return (await client.query("INSERT INTO activities (journey_id, name, step_number, status) VALUES ($1, $2, $3, $4) RETURNING id", [cap, `步骤${number}`, number, status])).rows[0].id;
}
const refsOf = async id => (await client.query(
  `SELECT w.key, r.slot_key, r.sequence_no, r.source_ref, r.active FROM workflow_activity_refs r JOIN workflows w ON w.id = r.workflow_id WHERE r.activity_id = $1`, [id])).rows;

describe('迁移 526：无流程引用的 Activity 挂进能力的流程', () => {
  it('能力下恰好一个流程：挂进去，顺序取 step_number，归属引用（source_ref 为空）', async () => {
    const cap = await capability(`t1-${randomUUID()}`);
    const wf = await workflow(cap, `t1_${randomUUID().slice(0, 8)}`);
    const [a1, a2] = [await activity(cap, 1), await activity(cap, 2)];
    await client.query(SQL);
    expect(await refsOf(a1)).toEqual([expect.objectContaining({ slot_key: 'step_1', sequence_no: 1, source_ref: null, active: true })]);
    expect((await refsOf(a2))[0]).toMatchObject({ slot_key: 'step_2', sequence_no: 2 });
    expect((await client.query('SELECT count(*)::int AS n FROM workflows WHERE capability_id = $1', [cap])).rows[0].n).toBe(1);
    expect((await client.query('SELECT workflow_id FROM workflow_activity_refs WHERE activity_id = $1', [a1])).rows[0].workflow_id).toBe(wf);
  });

  it('能力下没有流程：新建「主线」流程再挂；有多个流程：也挂进新建的主线，不替别的流程做主', async () => {
    const none = await capability(`t2a-${randomUUID()}`);
    const many = await capability(`t2b-${randomUUID()}`);
    await workflow(many, `t2b1_${randomUUID().slice(0, 8)}`); await workflow(many, `t2b2_${randomUUID().slice(0, 8)}`);
    const [x, y] = [await activity(none, 1), await activity(many, 1)];
    await client.query(SQL);
    for (const [cap, act] of [[none, x], [many, y]]) {
      const refs = await refsOf(act);
      expect(refs).toHaveLength(1);
      expect(refs[0].key).toBe(`gp_steps_${cap.slice(0, 8)}`);
    }
    expect((await client.query('SELECT count(*)::int AS n FROM workflows WHERE capability_id = $1', [many])).rows[0].n).toBe(3);
  });

  it('已有生效引用的 Activity 不动；已退役（deprecated）的不挂；重跑幂等', async () => {
    const cap = await capability(`t3-${randomUUID()}`);
    const wf = await workflow(cap, `t3_${randomUUID().slice(0, 8)}`);
    const attached = await activity(cap, 1);
    await client.query("INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no, source_ref) VALUES ($1, 'mine', $2, 7, 'other.cap')", [wf, attached]);
    const dead = await activity(cap, 2, 'deprecated');
    await activity(cap, 3);
    await client.query(SQL);
    expect(await refsOf(attached)).toEqual([expect.objectContaining({ slot_key: 'mine', sequence_no: 7, source_ref: 'other.cap' })]);
    expect(await refsOf(dead)).toEqual([]);
    const total = async () => (await client.query('SELECT count(*)::int AS n FROM workflow_activity_refs WHERE workflow_id IN (SELECT id FROM workflows WHERE capability_id = $1)', [cap])).rows[0].n;
    const once = await total();
    await client.query(SQL);
    expect(await total()).toBe(once);
  });
});
