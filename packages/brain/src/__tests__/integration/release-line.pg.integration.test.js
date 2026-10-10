/**
 * 发布线真 PG（决策 de6dff5d 第 3 步，迁移 541）：隔离 schema 内建最小表 + 跑真实迁移 538、541。
 * 锁：同内容两个 commit 只出一个版本；迁移后生产版 = current；冷启动 bootstrap；命中旧构建不拨回指针；
 * 受保护时影子模式照常前进 / 保护打开留作候选；晋级门被拒与通过后只换一格；接口变化须成组、成组原子；
 * 自动退回 advisory / on / 无目标去重；发布时把关开关；同步挂钩出错不拖垮同步。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import {
  registerActivityBuild, refreshWorkflowRecipe, runReleaseLineHook, everConverged, getPointer, releaseLineGapsForRelease, reconcileReleaseLine,
} from '../../lib/release-line.js';
import { promoteActivity, groupPromote } from '../../lib/release-line-gate.js';
import { onJudgmentRecorded, rollbackActivity } from '../../lib/release-line-rollback.js';
import { judgeActivity } from '../../lib/activity-judge.js';
import { compareActivityVersions } from '../../lib/activity-version-compare.js';

const M538 = readFileSync(new URL('../../../migrations/538_activity_judgments.sql', import.meta.url), 'utf8');
const M541 = readFileSync(new URL('../../../migrations/541_release_line.sql', import.meta.url), 'utf8');
let client, schema;
const SHA = n => String(n).padStart(40, 'a');
const quiet = { warn: vi.fn(), info: vi.fn() };

beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw new Error('仅允许scratch/CI隔离库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  schema = `rl_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE schema_version(version text PRIMARY KEY, description text, applied_at timestamptz DEFAULT now());
    CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, contract jsonb, current_definition_version_id uuid);
    CREATE TABLE workflows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capability_id uuid, current_definition_version_id uuid, created_at timestamptz DEFAULT now());
    CREATE TABLE workflow_activity_refs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid, activity_id uuid, slot_key text, sequence_no int,
      source_ref text, active boolean DEFAULT true);
    CREATE TABLE steps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid REFERENCES activities(id), step_order int, key text UNIQUE,
      readback jsonb NOT NULL DEFAULT '{}', active boolean DEFAULT true);
    CREATE TABLE activity_cells(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), journey_id uuid, step_id uuid, cell_kind text, cell_key text,
      cell_status text DEFAULT 'gray', parent_cell_key text);
    CREATE TABLE activity_definition_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES activities(id),
      payload jsonb NOT NULL, source_commit text, created_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE workflow_definition_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid REFERENCES workflows(id), payload jsonb NOT NULL,
      created_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE spans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id text, activity_id uuid, step_id uuid, enabler_id uuid, outcome text,
      evidence jsonb, attempts int DEFAULT 1, started_at timestamptz, activity_definition_version_id uuid, created_at timestamptz DEFAULT now());`);
  await client.query(M538);
});
afterEach(async () => { if (client) { await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {}); await client.end(); } });

const iface = (outputs = ['Lead']) => ({ inputs: [{ type: 'Device', fields: ['serial'], cardinality: 'one' }],
  outputs: outputs.map(t => ({ type: t, effect: 'create', fields: ['id'], cardinality: 'many' })) });
async function activity(name, contract = iface()) {
  return (await client.query('INSERT INTO activities(name,contract) VALUES($1,$2::jsonb) RETURNING id', [name, JSON.stringify(contract)])).rows[0].id;
}
async function step(a, key) {
  return (await client.query(`INSERT INTO steps(activity_id,step_order,key,readback) VALUES($1,1,$2,'{"type":"metric","expect":{"op":"==","value":1}}'::jsonb) RETURNING id`,
    [a, `${key}-${a}`])).rows[0].id;
}
/** 一个构建：内容 = contract + steps；implementation_bindings 带 commit（每个 commit 不同，内容哈希排除它）。 */
async function build(a, commit, { contract = iface(), stepId = null, note = 'v' } = {}) {
  const payload = { activity_id: a, contract: { ...contract, note }, implementation_bindings: [{ kind: 'code', revision: SHA(commit) }],
    steps: stepId ? [{ step_id: stepId, contract: { key: 's', readback: { type: 'metric', expect: { op: '==', value: 1 } } },
      registration: { id: stepId, key: 's', readback: { type: 'metric', expect: { op: '==', value: 1 } } } }] : [] };
  return (await client.query('INSERT INTO activity_definition_versions(activity_id,payload,source_commit) VALUES($1,$2::jsonb,$3) RETURNING id',
    [a, JSON.stringify(payload), SHA(commit)])).rows[0].id;
}
async function setCurrent(a, b) { await client.query('UPDATE activities SET current_definition_version_id=$2 WHERE id=$1', [a, b]); }
async function workflow(slots) {
  const w = (await client.query('INSERT INTO workflows DEFAULT VALUES RETURNING id')).rows[0].id;
  for (const [i, s] of slots.entries()) await client.query('INSERT INTO workflow_activity_refs(workflow_id,activity_id,slot_key,sequence_no) VALUES($1,$2,$3,$4)', [w, s.a, `slot${i}`, i + 1]);
  await workflowBuild(w, slots);
  return w;
}
async function workflowBuild(w, slots) {
  const payload = { workflow_id: w, activities: slots.map((s, i) => ({ reference_id: randomUUID(), slot_key: `slot${i}`, sequence_no: i + 1, activity_id: s.a, activity_version_id: s.b })) };
  const id = (await client.query('INSERT INTO workflow_definition_versions(workflow_id,payload) VALUES($1,$2::jsonb) RETURNING id', [w, JSON.stringify(payload)])).rows[0].id;
  await client.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1', [w, id]);
}
const versionOf = async b => (await client.query('SELECT activity_version_id v FROM activity_version_builds WHERE build_id=$1', [b])).rows[0]?.v;
const events = async a => (await client.query('SELECT kind, reason, from_version_id, to_version_id, gate FROM activity_release_events WHERE activity_id=$1 ORDER BY id', [a])).rows;
const pointerOf = async a => (await getPointer(client, a))?.production_version_id ?? null;
async function register(a, b, inserted = true, env = {}) {
  await client.query('BEGIN');
  const out = await registerActivityBuild(client, { activityId: a, buildId: b, inserted }, { env, alert: vi.fn() });
  await client.query('COMMIT');
  return out;
}
let tick = 0;
const at = () => new Date(Date.UTC(2026, 9, 10, 1, 0, tick++)).toISOString();
async function run(runId, a, stepId, b, observed = 1, outcome = 'pass') {
  await client.query('INSERT INTO spans(run_id,activity_id,step_id,outcome,evidence,started_at,activity_definition_version_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',
    [runId, a, stepId, outcome, JSON.stringify({ observed }), at(), b]);
}
/** 写一条纯净的 converged 裁判，让 b 所属版本受保护。 */
async function markConverged(a, b) {
  await client.query(`INSERT INTO activity_judgments(activity_id,activity_definition_version_id,verdict,converged,consecutive_green,required_green,runs_considered,trigger_kind,trigger_ref,report)
    VALUES($1,$2,'converged',true,5,5,5,'manual',null,$3::jsonb)`, [a, b, JSON.stringify({ window_version_ids: [b], window_unversioned_run_count: 0, runs: [] })]);
}

