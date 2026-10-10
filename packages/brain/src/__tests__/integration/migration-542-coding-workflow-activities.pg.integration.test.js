/**
 * 迁移 542（决策 b34e346a）：在一个事务里铺「工厂 · F1 开发闭环」能力夹具 → 跑迁移正文 → 断言 → 再跑一遍（幂等）
 * → 上报一条 span 验证 activity_id 可用 → 跑回滚正文 → 断言删净 → 整体 ROLLBACK。
 * 测试库没有生产能力，迁移本身在 migrate 时是空操作；这里验证对真实形状数据的效果。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { CODING_WORKFLOW_ID, ACTIVITY_IDS } from '../../../scripts/coding-workflow/runner/lib/spans.mjs';

const body = (file) => readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8')
  .split('\n').filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/.test(line)).join('\n');
const UP = body('542_coding_workflow_activities.sql');
const DOWN = body('rollback/542_coding_workflow_activities.down.sql');
const VS = 'aaaaaaaa-f0f0-4000-8000-000000000542';
const F1 = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';

let client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  await client.query('BEGIN');
  await client.query("INSERT INTO value_streams (id, name) VALUES ($1, 'Cecelia 工厂 t542') ON CONFLICT (id) DO NOTHING", [VS]);
  await client.query("INSERT INTO capabilities (id, name, status, parent_journey_id) VALUES ($1, '工厂 · F1 开发闭环', 'active', $2) ON CONFLICT (id) DO NOTHING", [F1, VS]);
});
afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

const all = async (sql, params) => (await client.query(sql, params)).rows;

describe('迁移 542：coding workflow 登记为流程 + 12 个 Activity', () => {
  it('正文：F1 下新流程 coding_workflow（source_repo 留空），12 个 Activity 按顺序引用；id 与 runner 上报用的一致；重跑幂等', async () => {
    await client.query(UP);
    await client.query(UP);
    const [wf] = await all('SELECT id, capability_id, key, channel, form, status, source_repo FROM workflows WHERE key = $1', ['coding_workflow']);
    expect(wf).toMatchObject({ id: CODING_WORKFLOW_ID, capability_id: F1, channel: 'internal', form: 'pipeline', status: 'active', source_repo: null });
    const refs = await all('SELECT r.slot_key, r.activity_id FROM workflow_activity_refs r WHERE r.workflow_id = $1 AND r.active ORDER BY r.sequence_no', [CODING_WORKFLOW_ID]);
    expect(refs.map((r) => r.slot_key)).toEqual(Object.keys(ACTIVITY_IDS));
    expect(refs.map((r) => r.activity_id)).toEqual(Object.values(ACTIVITY_IDS));
  });

  it('runner 上报的 span（activity_id = 登记的 Activity）能写进 spans，runs 触发器建出总记录', async () => {
    await client.query(`INSERT INTO spans (run_id, activity_id, workflow_id, started_at, ended_at, executor_kind, outcome)
      VALUES ('coding-workflow:t542', $1, $2, now() - interval '1 minute', now(), 'agent', 'pass')`, [ACTIVITY_IDS.spec, CODING_WORKFLOW_ID]);
    const runs = await all("SELECT run_id FROM runs WHERE run_id = 'coding-workflow:t542'");
    expect(runs).toEqual([{ run_id: 'coding-workflow:t542' }]);
  });

  it('测试库没有 F1 能力时正文是空操作', async () => {
    await client.query('SAVEPOINT no_f1');
    await client.query(DOWN);
    await client.query('DELETE FROM capabilities WHERE id = $1', [F1]);
    await client.query(UP);
    expect(await all('SELECT 1 FROM workflows WHERE id = $1', [CODING_WORKFLOW_ID])).toEqual([]);
    await client.query('ROLLBACK TO SAVEPOINT no_f1');
  });

  it('回滚：流程、引用、Activity 与本流程的 span 全删', async () => {
    await client.query(DOWN);
    expect(await all('SELECT 1 FROM workflows WHERE id = $1', [CODING_WORKFLOW_ID])).toEqual([]);
    expect(await all('SELECT 1 FROM activities WHERE id = ANY($1::uuid[])', [Object.values(ACTIVITY_IDS)])).toEqual([]);
    expect(await all('SELECT 1 FROM workflow_activity_refs WHERE workflow_id = $1', [CODING_WORKFLOW_ID])).toEqual([]);
    expect(await all("SELECT 1 FROM spans WHERE run_id = 'coding-workflow:t542'")).toEqual([]);
  });
});
