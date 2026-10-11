/**
 * 迁移 547 技能工厂台账（决策 cc008b7e / 2bb08a99）：真 PG 跑迁移（两遍幂等）+ 真库函数。
 * 一条业务 workflow 一行；进厂默认阶段 1 并记事件；rule 只能相邻推进/规定退回，human 任意跳且留痕；
 * 人工关口卡住时 rule 不能动；expected_from_stage 不符 409；滑窗计数与降级计数；事件只追加。
 * 一个事务里铺夹具 → 断言 → 整体 ROLLBACK。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { createLedger, getLedger, listLedger, transitionLedger, recordRun, patchLedger } from '../../lib/factory-ledger.js';

const body = (file) => readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8')
  .split('\n').filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/.test(line)).join('\n');
const UP = body('547_factory_ledger.sql');
const VS = 'aaaaaaaa-f0f0-4000-8000-000000000547';
const CAP = 'aaaaaaaa-f0f0-4000-8000-000000005471';
const WF = 'aaaaaaaa-f0f0-4000-8000-000000005472';
const WF2 = 'aaaaaaaa-f0f0-4000-8000-000000005473';

let client;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  client = new pg.Client(DB_DEFAULTS);
  await client.connect();
  await client.query('BEGIN');
  await client.query(UP);
  await client.query(UP);
  await client.query("INSERT INTO value_streams (id, name) VALUES ($1, 'Cecelia 工厂 t547') ON CONFLICT (id) DO NOTHING", [VS]);
  await client.query("INSERT INTO capabilities (id, name, status, parent_journey_id) VALUES ($1, '工厂台账 t547', 'active', $2) ON CONFLICT (id) DO NOTHING", [CAP, VS]);
  for (const [id, key] of [[WF, 't547.douyin_publish'], [WF2, 't547.other']])
    await client.query("INSERT INTO workflows (id, capability_id, key, name, channel) VALUES ($1, $2, $3, $3, 'douyin')", [id, CAP, key]);
});
afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

const expectHttp = async (p, status, code) => {
  const e = await p.then(() => null, (err) => err);
  expect(e, `应抛 ${status} ${code}`).toBeTruthy();
  expect({ status: e.status, code: e.code }).toEqual({ status, code });
};

describe('迁移 547：技能工厂台账', () => {
  let id;
  it('进厂：默认阶段 1、边用边验，记一条进厂事件；同一 workflow 重复进厂 409；workflow 不存在 404', async () => {
    const out = await createLedger(client, { workflow_id: WF, next_action: '试跑第 1 次' });
    id = out.ledger.id;
    expect(out.ledger).toMatchObject({ workflow_id: WF, stage: 1, stage_name: '试跑', validation_mode: 'use_while_validate', blocked_kind: 'none', recent_total: 0 });
    const got = await getLedger(client, id);
    expect(got.events).toHaveLength(1);
    expect(got.events[0]).toMatchObject({ from_stage: null, to_stage: 1, actor: 'human' });
    await expectHttp(createLedger(client, { workflow_id: WF }), 409, 'LEDGER_EXISTS');
    await expectHttp(createLedger(client, { workflow_id: 'aaaaaaaa-f0f0-4000-8000-00000000dead' }), 404, 'WORKFLOW_NOT_FOUND');
  });

  it('rule 相邻推进带证据并重置滑窗；跳级 400 不落事件；expected_from_stage 不符 409', async () => {
    await recordRun(client, id, { run_id: 'run-a', pass: true });
    const out = await transitionLedger(client, id, { to_stage: 2, actor: 'rule', reason: '试跑通过', evidence_run_ids: ['run-a'], expected_from_stage: 1 });
    expect(out.ledger).toMatchObject({ stage: 2, recent_total: 0, recent_pass: 0 });
    expect(out.event).toMatchObject({ from_stage: 1, to_stage: 2, actor: 'rule', evidence_run_ids: ['run-a'] });
    await expectHttp(transitionLedger(client, id, { to_stage: 4, actor: 'rule', reason: '想跳级' }), 400, 'ILLEGAL_TRANSITION');
    await expectHttp(transitionLedger(client, id, { to_stage: 3, actor: 'rule', reason: '并发旧读', expected_from_stage: 1 }), 409, 'STAGE_CONFLICT');
    expect((await getLedger(client, id)).events).toHaveLength(2);
  });

  it('人工关口卡住时 rule 409；human 任意跳且留痕；rule 规定退回 7→6', async () => {
    await patchLedger(client, id, { blocked_kind: 'human_gate', blocked_reason: '对外流程首次上生产' });
    await expectHttp(transitionLedger(client, id, { to_stage: 3, actor: 'rule', reason: '验证通过' }), 409, 'BLOCKED_NEEDS_HUMAN');
    const jump = await transitionLedger(client, id, { to_stage: 7, actor: 'human', actor_name: 'alex', reason: '主理人拍板直接晋级' });
    expect(jump.event).toMatchObject({ from_stage: 2, to_stage: 7, actor: 'human', actor_name: 'alex' });
    await patchLedger(client, id, { blocked_kind: 'none', blocked_reason: null });
    const back = await transitionLedger(client, id, { to_stage: 6, actor: 'rule', reason: '守护劣化退回' });
    expect(back.ledger.stage).toBe(6);
  });

  it('记运行：滑窗按 window_k 截尾、同 run_id 不重复、降级计数累加', async () => {
    await patchLedger(client, id, { window_k: 3 });
    for (const [run, pass] of [['r1', true], ['r2', false], ['r3', true], ['r4', true]]) await recordRun(client, id, { run_id: run, pass, degraded: run === 'r2' });
    const dup = await recordRun(client, id, { run_id: 'r4', pass: false, degraded: true });
    expect(dup.duplicate).toBe(true);
    expect(dup.ledger).toMatchObject({ recent_pass: 2, recent_total: 3, degrade_count: 1 });
    expect(dup.ledger.recent_runs.map(r => r.run_id)).toEqual(['r2', 'r3', 'r4']);
    await expectHttp(recordRun(client, 'aaaaaaaa-f0f0-4000-8000-00000000dead', { run_id: 'x', pass: true }), 404, 'LEDGER_NOT_FOUND');
  });

  it('列表按阶段过滤带 workflow 名；事件只追加', async () => {
    await createLedger(client, { workflow_id: WF2, stage: 3, validation_mode: 'validate_before_release', reason: '补登记' });
    const rows = await listLedger(client, { stage: 6 });
    expect(rows.map(r => r.workflow_key)).toContain('t547.douyin_publish');
    expect(rows.map(r => r.workflow_key)).not.toContain('t547.other');
    await client.query('SAVEPOINT ap');
    const e = await client.query('UPDATE factory_stage_events SET reason = $1 WHERE ledger_id = $2', ['改写', id]).then(() => null, (err) => err);
    await client.query('ROLLBACK TO SAVEPOINT ap');
    expect(e?.message).toMatch(/只追加/);
  });
});
