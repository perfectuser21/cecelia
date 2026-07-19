/**
 * TDD: GET /api/brain/journey_steps/:step_id/ledger
 *
 * 对该步骤关联的 journey_features 跑 11 要素体检（复用 computeLedgerStatus）。
 *
 * 验收：
 * [JSL-1] step 存在且有关联 feature → 返回 features 数组含 ledger 11 要素
 * [JSL-2] step 存在但无关联 feature → features: [], total: 0，不报错
 * [JSL-3] step 不存在 → 404
 * [JSL-4] DB 错误 → 500
 * [JSL-5] 共享函数被两处引用（features.js + journeys.js），非复制粘贴
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../journeys.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

describe('GET /api/brain/journey_steps/:step_id/ledger', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('[JSL-1] step 有关联 feature → 返回 features 数组含 ledger', async () => {
    // query 1: step 存在
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'step-abc', name: '用户登录步' }] });
    // query 2: journey_step_links JOIN journey_features
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-1111-1111-111111111111',
        name: '认证能力',
        description: '处理用户认证流程',
        status: 'done',
        thickness: 'medium',
        updated_at: new Date().toISOString(),
        last_verified: null,
        smoke_cmd: null,
        smoke_status: null,
        has_unit_test: false,
        has_integration_test: false,
        has_e2e: false,
        priority: null,
        notes: null,
        cell_kind: '能力',
        cell_status: 'green',
        assertion_ref: 'tests/auth.test.js',
      }],
    });
    // query 3: nfr decisions
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // query 4: invariant decisions
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/step-abc/ledger');

    expect(res.status).toBe(200);
    expect(res.body.step_id).toBe('step-abc');
    expect(res.body.step_name).toBe('用户登录步');
    expect(res.body.total).toBe(1);
    expect(res.body.features).toHaveLength(1);
    const f = res.body.features[0];
    expect(f.feature_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(f.feature_name).toBe('认证能力');
    expect(f.cell_kind).toBe('能力');
    expect(f.cell_status).toBe('green');
    expect(f.assertion_ref).toBe('tests/auth.test.js');
    // 11 要素全部存在
    expect(f.ledger).toHaveProperty('fr');
    expect(f.ledger).toHaveProperty('nfr');
    expect(f.ledger).toHaveProperty('invariant');
    expect(f.ledger).toHaveProperty('checkpoints');
    expect(f.ledger).toHaveProperty('freshness_status');
    expect(f.ledger).toHaveProperty('death_alert');
    expect(f.ledger).toHaveProperty('failure_semantics');
    expect(f.ledger).toHaveProperty('effect_confirmed');
    expect(f.ledger).toHaveProperty('adversarial');
    expect(f.ledger).toHaveProperty('ledger_status');
    expect(f.ledger).toHaveProperty('axis_aligned');
    // description 存在 → fr=ok
    expect(f.ledger.fr).toBe('ok');
  });

  it('[JSL-2] step 存在但无关联 feature → features: [], total: 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'step-empty', name: '空步骤' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 无关联

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/step-empty/ledger');

    expect(res.status).toBe(200);
    expect(res.body.step_id).toBe('step-empty');
    expect(res.body.features).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body).toHaveProperty('generated_at');
  });

  it('[JSL-3] step 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/step-ghost/ledger');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('journey_step not found');
  });

  it('[JSL-4] DB 错误 → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection refused'));

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/step-any/ledger');

    expect(res.status).toBe(500);
  });
});

describe('[JSL-5] 共享 computeLedgerStatus 被两处引用', () => {
  it('features.js 和 journeys.js 都从 lib/eleven-elements-ledger.js 导入，非复制', async () => {
    const featuresSource = await import('fs').then(fs =>
      fs.readFileSync(
        new URL('../features.js', import.meta.url).pathname, 'utf8'
      )
    );
    const journeysSource = await import('fs').then(fs =>
      fs.readFileSync(
        new URL('../journeys.js', import.meta.url).pathname, 'utf8'
      )
    );
    expect(featuresSource).toContain("from '../lib/eleven-elements-ledger.js'");
    expect(journeysSource).toContain("from '../lib/eleven-elements-ledger.js'");
  });
});