describe('迁移 541：初始生产版 = 今天正在用的版本', () => {
  it('同内容两个 commit 只出一个版本；指针 = current 的版本；initial 事件；初始配方；只追加', async () => {
    const a = await activity('搜索');
    const b1 = await build(a, 1), b2 = await build(a, 2), b3 = await build(a, 3, { note: 'changed' });
    await setCurrent(a, b2);
    const w = await workflow([{ a, b: b2 }]);
    await client.query(M541);
    expect((await client.query('SELECT version_no, first_build_id FROM activity_versions WHERE activity_id=$1 ORDER BY version_no', [a])).rows)
      .toEqual([{ version_no: 1, first_build_id: b1 }, { version_no: 2, first_build_id: b3 }]);
    expect(await versionOf(b1)).toBe(await versionOf(b2));
    expect(await pointerOf(a)).toBe(await versionOf(b2));
    expect(await events(a)).toEqual([expect.objectContaining({ kind: 'initial', reason: 'initial_migration_current_definition' })]);
    const recipe = (await client.query('SELECT recipe FROM workflow_production_recipes WHERE workflow_id=$1', [w])).rows;
    expect(recipe).toHaveLength(1);
    expect(recipe[0].recipe[0]).toMatchObject({ slot_key: 'slot0', activity_id: a, activity_version_id: await versionOf(b2) });
    await expect(client.query('UPDATE activity_versions SET version_no=9')).rejects.toThrow(/只追加/);
    await expect(client.query('DELETE FROM activity_release_events')).rejects.toThrow(/只追加/);
    expect((await client.query("SELECT 1 FROM schema_version WHERE version='541'")).rows).toHaveLength(1);
    // 晋级门的收敛裁判可落库
    await client.query(`INSERT INTO activity_judgments(activity_id,verdict,converged,consecutive_green,required_green,runs_considered,trigger_kind,report)
      VALUES($1,'no_data',false,0,5,0,'promotion_gate','{}'::jsonb)`, [a]);
  });
});

