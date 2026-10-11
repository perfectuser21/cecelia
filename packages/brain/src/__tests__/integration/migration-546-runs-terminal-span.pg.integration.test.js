/**
 * 迁移 546（金丝雀 4 #6232）：runs 汇总按「最差 span」定结果，coding workflow GAN 中途的 QA/裁判 FAIL 轮
 * 让合并成功的运行在 Notion「最近执行」显示失败。终态 span（evidence.run_terminal = true）定结果并锁定：
 * 结果 = 该 span 结果，header_source 转 owner（之后的 span 只加 token/费用）。已合并的 coding workflow 运行回填。
 * 在一个事务里铺 F1 能力夹具 + 迁移 542（得到 coding workflow 的 Activity）→ 断言 → 整体 ROLLBACK。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { CODING_WORKFLOW_ID, ACTIVITY_IDS } from '../../../scripts/coding-workflow/runner/lib/spans.mjs';

const body = (file) => readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8')
  .split('\n').filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/.test(line)).join('\n');
const UP = body('546_runs_terminal_span.sql');
const DOWN = body('rollback/546_runs_terminal_span.down.sql');
const VS = 'aaaaaaaa-f0f0-4000-8000-000000000546';
const F1 = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';

let client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  await client.query('BEGIN');
  await client.query("INSERT INTO value_streams (id, name) VALUES ($1, 'Cecelia 工厂 t546') ON CONFLICT (id) DO NOTHING", [VS]);
  await client.query("INSERT INTO capabilities (id, name, status, parent_journey_id) VALUES ($1, '工厂 · F1 开发闭环', 'active', $2) ON CONFLICT (id) DO NOTHING", [F1, VS]);
  await client.query(body('542_coding_workflow_activities.sql'));
});
afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

const all = async (sql, params) => (await client.query(sql, params)).rows;
const span = (runId, key, outcome, { minute, evidence = null, cost = null } = {}) => client.query(
  `INSERT INTO spans (run_id, activity_id, workflow_id, started_at, ended_at, executor_kind, outcome, evidence, cost_usd)
   VALUES ($1, $2, $3, now() - make_interval(mins => $4), now() - make_interval(mins => $4) + interval '30 seconds', 'agent', $5, $6, $7)`,
  [runId, ACTIVITY_IDS[key], CODING_WORKFLOW_ID, 60 - minute, outcome, evidence ? JSON.stringify(evidence) : null, cost],
);
const run = async (runId) => (await all('SELECT outcome, header_source, cost_usd::float AS cost FROM runs WHERE run_id = $1', [runId]))[0];

describe('迁移 546：终态 span 定运行结果', () => {
  it('回填：已有合并 pass span 的 coding workflow 运行（被中途 FAIL 轮判成失败）→ 结果 pass、转 owner；没合并的不动', async () => {
    await span('coding-workflow:t546-old', 'qa', 'fail', { minute: 1 });
    await span('coding-workflow:t546-old', 'merge', 'pass', { minute: 2 });
    await span('coding-workflow:t546-open', 'qa', 'fail', { minute: 1 });
    expect(await run('coding-workflow:t546-old')).toMatchObject({ outcome: 'fail', header_source: 'spans' });
    await client.query(UP);
    await client.query(UP);
    expect(await run('coding-workflow:t546-old')).toMatchObject({ outcome: 'pass', header_source: 'owner' });
    expect(await run('coding-workflow:t546-open')).toMatchObject({ outcome: 'fail', header_source: 'spans' });
  });

  it('中途 FAIL 轮之后来了终态 pass span → 结果 pass；之后的 span 只加费用，不再改结果', async () => {
    const id = 'coding-workflow:t546-new';
    await span(id, 'qa', 'fail', { minute: 1, cost: 1 });
    await span(id, 'judge', 'fail', { minute: 2 });
    expect(await run(id)).toMatchObject({ outcome: 'fail', header_source: 'spans' });
    await span(id, 'merge', 'pass', { minute: 3, evidence: { run_terminal: true } });
    expect(await run(id)).toMatchObject({ outcome: 'pass', header_source: 'owner' });
    await span(id, 'ci_fix', 'fail', { minute: 4, cost: 0.5 });
    expect(await run(id)).toMatchObject({ outcome: 'pass', header_source: 'owner', cost: 1.5 });
  });

  it('终态 span 本身是 fail → 结果 fail（终态说了算）', async () => {
    const id = 'coding-workflow:t546-termfail';
    await span(id, 'qa', 'pass', { minute: 1 });
    await span(id, 'merge', 'fail', { minute: 2, evidence: { run_terminal: true } });
    expect(await run(id)).toMatchObject({ outcome: 'fail', header_source: 'owner' });
  });

  it('没有终态 span 的运行：沿用最差结果规则', async () => {
    const id = 'coding-workflow:t546-plain';
    await span(id, 'qa', 'fail', { minute: 1 });
    await span(id, 'judge', 'pass', { minute: 2 });
    expect(await run(id)).toMatchObject({ outcome: 'fail', header_source: 'spans' });
  });

  it('回滚正文：终态 span 不再锁结果（恢复 531 的最差结果规则）', async () => {
    await client.query('SAVEPOINT down546');
    await client.query(DOWN);
    const id = 'coding-workflow:t546-down';
    await span(id, 'qa', 'fail', { minute: 1 });
    await span(id, 'merge', 'pass', { minute: 2, evidence: { run_terminal: true } });
    expect(await run(id)).toMatchObject({ outcome: 'fail', header_source: 'spans' });
    await client.query('ROLLBACK TO SAVEPOINT down546');
  });
});
