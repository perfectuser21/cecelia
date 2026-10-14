/**
 * 裁判接线真 PG（五块模型·裁判，决策 de6dff5d）：隔离 schema 内建最小表 + 跑真实迁移 538。
 * 锁：自动裁判经 span → Step → Activity 找到归属并落库、只追加、最新裁判可查、新旧版本对比读真 spans。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { judgeActivity, flushJudgments, getLatestJudgment, listJudgments } from '../../lib/activity-judge.js';
import { compareActivityVersions } from '../../lib/activity-version-compare.js';

const MIGRATION = readFileSync(new URL('../../../migrations/538_activity_judgments.sql', import.meta.url), 'utf8');
let client, schema;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw new Error('仅允许scratch/CI隔离库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  schema = `judge_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
  await client.query(`
    CREATE TABLE schema_version(version text PRIMARY KEY, description text, applied_at timestamptz DEFAULT now());
    CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, current_definition_version_id uuid);
    CREATE TABLE value_streams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
    CREATE TABLE capabilities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, parent_journey_id uuid REFERENCES value_streams(id));
    CREATE TABLE workflows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capability_id uuid, key text, name text, channel text, created_at timestamptz DEFAULT now());
    CREATE TABLE workflow_definition_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid REFERENCES workflows(id),
      payload jsonb, contract_sha256 text, payload_sha256 text, source_repo text, source_path text, source_commit text, UNIQUE(workflow_id,id));
    CREATE TABLE task_runs(id uuid PRIMARY KEY);
    CREATE TABLE workflow_activity_refs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid, activity_id uuid, source_ref text, active boolean DEFAULT true);
    CREATE TABLE steps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid REFERENCES activities(id), step_order int, key text UNIQUE,
      activity_key text, readback jsonb NOT NULL DEFAULT '{}', active boolean DEFAULT true);
    CREATE TABLE activity_cells(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), journey_id uuid, step_id uuid, cell_kind text, cell_key text,
      cell_status text DEFAULT 'gray', parent_cell_key text);
    CREATE TABLE activity_definition_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES activities(id),
      payload jsonb NOT NULL, contract_sha256 text, payload_sha256 text, source_repo text, source_path text, source_commit text, created_at timestamptz DEFAULT now());
    CREATE TABLE spans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id text, activity_id uuid, step_id uuid, enabler_id uuid, outcome text,
      evidence jsonb, attempts int DEFAULT 1, started_at timestamptz, activity_definition_version_id uuid, created_at timestamptz DEFAULT now(),
      identity_protocol int DEFAULT 1, run_binding_id uuid, ended_at timestamptz, executor_kind text, workflow_id uuid,
      workflow_definition_version_id uuid, reference_id text, attempt_key text, occurrence_key text, payload_sha256 text);
    CREATE TABLE tasks(id uuid PRIMARY KEY, title text, status text, task_type text, payload jsonb, result jsonb);
    CREATE UNIQUE INDEX ON activity_cells(step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL;`);
  await client.query(readFileSync(new URL('../../../migrations/515_release_definition_evidence.sql', import.meta.url), 'utf8'));
  await client.query(MIGRATION);
});
afterEach(async () => { if (client) { await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } });

let tick = 0;
const ts = () => new Date(Date.UTC(2026, 9, 10, 0, 0, tick++)).toISOString();
async function seed() {
  const a = (await client.query("INSERT INTO activities(name) VALUES('搜索') RETURNING id")).rows[0].id;
  const mk = async (key, readback, order) => (await client.query(
    'INSERT INTO steps(activity_id,step_order,key,readback) VALUES($1,$2,$3,$4::jsonb) RETURNING id', [a, order, `${key}-${a}`, JSON.stringify(readback)])).rows[0].id;
  const s1 = await mk('open', { type: 'metric', expect: { op: '==', value: 1 } }, 1);
  const s2 = await mk('save', { type: 'metric', expect: { op: '>=', value: 1 } }, 2);
  const ver = async () => (await client.query('INSERT INTO activity_definition_versions(activity_id,payload) VALUES($1,$2::jsonb) RETURNING id',
    [a, JSON.stringify({ activity_id: a, contract: {} })])).rows[0].id;
  return { a, s1, s2, v1: await ver(), v2: await ver() };
}
async function span(run, { a = null, step, observed, outcome = 'pass', version = null, at = null }) {
  return (await client.query(
    'INSERT INTO spans(run_id,activity_id,step_id,outcome,evidence,started_at,activity_definition_version_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id',
    [run, a, step, outcome, JSON.stringify(observed === undefined ? {} : { observed }), at ?? ts(), version])).rows[0].id;
}

// 执行现行 Smoke 的原始 Node 段；仅连接到本用例隔离 schema，不替换任何裁判或查询。
async function runSmokeBody() {
  const shell = readFileSync(new URL('../../../scripts/smoke/activity-judgments-smoke.sh', import.meta.url), 'utf8');
  const body = shell.split("<<'NODE'\n")[1]?.split('\nNODE\n')[0];
  if (!body) throw new Error('smoke Node body missing');
  const database = new URL('postgresql://localhost');
  database.username = DB_DEFAULTS.user; database.password = DB_DEFAULTS.password ?? '';
  database.hostname = DB_DEFAULTS.host; database.port = String(DB_DEFAULTS.port);
  database.pathname = `/${DB_DEFAULTS.database}`;
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module'], {
      cwd: new URL('../../../', import.meta.url),
      env: { ...process.env, DATABASE_URL: database.href, PGOPTIONS: `-c search_path=${schema}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
    child.on('error', reject); child.on('close', code => resolve({ code, output })); child.stdin.end(body);
  });
}

describe('现行 Smoke 的真实裁判合同', () => {
  it('legacy 单 run 仅诊断；正式冻结两次独立通过可收敛；错环境不能借绿', async () => {
    const actual = await runSmokeBody();
    expect(actual.code, actual.output).toBe(0);
    for (const marker of ['旧协议仅诊断：连续绿 1、不晋级', '冻结范围：连续绿 2、正式独立核验通过', '错环境范围：连续绿 1、不晋级']) {
      expect(actual.output).toContain(`PASS: ${marker}`);
    }
  });
});

describe('自动裁判落库（真 PG）', () => {
  it('旧Step-only完整观测仍可诊断落库，五次通过不能取得独立晋级资格', async () => {
    const { a, s1, s2 } = await seed();
    await client.query("INSERT INTO activity_cells(journey_id,step_id,cell_kind,cell_key) VALUES(gen_random_uuid(),$1,'element','readback')", [a]);
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await span(`legacy-${i}`, { step: s1, observed: 1 }));
      ids.push(await span(`legacy-${i}`, { step: s2, observed: 3 }));
    }
    const [auto] = await flushJudgments(client, ids);
    expect(auto).toMatchObject({ verdict: 'converging', consecutive_green: 1, promotion_eligible: false });
    const judgment = await judgeActivity(client, a);
    expect(judgment).toMatchObject({ verdict: 'converging', consecutive_green: 5, promotion_eligible: false, converged: false });
    expect(await getLatestJudgment(client, a)).toMatchObject({ verdict: 'converging', converged: false });
    expect((await client.query("SELECT cell_status FROM activity_cells WHERE step_id=$1 AND cell_key='readback'", [a])).rows[0].cell_status).toBe('pending');
  });

  it('带版本但缺冻结实现和环境的旧观测不混入窗口、不生成可晋级裁判', async () => {
    const { a, s1, s2, v1 } = await seed();
    const ids = [await span('unscoped', { a, step: s1, observed: 1, version: v1 }),
      await span('unscoped', { a, step: s2, observed: 3, version: v1 })];
    const [judgment] = await flushJudgments(client, ids);
    expect(judgment).toMatchObject({ verdict: 'no_data', promotion_eligible: false, judgment_id: null });
    expect(await getLatestJudgment(client, a)).toBeNull();
  });

  it('显式Activity归属优先，不能借另一个Activity的Step补到当前诊断窗口', async () => {
    const { a, s1, s2 } = await seed();
    const other = await seed();
    await span('explicit-other', { a: other.a, step: s1, observed: 1 });
    await span('explicit-other', { a: other.a, step: s2, observed: 3 });
    expect(await judgeActivity(client, a)).toMatchObject({ verdict: 'no_data', promotion_eligible: false });
  });

  it('Step 级 span（不带 activity_id）→ 经 steps 找到 Activity → 对账结果只追加落库，最新可查', async () => {
    const { a, s1, s2 } = await seed();
    const ids = [];
    for (const run of ['r1', 'r2']) { ids.push(await span(run, { step: s1, observed: 1, a })); ids.push(await span(run, { step: s2, observed: 3 })); }
    const out = await flushJudgments(client, ids);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ activity_id: a, verdict: 'converging', consecutive_green: 1, activity_definition_version_id: null, promotion_eligible: false });
    const latest = await getLatestJudgment(client, a);
    expect(latest).toMatchObject({ activity_id: a, verdict: 'converging', consecutive_green: 1, required_green: 5,
      runs_considered: 1, trigger_kind: 'auto', trigger_ref: 'r2', activity_definition_version_id: null });
    expect(latest.report.per_step).toHaveLength(2);

    await expect(client.query('UPDATE activity_judgments SET verdict=$1', ['converged'])).rejects.toThrow(/只追加/);
    await expect(client.query('DELETE FROM activity_judgments')).rejects.toThrow(/只追加/);

    await span('r3', { step: s1, observed: 0, a }); await span('r3', { step: s2, observed: 3, a });
    const manual = await judgeActivity(client, a, { trigger: 'manual', requiredGreen: 2 });
    expect(manual.verdict).toBe('diverged');
    expect((await getLatestJudgment(client, a)).verdict).toBe('diverged');
    expect((await listJudgments(client, a, { limit: 10 })).map(j => j.verdict)).toEqual(['diverged', 'converging']);
  });

  it('没裁判过 → null', async () => {
    expect(await getLatestJudgment(client, randomUUID())).toBeNull();
  });
});

describe('运行没跑完不裁判（真 PG，按 Step 逐条上报）', () => {
  const countJudgments = async a => Number((await client.query('SELECT count(*) FROM activity_judgments WHERE activity_id=$1', [a])).rows[0].count);
  const readbackCell = async a => (await client.query(
    "SELECT cell_status FROM activity_cells WHERE step_id=$1 AND cell_key='readback' AND parent_cell_key IS NULL", [a])).rows[0]?.cell_status;

  it('r1/r2 全绿，r3 只报了第 1 步 → 不落库、readback 不翻红；补上第 2 步再处理 → 落一条 converging', async () => {
    const { a, s1, s2 } = await seed();
    await client.query("INSERT INTO activity_cells(journey_id,step_id,cell_kind,cell_key) VALUES(gen_random_uuid(),$1,'element','readback')", [a]);
    let t = Date.now() - 120_000;
    const at = () => new Date(t += 1000).toISOString();
    const ids = [];
    for (const run of ['r1', 'r2']) { ids.push(await span(run, { step: s1, observed: 1, at: at() })); ids.push(await span(run, { step: s2, observed: 3, at: at() })); }
    await flushJudgments(client, ids);
    expect(await countJudgments(a)).toBe(1);
    expect(await readbackCell(a)).toBe('pending');

    const half = await span('r3', { step: s1, observed: 1, at: at() });
    const out = await flushJudgments(client, [half]);
    expect(out).toEqual([expect.objectContaining({ activity_id: a, deferred: true, run_id: 'r3' })]);
    expect(await countJudgments(a)).toBe(1);
    expect(await readbackCell(a)).not.toBe('red');

    const rest = await span('r3', { step: s2, observed: 3, at: at() });
    await flushJudgments(client, [rest]);
    expect(await countJudgments(a)).toBe(2);
    expect(await getLatestJudgment(client, a)).toMatchObject({ verdict: 'converging', consecutive_green: 1, trigger_ref: 'r3' });
    expect(await readbackCell(a)).toBe('pending');
  });

  it('过了静默期仍缺步 → 确实缺步：按真实结果落 diverged 并翻红', async () => {
    const { a, s1, s2 } = await seed();
    await client.query("INSERT INTO activity_cells(journey_id,step_id,cell_kind,cell_key) VALUES(gen_random_uuid(),$1,'element','readback')", [a]);
    let t = Date.now() - 120_000;
    const at = () => new Date(t += 1000).toISOString();
    await span('r1', { step: s1, observed: 1, at: at() }); await span('r1', { step: s2, observed: 3, at: at() });
    await span('r2', { step: s1, observed: 1, at: at() });
    const early = await judgeActivity(client, a, { trigger: 'auto', triggerRef: 'r2' });
    expect(early.deferred).toBe(true);
    const late = await judgeActivity(client, a, { trigger: 'auto', triggerRef: 'r2', runIdleMs: 0 });
    expect(late).toMatchObject({ verdict: 'diverged' });
    expect(late.judgment_id).toBeTruthy();
    expect(await countJudgments(a)).toBe(1);
    expect(await readbackCell(a)).toBe('red');
  });
});

describe('新旧版本对比（真 PG）', () => {
  async function runs(a, s1, s2, version, n, { badEvery = 0, prefix }) {
    for (let i = 0; i < n; i++) {
      const bad = badEvery && i % badEvery === 0;
      await span(`${prefix}${i}`, { a, step: s1, observed: 1, version });
      await span(`${prefix}${i}`, { a, step: s2, observed: bad ? 0 : 3, version });
    }
  }
  it('候选读回对不上更多 → worse，带数字依据', async () => {
    const { a, s1, s2, v1, v2 } = await seed();
    await runs(a, s1, s2, v1, 6, { prefix: 'base' });
    await runs(a, s1, s2, v2, 6, { prefix: 'cand', badEvery: 2 });
    const r = await compareActivityVersions(client, a, { candidateVersionId: v2, baselineVersionId: v1 });
    expect(r.verdict).toBe('worse');
    expect(r.candidate).toMatchObject({ version_id: v2, runs: 6 });
    expect(r.baseline).toMatchObject({ version_id: v1, runs: 6 });
    expect(r.metrics.readback_verified_ratio).toMatchObject({ baseline: 1, candidate: 0.75, worse: true });
  });

  it('同样好 → not_worse；样本不够 → insufficient_data；基线默认取 Activity 当前版本', async () => {
    const { a, s1, s2, v1, v2 } = await seed();
    await runs(a, s1, s2, v1, 5, { prefix: 'b' });
    await runs(a, s1, s2, v2, 5, { prefix: 'c' });
    await client.query('UPDATE activities SET current_definition_version_id=$2 WHERE id=$1', [a, v1]);
    const ok = await compareActivityVersions(client, a, { candidateVersionId: v2 });
    expect(ok).toMatchObject({ verdict: 'not_worse', baseline: { version_id: v1 } });
    const few = await compareActivityVersions(client, a, { candidateVersionId: v2, baselineVersionId: v1, minRuns: 6 });
    expect(few.verdict).toBe('insufficient_data');
  });

  it('版本不属于该 Activity → 404；候选=基线或无基线 → 400', async () => {
    const { a, v1 } = await seed();
    const other = await seed();
    await expect(compareActivityVersions(client, a, { candidateVersionId: other.v1, baselineVersionId: v1 })).rejects.toMatchObject({ status: 404 });
    await expect(compareActivityVersions(client, a, { candidateVersionId: v1, baselineVersionId: v1 })).rejects.toMatchObject({ status: 400 });
    await expect(compareActivityVersions(client, a, { candidateVersionId: v1 })).rejects.toMatchObject({ status: 400 });
  });
});
