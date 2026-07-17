/**
 * MJ5 刀2-4 proven-to-fire 集成测试
 *
 * 在真实 DB 上验证三闸实际能开火：
 *
 * [刀2] S2 锚点执法闸（proven-to-fire）:
 *   B2-1: 新 dev 任务无锚 → checkAnchor 返回 blocked=true（missing_anchor）
 *   B2-2: 带完整锚的新任务 → checkAnchor 放行
 *   B2-3: 存量任务（创建在 cutoff 前）无锚 → 豁免放行
 *   B2-4: harness_initiative 无锚 → 豁免放行
 *
 * [刀3] S3 step-impact API（proven-to-fire）:
 *   B3-1: GP-B S1（seed 数据）→ /journeys/steps/:id/impact 返回含 base_ref 格子的 impacts
 *   B3-2: runnable_count 为数字且 >= 0
 *   B3-3: 不存在 step → 200 + impacts:[]
 *
 * [刀4] S4 nightly 对账（proven-to-fire）:
 *   B4-1: buildNightlyAssertions 对真实 DB，A3 不永绿（base_ref 格子全有 feature_id → pass）
 *   B4-2: A4 三闸心跳在真实 FS 上通过
 *   B4-3: 制造 base_ref 断线（feature_id=NULL）→ A3 正确检出
 */

import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';

const GPB = 'ac2e35bc-849a-48cd-917f-79d15c5ac886';

let pool;
let app;
let checkAnchor;
let ANCHOR_LEGACY_CUTOFF;
let buildNightlyAssertions;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;

  const anchorMod = await import('../../anchor-check.js');
  checkAnchor = anchorMod.checkAnchor;
  ANCHOR_LEGACY_CUTOFF = anchorMod.ANCHOR_LEGACY_CUTOFF;

  const nightlyMod = await import('../../promise-map-nightly.js');
  buildNightlyAssertions = nightlyMod.buildNightlyAssertions;

  const { default: router } = await import('../../routes/journeys.js');
  const express = (await import('express')).default;
  const a = express();
  a.use(express.json());
  a.use('/api/brain', router);
  app = a;
});

// ──────────────────────────────────────────────
// 刀2: S2 锚点执法闸 proven-to-fire
// ──────────────────────────────────────────────
describe('[刀2] S2 锚点执法闸 proven-to-fire', () => {
  it('[B2-1] 新 dev 任务无锚 → missing_anchor 拒绝', () => {
    const afterCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() + 60_000).toISOString();
    const task = { task_type: 'dev', created_at: afterCutoff, payload: {} };
    const r = checkAnchor(task);
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('missing_anchor');
  });

  it('[B2-2] 带完整锚的新 dev 任务 → 放行', () => {
    const afterCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() + 60_000).toISOString();
    const task = {
      task_type: 'dev',
      created_at: afterCutoff,
      payload: { anchor: { journey_id: 'j1', gp_id: 'gp1', step_id: 's1' } },
    };
    expect(checkAnchor(task).blocked).toBe(false);
  });

  it('[B2-3] 存量任务（cutoff 前创建）无锚 → 豁免放行', () => {
    const beforeCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() - 60_000).toISOString();
    const task = { task_type: 'dev', created_at: beforeCutoff, payload: {} };
    expect(checkAnchor(task).blocked).toBe(false);
  });

  it('[B2-4] harness_initiative 无锚 → 豁免放行', () => {
    const afterCutoff = new Date(ANCHOR_LEGACY_CUTOFF.getTime() + 60_000).toISOString();
    const task = { task_type: 'harness_initiative', created_at: afterCutoff, payload: {} };
    expect(checkAnchor(task).blocked).toBe(false);
  });
});

// ──────────────────────────────────────────────
// 刀3: S3 step-impact API proven-to-fire（真实 DB）
// ──────────────────────────────────────────────
describe('[刀3] S3 step-impact API proven-to-fire（seed 数据）', () => {
  let gpbStep1Id;

  beforeAll(async () => {
    const { rows } = await pool.query(
      `SELECT id FROM journey_steps WHERE journey_id=$1 AND step_number=1`, [GPB]);
    gpbStep1Id = rows[0]?.id;
  });

  it('[B3-1] GP-B S1 → impacts 含格子（blast-radius 已 seed）', async () => {
    const res = await supertest(app)
      .get(`/api/brain/journeys/steps/${gpbStep1Id}/impact`);
    expect(res.status).toBe(200);
    expect(res.body.step_id).toBe(gpbStep1Id);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.impacts.length).toBeGreaterThan(0);
  });

  it('[B3-2] GP-B S1 runnable_count 为数字', async () => {
    const res = await supertest(app)
      .get(`/api/brain/journeys/steps/${gpbStep1Id}/impact`);
    expect(typeof res.body.runnable_count).toBe('number');
    expect(res.body.runnable_count).toBeGreaterThanOrEqual(0);
  });

  it('[B3-3] 不存在的 step_id → 200 + impacts 为空数组', async () => {
    const res = await supertest(app)
      .get('/api/brain/journeys/steps/00000000-0000-0000-0000-000000000000/impact');
    expect(res.status).toBe(200);
    expect(res.body.impacts).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

// ──────────────────────────────────────────────
// 刀4: S4 nightly 对账 proven-to-fire（真实 DB）
// ──────────────────────────────────────────────
describe('[刀4] S4 nightly 对账 proven-to-fire（真实 DB）', () => {
  it('[B4-1] A3 对真实 DB：base_ref 格子全有 feature_id → A3 通过（非永绿验证）', async () => {
    const results = await buildNightlyAssertions(pool);
    const a3 = results.find(r => r.key === 'ledger_integrity');
    expect(a3).toBeDefined();
    expect(a3.ok).toBe(true);
    expect(a3.detail).toMatch(/完整/);
  });

  it('[B4-2] A4 三闸心跳：闸文件在真实 FS 上存在', async () => {
    const results = await buildNightlyAssertions(pool);
    const a4 = results.find(r => r.key === 'gate_heartbeat');
    expect(a4.ok).toBe(true);
    expect(a4.detail).toMatch(/3.*闸/);
  });

  it('[B4-3] 制造 base_ref 断线（feature_id=NULL）→ A3 正确检出', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: srows } = await client.query(
        `SELECT id, journey_id FROM journey_steps
         WHERE journey_id=$1 AND step_number=1`, [GPB]);
      const step = srows[0];

      await client.query(
        `INSERT INTO journey_step_links
           (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, status, notion_synced_at)
         VALUES ($1,$2,'base_ref','[test-probe] 断线探针','gray',NULL,'planned',NOW())`,
        [step.journey_id, step.id]);

      const results = await buildNightlyAssertions(client);
      const a3 = results.find(r => r.key === 'ledger_integrity');
      expect(a3.ok).toBe(false);
      expect(a3.detail).toMatch(/断线/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
