/**
 * 裁判接线真 PG（五块模型·裁判，决策 de6dff5d）：隔离 schema 内建最小表 + 跑真实迁移 538。
 * 锁：自动裁判经 span → Step → Activity 找到归属并落库、只追加、最新裁判可查、新旧版本对比读真 spans。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
    CREATE TABLE workflows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), capability_id uuid, created_at timestamptz DEFAULT now());
    CREATE TABLE workflow_activity_refs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_id uuid, activity_id uuid, source_ref text, active boolean DEFAULT true);
    CREATE TABLE steps(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid REFERENCES activities(id), step_order int, key text UNIQUE,
      readback jsonb NOT NULL DEFAULT '{}', active boolean DEFAULT true);
    CREATE TABLE activity_cells(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), journey_id uuid, step_id uuid, cell_kind text, cell_key text,
      cell_status text DEFAULT 'gray', parent_cell_key text);
    CREATE TABLE activity_definition_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL REFERENCES activities(id),
      payload jsonb NOT NULL, created_at timestamptz DEFAULT now());
    CREATE TABLE spans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id text, activity_id uuid, step_id uuid, enabler_id uuid, outcome text,
      evidence jsonb, attempts int DEFAULT 1, started_at timestamptz, activity_definition_version_id uuid, created_at timestamptz DEFAULT now());`);
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
async function span(run, { a = null, step, observed, outcome = 'pass', version = null }) {
  return (await client.query(
    'INSERT INTO spans(run_id,activity_id,step_id,outcome,evidence,started_at,activity_definition_version_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id',
    [run, a, step, outcome, JSON.stringify(observed === undefined ? {} : { observed }), ts(), version])).rows[0].id;
}

describe('自动裁判落库（真 PG）', () => {
  it('Step 级 span（不带 activity_id）→ 经 steps 找到 Activity → 对账结果只追加落库，最新可查', async () => {
    const { a, s1, s2, v1 } = await seed();
    const ids = [];
    for (const run of ['r1', 'r2']) { ids.push(await span(run, { step: s1, observed: 1, version: v1, a })); ids.push(await span(run, { step: s2, observed: 3 })); }
    const out = await flushJudgments(client, ids);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ activity_id: a, verdict: 'converging', consecutive_green: 2, activity_definition_version_id: v1 });
    const latest = await getLatestJudgment(client, a);
    expect(latest).toMatchObject({ activity_id: a, verdict: 'converging', consecutive_green: 2, required_green: 5,
      runs_considered: 2, trigger_kind: 'auto', trigger_ref: 'r2', activity_definition_version_id: v1 });
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
