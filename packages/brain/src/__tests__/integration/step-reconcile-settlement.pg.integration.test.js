import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { reconcileActivity } from '../../lib/step-reconcile.js';
import { registerCandidate, draftFromSpans, CELL_KEYS } from '../../lib/skill-settlement.js';

let client, schema;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw new Error('仅允许scratch/CI隔离库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  schema = `settle_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text, status text,
      capability_key text, activity_key text, executor_kind text, inputs jsonb, outputs jsonb, failure jsonb, promise text, backbone_version text);
    CREATE TABLE workflows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capability_id uuid NOT NULL, key text NOT NULL, name text, channel text, version text, status text, created_at timestamptz DEFAULT now());
    CREATE TABLE workflow_activity_refs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid NOT NULL REFERENCES workflows(id), slot_key text NOT NULL, activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      sequence_no int NOT NULL, source_ref text, active boolean NOT NULL DEFAULT true, UNIQUE(workflow_id, slot_key));
    CREATE TABLE steps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid REFERENCES activities(id) ON DELETE CASCADE, step_order int,
      key text UNIQUE, activity_key text, mode text DEFAULT 'checkpoint', readback jsonb NOT NULL DEFAULT '{}', source_sha256 text, active boolean DEFAULT true,
      name text, action text, inputs jsonb, outputs jsonb, on_fail text);
    CREATE TABLE activity_cells(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), journey_id uuid NOT NULL, step_id uuid NOT NULL, cell_kind text, cell_key text,
      cell_status text DEFAULT 'gray', cell_level text NOT NULL DEFAULT 'activity', parent_cell_key text, status text DEFAULT 'planned',
      updated_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX uq_cell ON activity_cells(step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL;
    CREATE TABLE spans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id text, activity_id uuid, step_id uuid, outcome text, evidence jsonb,
      attempts int DEFAULT 1, started_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE pending_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_type text, params jsonb, context jsonb, status text, expires_at timestamp,
      category text, priority text, source text, signature text, options jsonb, comments jsonb);`);
});
afterEach(async () => { if (client) { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } });

const journey = randomUUID();
async function seedActivity() {
  const a = randomUUID();
  await client.query("INSERT INTO activities(id,name,status,capability_key,activity_key) VALUES($1,'搜索','planned','c','search')", [a]);
  const mk = async (key, readback, order) => (await client.query(
    "INSERT INTO steps(activity_id,step_order,key,activity_key,readback) VALUES($1,$2,$3,'search',$4::jsonb) RETURNING id", [a, order, key, JSON.stringify(readback)])).rows[0].id;
  const s1 = await mk('c.search.open', { type: 'metric', ref: 'metrics.open', expect: { op: '==', value: 1 } }, 1);
  const s2 = await mk('c.search.save', { type: 'metric', ref: 'metrics.rows', expect: { op: '>=', value: 1 } }, 2);
  for (const key of CELL_KEYS) await client.query("INSERT INTO activity_cells(journey_id,step_id,cell_kind,cell_key) VALUES($1,$2,'element',$3)", [journey, a, key]);
  return { a, s1, s2 };
}
let tick = 0;
async function span(run, a, step, observed, outcome = 'pass') {
  await client.query('INSERT INTO spans(run_id,activity_id,step_id,outcome,evidence,started_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
    [run, a, step, outcome, JSON.stringify({ observed }), new Date(Date.UTC(2026, 9, 5, 0, 0, tick++)).toISOString()]);
}
const readbackCell = async a => (await client.query("SELECT cell_status FROM activity_cells WHERE step_id=$1 AND cell_key='readback'", [a])).rows[0].cell_status;

describe('收敛对账（真 PG）', () => {
  it('连续绿达标 → 收敛，readback 格翻绿；出现对不上 → 翻红；没数据不动', async () => {
    const { a, s1, s2 } = await seedActivity();
    expect((await reconcileActivity(client, a, { runsWanted: 5, requiredGreen: 2 })).verdict).toBe('no_data');
    expect(await readbackCell(a)).toBe('gray');

    for (const run of ['r1', 'r2']) { await span(run, a, s1, 1); await span(run, a, s2, 5); }
    const ok = await reconcileActivity(client, a, { runsWanted: 5, requiredGreen: 2 });
    expect(ok).toMatchObject({ verdict: 'converged', converged: true, consecutive_green: 2 });
    expect(await readbackCell(a)).toBe('green');

    await span('r3', a, s1, 0); await span('r3', a, s2, 5);
    const bad = await reconcileActivity(client, a, { runsWanted: 5, requiredGreen: 2 });
    expect(bad.verdict).toBe('diverged');
    expect(bad.issues[0]).toMatchObject({ code: 'step_readback_mismatch', step_key: 'c.search.open', run_id: 'r3' });
    expect(await readbackCell(a)).toBe('red');
  });

  it('收敛中（绿次数不够）→ 格子待判；没声明的 Step 的 span 被抓出来', async () => {
    const { a, s1, s2 } = await seedActivity();
    await span('r1', a, s1, 1); await span('r1', a, s2, 5);
    expect((await reconcileActivity(client, a, { runsWanted: 5, requiredGreen: 3 })).verdict).toBe('converging');
    expect(await readbackCell(a)).toBe('pending');
    await span('r2', a, s1, 1); await span('r2', a, s2, 5); await span('r2', a, randomUUID(), 1);
    const r = await reconcileActivity(client, a, { runsWanted: 5, requiredGreen: 3 });
    expect(r.issues.some(i => i.code === 'undeclared_step')).toBe(true);
  });

  it('readback 格还不存在（合同同步新建的 Activity 没有格子）：对账时先补齐固定 8 格再翻色，不静默丢颜色', async () => {
    const { a, s1, s2 } = await seedActivity();
    await client.query('DELETE FROM activity_cells WHERE step_id = $1', [a]);
    // 能力由流程引用推出（迁移 528）：合同同步新建的 Activity 都有引用
    const wf = (await client.query("INSERT INTO workflows(capability_id,key,name) VALUES($1,'wf','wf') RETURNING id", [journey])).rows[0].id;
    await client.query("INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no) VALUES($1,'s1',$2,1)", [wf, a]);
    await span('r1', a, s1, 1); await span('r1', a, s2, 5);
    await reconcileActivity(client, a, { runsWanted: 5, requiredGreen: 1 });
    const cells = (await client.query("SELECT cell_key, cell_status FROM activity_cells WHERE step_id=$1 ORDER BY cell_key", [a])).rows;
    expect(cells).toHaveLength(8);
    expect(cells.find(c => c.cell_key === 'readback').cell_status).toBe('green');
    expect(cells.filter(c => c.cell_key !== 'readback').every(c => c.cell_status === 'gray')).toBe(true);
  });

  it('活动不存在 → 抛错', async () => {
    await expect(reconcileActivity(client, randomUUID(), {})).rejects.toThrow(/activity_not_found/);
  });
});

describe('沉淀技能登记候选（真 PG）', () => {
  const mkSpans = () => ['r1', 'r2'].flatMap((run, i) => ['open', 'save'].map((key, j) => ({
    run_id: run, outcome: 'pass', executor_kind: 'agent', attempts: 1, started_at: new Date(Date.UTC(2026, 9, 5, 0, i, j)).toISOString(),
    evidence: { step_key: key, name: key, action: `做${key}`, reads: [], writes: [], observed: 1 },
  })));
  const draft = () => draftFromSpans({ skill: { name: '新技能', promise_draft: '把事做成。' }, spans: mkSpans(), capabilityKey: 'leadgen', activityKey: 'new_skill' });

  it('登记为 candidate：Activity + Steps + 固定 8 个灰格 + 一条待拍板；承诺列保持空', async () => {
    const r = await registerCandidate(client, { draft: draft(), journeyId: journey, skillName: '新技能' });
    expect(r).toMatchObject({ created: true, steps: 2 });
    const act = (await client.query('SELECT status, promise, description, executor_kind FROM activities WHERE id=$1', [r.id])).rows[0];
    expect(act).toMatchObject({ status: 'candidate', promise: null, executor_kind: 'agent' });
    expect(act.description).toContain('把事做成。');
    const steps = (await client.query('SELECT key, step_order, action, on_fail FROM steps WHERE activity_id=$1 ORDER BY step_order', [r.id])).rows;
    expect(steps.map(s => s.key)).toEqual(['leadgen.new_skill.open', 'leadgen.new_skill.save']);
    const cells = (await client.query("SELECT cell_key, cell_status FROM activity_cells WHERE step_id=$1 ORDER BY cell_key", [r.id])).rows;
    expect(cells).toHaveLength(8);
    expect(cells.every(c => c.cell_status === 'gray')).toBe(true);
    // 位置不写在 Activity 上：经能力的主线流程挂靠，顺序在流程引用里（迁移 528 删了 journey_id / step_number）
    const refs = (await client.query("SELECT w.capability_id, w.key, r.sequence_no, r.source_ref, r.active FROM workflow_activity_refs r JOIN workflows w ON w.id=r.workflow_id WHERE r.activity_id=$1", [r.id])).rows;
    expect(refs).toEqual([{ capability_id: journey, key: `gp_steps_${journey.slice(0, 8)}`, sequence_no: 1, source_ref: null, active: true }]);
    const pending = (await client.query("SELECT action_type, status, signature, context FROM pending_actions WHERE signature=$1", [`activity-candidate:${r.id}`])).rows;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ action_type: 'owner_decision', status: 'pending_approval' });
  });

  it('同一能力再登记另一个候选：进同一条主线流程，顺序接在后面', async () => {
    const first = await registerCandidate(client, { draft: draft(), journeyId: journey, skillName: '新技能' });
    const other = draftFromSpans({ skill: { name: '另一个', promise_draft: '再做一件。' }, spans: mkSpans(), capabilityKey: 'leadgen', activityKey: 'other_skill' });
    const second = await registerCandidate(client, { draft: other, journeyId: journey, skillName: '另一个' });
    const rows = (await client.query('SELECT r.activity_id, r.sequence_no, r.workflow_id FROM workflow_activity_refs r ORDER BY r.sequence_no')).rows;
    expect(rows.map(r => [r.activity_id, r.sequence_no])).toEqual([[first.id, 1], [second.id, 2]]);
    expect(new Set(rows.map(r => r.workflow_id)).size).toBe(1);
  });

  it('重复登记同一 Activity：不覆盖、不重复建，返回已有', async () => {
    const first = await registerCandidate(client, { draft: draft(), journeyId: journey, skillName: '新技能' });
    const again = await registerCandidate(client, { draft: draft(), journeyId: journey, skillName: '新技能' });
    expect(again).toMatchObject({ created: false, existing: true, id: first.id });
    expect((await client.query('SELECT count(*)::int AS n FROM activities')).rows[0].n).toBe(1);
    expect((await client.query('SELECT count(*)::int AS n FROM pending_actions')).rows[0].n).toBe(1);
  });
});
