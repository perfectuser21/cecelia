/**
 * activity_placement（v3.0 第 5 刀②）：Activity 在树里的位置由流程引用推出，不再靠 activities 上的直挂列。
 * 一个 Activity 可被多个流程共用：定义归属（引用的 source_ref 为空）那条优先，其余按流程创建先后。
 * 真库事务里造数据，断言后整体回滚。
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';

let client;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw new Error('仅允许scratch/CI隔离库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  await client.query('BEGIN');
});
afterEach(async () => { await client.query('ROLLBACK'); await client.end(); });

async function capability(name) {
  const vs = (await client.query("INSERT INTO journeys (name, description) VALUES ($1, 'v') RETURNING id", [`${name}-价值流`])).rows[0].id;
  const cap = randomUUID();
  await client.query("INSERT INTO journeys (id, name, parent_journey_id, description) VALUES ($1, $2, $3, 'c')", [cap, name, vs]);
  return cap;
}
const workflow = async (cap, key) => (await client.query("INSERT INTO workflows (capability_id, key, name, channel) VALUES ($1, $2, $2, 'internal') RETURNING id", [cap, key])).rows[0].id;
const activity = async (cap, n) => (await client.query("INSERT INTO activities (journey_id, name, step_number) VALUES ($1, $2, $3) RETURNING id", [cap, `步骤${n}`, n])).rows[0].id;
const ref = (wf, slot, act, seq, sourceRef = null, active = true) => client.query(
  'INSERT INTO workflow_activity_refs (workflow_id, slot_key, activity_id, sequence_no, source_ref, active) VALUES ($1,$2,$3,$4,$5,$6)', [wf, slot, act, seq, sourceRef, active]);
const place = async act => (await client.query('SELECT * FROM activity_placement WHERE activity_id = $1', [act])).rows;

describe('activity_placement 视图', () => {
  it('单个引用：能力、流程、顺序、槽位都从引用推出', async () => {
    const cap = await capability(`p1-${randomUUID()}`);
    const wf = await workflow(cap, `p1_${randomUUID().slice(0, 8)}`);
    const act = await activity(cap, 1);
    await ref(wf, 'first', act, 3);
    expect(await place(act)).toEqual([expect.objectContaining({ activity_id: act, capability_id: cap, workflow_id: wf, step_number: 3, slot_key: 'first', is_owner: true })]);
  });

  it('被两个流程共用：定义归属的那条优先，每个 Activity 只出一行', async () => {
    const owner = await capability(`p2a-${randomUUID()}`);
    const other = await capability(`p2b-${randomUUID()}`);
    const [wfOwner, wfOther] = [await workflow(owner, `p2a_${randomUUID().slice(0, 8)}`), await workflow(other, `p2b_${randomUUID().slice(0, 8)}`)];
    const act = await activity(owner, 1);
    await ref(wfOther, 'borrowed', act, 5, 'owner.preflight');
    await ref(wfOwner, 'own', act, 2, null);
    const rows = await place(act);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capability_id: owner, workflow_id: wfOwner, step_number: 2, is_owner: true });
  });

  it('只有借用引用（没有归属那条）也能定位，is_owner=false；已停用的引用、没有引用的 Activity 不出现', async () => {
    const cap = await capability(`p3-${randomUUID()}`);
    const wf = await workflow(cap, `p3_${randomUUID().slice(0, 8)}`);
    const [borrowed, stale, none] = [await activity(cap, 1), await activity(cap, 2), await activity(cap, 3)];
    await ref(wf, 'b', borrowed, 1, 'x.y');
    await ref(wf, 's', stale, 2, null, false);
    expect(await place(borrowed)).toEqual([expect.objectContaining({ is_owner: false, capability_id: cap })]);
    expect(await place(stale)).toEqual([]);
    expect(await place(none)).toEqual([]);
  });
});