describe('冷启动与同步挂钩', () => {
  beforeEach(async () => { await client.query(M541); });

  it('从未收敛 → 新内容直接 bootstrap；同内容新 commit 不动；命中已存在旧构建不拨回', async () => {
    const a = await activity('预检');
    const b1 = await build(a, 1);
    expect(await register(a, b1)).toMatchObject({ action: 'initial' });
    const b2 = await build(a, 2);
    expect(await register(a, b2)).toMatchObject({ action: 'unchanged' });
    const b3 = await build(a, 3, { note: 'new' });
    expect(await register(a, b3)).toMatchObject({ action: 'bootstrap' });
    expect(await pointerOf(a)).toBe(await versionOf(b3));
    expect((await events(a)).at(-1)).toMatchObject({ kind: 'bootstrap', reason: 'bootstrap_no_converged_baseline' });
    expect((await events(a)).at(-1).gate.converged).toBe(false);
    expect(await register(a, b1, false)).toMatchObject({ action: 'existing_build_no_move' });
    expect(await pointerOf(a)).toBe(await versionOf(b3));
    expect(await everConverged(client, a, await versionOf(b3))).toBe(false);
  });

  it('受保护 + 保护开关默认关（影子模式）→ 记 promote_would_reject，指针照常前进；保护打开 → 留作候选并去重', async () => {
    const a = await activity('评分');
    const b1 = await build(a, 1); await register(a, b1); await markConverged(a, b1);
    expect(await everConverged(client, a, await versionOf(b1))).toBe(true);
    const b2 = await build(a, 2, { note: 'v2' });
    expect(await register(a, b2)).toMatchObject({ action: 'shadow_advance' });
    expect(await pointerOf(a)).toBe(await versionOf(b2));
    expect((await events(a)).map(e => e.kind)).toEqual(['initial', 'promote_would_reject', 'bootstrap']);

    const c = await activity('触达');
    const c1 = await build(c, 1); await register(c, c1); await markConverged(c, c1);
    const c2 = await build(c, 2, { note: 'v2' });
    expect(await register(c, c2, true, { RELEASE_LINE_PROTECT: 'on' })).toMatchObject({ action: 'candidate_held' });
    expect(await pointerOf(c)).toBe(await versionOf(c1));
    const c3 = await build(c, 3, { note: 'v2' });
    expect(await register(c, c3, true, { RELEASE_LINE_PROTECT: 'on' })).toMatchObject({ action: 'candidate_held', event_id: null });
    expect((await events(c)).filter(e => e.kind === 'candidate_held')).toHaveLength(1);
  });

  it('同步挂钩出错 → 回滚到 savepoint、P2 告警、外层事务照常提交；开关 off 完全不碰', async () => {
    const a = await activity('挂钩');
    const alert = vi.fn();
    await client.query('BEGIN');
    await client.query("UPDATE activities SET name='同步写入' WHERE id=$1", [a]);
    const out = await runReleaseLineHook(client, 'register_build', async db => { await db.query('SELECT * FROM no_such_table'); }, { alert, log: quiet });
    await client.query("UPDATE activities SET name='同步继续' WHERE id=$1", [a]);
    await client.query('COMMIT');
    expect(out.error).toMatch(/no_such_table/);
    expect((await client.query('SELECT name FROM activities WHERE id=$1', [a])).rows[0].name).toBe('同步继续');
    await new Promise(r => setTimeout(r, 5));
    expect(alert).toHaveBeenCalledWith('P2', 'release_line_sync_hook_failed', expect.stringContaining('register_build'));
    const fn = vi.fn();
    expect(await runReleaseLineHook(client, 'x', fn, { env: { RELEASE_LINE_SYNC_HOOK: 'off' } })).toEqual({ skipped: 'disabled' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('幂等补账：挂钩漏掉的构建补映射，缺指针的补 initial，已有指针不动', async () => {
    const a = await activity('补账');
    const b1 = await build(a, 1); await setCurrent(a, b1);
    const r = await reconcileReleaseLine({ connect: async () => Object.assign(client, { release: () => {} }) });
    delete client.release;
    expect(r).toMatchObject({ builds_mapped: 1, pointers_created: 1 });
    expect(await pointerOf(a)).toBe(await versionOf(b1));
  });
});

describe('晋级门 / 成组晋级', () => {
  beforeEach(async () => { await client.query(M541); });

  it('受保护：候选没有样本 → 409 GATE_FAILED + promote_rejected；候选连续 5 绿且不差 → 201，配方只换这一格', async () => {
    const a = await activity('取源'), other = await activity('收尾', iface(['Run']));
    const s = await step(a, 's');
    const b1 = await build(a, 1, { stepId: s }); await register(a, b1);
    const o1 = await build(other, 1); await register(other, o1);
    const w = await workflow([{ a, b: b1 }, { a: other, b: o1 }]);
    await client.query('BEGIN'); await refreshWorkflowRecipe(client, w); await client.query('COMMIT');
    for (let i = 0; i < 6; i++) await run(`base${i}`, a, s, b1);
    await markConverged(a, b1);
    const b2 = await build(a, 2, { stepId: s, note: 'v2' });
    await register(a, b2, true, { RELEASE_LINE_PROTECT: 'on' });
    const cand = await versionOf(b2);
    const rejected = await promoteActivity(client, a, { candidate_version_id: cand, actor: 'tester' });
    expect(rejected).toMatchObject({ status: 409, code: 'GATE_FAILED' });
    expect((await events(a)).at(-1)).toMatchObject({ kind: 'promote_rejected' });
    expect(await pointerOf(a)).toBe(await versionOf(b1));

    for (let i = 0; i < 6; i++) await run(`cand${i}`, a, s, b2);
    const ok = await promoteActivity(client, a, { candidate_version_id: cand, actor: 'tester' });
    expect(ok).toMatchObject({ status: 201, outcome: 'gate_passed' });
    expect(ok.event.gate.converged).toBe(true);
    expect(await pointerOf(a)).toBe(cand);
    const gate = (await client.query("SELECT trigger_kind, converged FROM activity_judgments WHERE trigger_kind='promotion_gate' ORDER BY id")).rows;
    expect(gate.at(-1)).toEqual({ trigger_kind: 'promotion_gate', converged: true });
    const recipes = (await client.query('SELECT recipe FROM workflow_production_recipes WHERE workflow_id=$1 ORDER BY id', [w])).rows;
    const [before, after] = [recipes.at(-2).recipe, recipes.at(-1).recipe];
    expect(after[0].activity_version_id).toBe(cand);
    expect(after[1]).toEqual(before[1]);
    expect(await everConverged(client, a, cand)).toBe(true);
  });

  it('生产版未收敛 → 手动晋级直接 bootstrap（不要 N 绿）；force 必须带 reason', async () => {
    const a = await activity('判定');
    const b1 = await build(a, 1); await register(a, b1);
    const b2 = await build(a, 2, { note: 'x' });
    await register(a, b2, false);
    const cand = await versionOf(b2);
    await expect(promoteActivity(client, a, { candidate_version_id: cand, actor: 't', force: true })).rejects.toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
    const out = await promoteActivity(client, a, { candidate_version_id: cand, actor: 't' });
    expect(out).toMatchObject({ status: 201, outcome: 'bootstrap' });
    expect(out.event).toMatchObject({ kind: 'bootstrap', reason: 'bootstrap_no_converged_baseline' });
  });

  it('接口变化且受保护 → 单个晋级 409 INTERFACE_CHANGED；成组里有成员不过门 → 一个指针都不动', async () => {
    const up = await activity('上游', iface(['Lead'])), down = await activity('下游', { inputs: [{ type: 'Lead', fields: ['id'] }], outputs: [] });
    const u1 = await build(up, 1, { contract: iface(['Lead']) }); await register(up, u1); await markConverged(up, u1);
    const d1 = await build(down, 1, { contract: { inputs: [{ type: 'Lead', fields: ['id'] }], outputs: [] } }); await register(down, d1); await markConverged(down, d1);
    await workflow([{ a: up, b: u1 }, { a: down, b: d1 }]);
    const u2 = await build(up, 2, { contract: { inputs: iface().inputs, outputs: [{ type: 'Lead', effect: 'create', fields: ['id', 'score'], cardinality: 'many' }] } });
    await register(up, u2, true, { RELEASE_LINE_PROTECT: 'on' });
    const d2 = await build(down, 2, { contract: { inputs: [{ type: 'Lead', fields: ['id', 'score'] }], outputs: [] } });
    await register(down, d2, true, { RELEASE_LINE_PROTECT: 'on' });
    await expect(promoteActivity(client, up, { candidate_version_id: await versionOf(u2), actor: 't' })).rejects.toMatchObject({ status: 409, code: 'INTERFACE_CHANGED' });
    const out = await groupPromote(client, { actor: 't', members: [
      { activity_id: up, candidate_version_id: await versionOf(u2) }, { activity_id: down, candidate_version_id: await versionOf(d2) }] });
    expect(out).toMatchObject({ status: 409, code: 'GATE_FAILED' });
    expect(await pointerOf(up)).toBe(await versionOf(u1));
    expect(await pointerOf(down)).toBe(await versionOf(d1));
    const forced = await groupPromote(client, { actor: 't', force: true, reason: '主理人拍板', members: [
      { activity_id: up, candidate_version_id: await versionOf(u2) }, { activity_id: down, candidate_version_id: await versionOf(d2) }] });
    expect(forced.status).toBe(201);
    expect(await pointerOf(up)).toBe(await versionOf(u2));
    expect(await pointerOf(down)).toBe(await versionOf(d2));
    const kinds = (await client.query('SELECT DISTINCT group_id FROM activity_release_events WHERE kind=$1', ['group_promote'])).rows;
    expect(kinds).toHaveLength(1);
  });

  it('按内容对比：同内容不同 commit 的样本合并；候选与基线内容相同 → 400', async () => {
    const a = await activity('对比');
    const s = await step(a, 's');
    const b1 = await build(a, 1, { stepId: s }), b2 = await build(a, 2, { stepId: s });
    await register(a, b1); await register(a, b2);
    for (let i = 0; i < 3; i++) await run(`x${i}`, a, s, b1);
    for (let i = 0; i < 3; i++) await run(`y${i}`, a, s, b2);
    const b3 = await build(a, 3, { stepId: s, note: 'v2' }); await register(a, b3);
    const res = await compareActivityVersions(client, a, { candidateVersionId: b3, baselineVersionId: b1 });
    expect(res.mode).toBe('content_version');
    expect(res.baseline.runs).toBe(6);
    await expect(compareActivityVersions(client, a, { candidateVersionId: b2, baselineVersionId: b1 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('自动退回 / 手动退回', () => {
  beforeEach(async () => { await client.query(M541); });

  async function failingRuns(a, s, b, n) {
    for (let i = 0; i < n; i++) {
      await run(`f${b}${i}`, a, s, b, 0);
      await judgeActivity(client, a, { trigger: 'auto', triggerRef: `f${b}${i}`, runIdleMs: 0, onRecorded: async () => {}, applyCell: async () => {} });
    }
  }

  it('无可退目标 → rollback_unavailable 只记一次（去重），未收敛生产版不告警', async () => {
    const a = await activity('退回');
    const s = await step(a, 's');
    const b1 = await build(a, 1, { stepId: s }); await register(a, b1);
    await failingRuns(a, s, b1, 3);
    const alert = vi.fn(), bark = vi.fn();
    const r1 = await onJudgmentRecorded(client, a, {}, { alert, bark, log: quiet });
    const r2 = await onJudgmentRecorded(client, a, {}, { alert, bark, log: quiet });
    expect(r1).toMatchObject({ action: 'rollback_unavailable' });
    expect(r2).toMatchObject({ action: 'deduped' });
    expect((await events(a)).filter(e => e.kind === 'rollback_unavailable')).toHaveLength(1);
    await new Promise(r => setTimeout(r, 5));
    expect(alert).not.toHaveBeenCalled();
    expect(bark).not.toHaveBeenCalled();
  });

  it('有曾收敛的历史生产版：advisory（默认）只记事件不改指针；on → 退回 + 重算配方 + P0 + Bark', async () => {
    const a = await activity('退回2');
    const s = await step(a, 's');
    const b1 = await build(a, 1, { stepId: s }); await register(a, b1); await markConverged(a, b1);
    const w = await workflow([{ a, b: b1 }]);
    const b2 = await build(a, 2, { stepId: s, note: 'bad' }); await register(a, b2);
    await workflowBuild(w, [{ a, b: b2 }]);
    await failingRuns(a, s, b2, 3);
    const alert = vi.fn(), bark = vi.fn();
    expect(await onJudgmentRecorded(client, a, {}, { alert, bark, log: quiet })).toMatchObject({ action: 'rollback_advisory' });
    expect(await pointerOf(a)).toBe(await versionOf(b2));
    const out = await onJudgmentRecorded(client, a, {}, { env: { RELEASE_LINE_AUTO_ROLLBACK: 'on' }, alert, bark, log: quiet });
    expect(out).toMatchObject({ action: 'rollback_auto', to_version_id: await versionOf(b1) });
    expect(await pointerOf(a)).toBe(await versionOf(b1));
    const recipe = (await client.query('SELECT recipe, cause FROM workflow_production_recipes WHERE workflow_id=$1 ORDER BY id DESC LIMIT 1', [w])).rows[0];
    expect(recipe.cause).toBe('rollback_auto');
    expect(recipe.recipe[0].activity_version_id).toBe(await versionOf(b1));
    await new Promise(r => setTimeout(r, 5));
    expect(alert).toHaveBeenCalledWith('P0', `activity_production_rollback:${a}`, expect.any(String));
    expect(bark).toHaveBeenCalledTimes(1);
    // 手动退回到曾当过生产版的 v2（未收敛 → 标记）
    const manual = await rollbackActivity(client, a, { actor: 'ops', reason: '复核', to_version_id: await versionOf(b2) });
    expect(manual.manual_target_unconverged).toBe(true);
    expect(await pointerOf(a)).toBe(await versionOf(b2));
  });

  it('退回评估出错 → 不抛，返回 error', async () => {
    const r = await onJudgmentRecorded({ query: async () => { throw new Error('db down'); } }, randomUUID(), {}, { log: quiet });
    expect(r).toMatchObject({ action: 'error' });
  });
});

describe('发布时把关', () => {
  beforeEach(async () => { await client.query(M541); });

  it('开关默认关 → 零查询无缺口；打开 → 只对受保护的生产版记 activity_version_not_production', async () => {
    const a = await activity('把关'), fresh = await activity('冷启动');
    const b1 = await build(a, 1); await register(a, b1); await markConverged(a, b1);
    const b2 = await build(a, 2, { note: 'cand' }); await register(a, b2, true, { RELEASE_LINE_PROTECT: 'on' });
    const f1 = await build(fresh, 1); await register(fresh, f1);
    const f2 = await build(fresh, 2, { note: 'n' }); await register(fresh, f2, false);
    const builds = [{ id: b2, activity_id: a }, { id: f2, activity_id: fresh }];
    const spy = { query: vi.fn() };
    expect(await releaseLineGapsForRelease(spy, 'production', builds)).toEqual([]);
    expect(spy.query).not.toHaveBeenCalled();
    await client.query('BEGIN');
    const gaps = await releaseLineGapsForRelease(client, 'production', builds, { env: { RELEASE_LINE_ENFORCE_RELEASE: 'on' } });
    expect(await releaseLineGapsForRelease(client, 'staging', builds, { env: { RELEASE_LINE_ENFORCE_RELEASE: 'on' } })).toEqual([]);
    await client.query('COMMIT');
    expect(gaps).toEqual([expect.objectContaining({ code: 'activity_version_not_production', activity_id: a })]);
  });
});
