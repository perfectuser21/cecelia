/**
 * 迁移 547（决策 c167d6e3）：F1 能力夹具 + 迁移 542 → 跑 547 正文（两遍，幂等）→ commander 排第 13 位、span 可写 → 回滚删净 → 整体 ROLLBACK。
 * 测试库没有生产能力，迁移本身在 migrate 时是空操作；这里验证对真实形状数据的效果。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { CODING_WORKFLOW_ID, ACTIVITY_IDS } from '../../../scripts/coding-workflow/runner/lib/spans.mjs';

const body = (file) => readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8')
  .split('\n').filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/.test(line)).join('\n');
const UP542 = body('542_coding_workflow_activities.sql');
const UP = body('547_coding_workflow_commander_activity.sql');
const DOWN = body('rollback/547_coding_workflow_commander_activity.down.sql');
const VS = 'aaaaaaaa-f0f0-4000-8000-000000000547';
const F1 = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';

let client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  await client.query('BEGIN');
  await client.query("INSERT INTO value_streams (id, name) VALUES ($1, 'Cecelia 工厂 t547') ON CONFLICT (id) DO NOTHING", [VS]);
  await client.query("INSERT INTO capabilities (id, name, status, parent_journey_id) VALUES ($1, '工厂 · F1 开发闭环', 'active', $2) ON CONFLICT (id) DO NOTHING", [F1, VS]);
  await client.query(UP542);
});
afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

const all = async (sql, params) => (await client.query(sql, params)).rows;

describe('迁移 547：coding commander Activity', () => {
  it('正文：commander 登记为第 13 个 Activity（id 与 runner 一致）；重跑幂等；span 可写', async () => {
    await client.query(UP);
    await client.query(UP);
    const refs = await all('SELECT slot_key, activity_id, sequence_no FROM workflow_activity_refs WHERE workflow_id = $1 AND active ORDER BY sequence_no', [CODING_WORKFLOW_ID]);
    expect(refs.map((r) => r.slot_key)).toEqual(Object.keys(ACTIVITY_IDS));
    expect(refs.at(-1)).toMatchObject({ slot_key: 'commander', activity_id: ACTIVITY_IDS.commander, sequence_no: 13 });
    await client.query(`INSERT INTO spans (run_id, activity_id, workflow_id, started_at, ended_at, executor_kind, outcome)
      VALUES ('coding-workflow:t547', $1, $2, now() - interval '1 minute', now(), 'agent', 'pass')`, [ACTIVITY_IDS.commander, CODING_WORKFLOW_ID]);
    expect(await all("SELECT run_id FROM runs WHERE run_id = 'coding-workflow:t547'")).toEqual([{ run_id: 'coding-workflow:t547' }]);
  });

  it('回滚：删净 commander Activity、引用与 span；前 12 个不受影响', async () => {
    await client.query(DOWN);
    expect(await all('SELECT 1 FROM activities WHERE id = $1', [ACTIVITY_IDS.commander])).toEqual([]);
    const refs = await all('SELECT slot_key FROM workflow_activity_refs WHERE workflow_id = $1 AND active', [CODING_WORKFLOW_ID]);
    expect(refs).toHaveLength(12);
  });
});
