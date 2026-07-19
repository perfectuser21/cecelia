/**
 * TDD: GET /api/brain/journey_steps/:step_id/ledger
 *
 * 承诺地图"每步四区"第二区：对 step 关联的 journey_features 跑 11 要素体检。
 * 只读计算视图，不写 DB。
 *
 * [JSL-1] step 有关联 feature 的格子 → 返回 items 含 11 要素 ledger 字段
 * [JSL-2] step 无关联 feature 格子 → items: [], total: 0，不报错
 * [JSL-3] step 不存在 → 404
 * [JSL-4] DB 错误 → 500
 * [JSL-5] 复用 computeLedgerStatus 共享函数（不是复制粘贴）
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

  it('[JSL-1] step 有关联 feature 格子 → 返回 items 含 ledger', async () => {
    // 1: step 存在
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'step-1', name: '用户注册' }] });
    // 2: journey_step_links + journey_features join
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          feature_id: 'jf-auth',
          cell_kind: 'base_ref',
          cell_status: 'green',
          id: 'jf-auth',
          name: '注册能力',
          description: '用户注册流程',
          status: 'live',
          priority: 'P0',
          has_unit_test: true,
          has_integration_test: true,
          has_e2e: true,
          last_verified: new Date(Date.now() - 10 * 86400000).toISOString(),
          updated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
          smoke_cmd: 'bash smoke/auth.sh',
          smoke_status: 'passing',
          notes: '覆盖对抗输入',
        },
      ],
    });
    // 3: nfr decisions
    mockQuery.mockResolvedValueOnce({ rows: [{ target_id: 'jf-auth', cnt: '2' }] });
    // 4: invariant decisions
    mockQuery.mockResolvedValueOnce({ rows: [{ target_id: 'jf-auth', cnt: '1' }] });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/step-1/ledger');

    expect(res.status).toBe(200);
    expect(res.body.step_id).toBe('step-1');
    expect(res.body.step_name).toBe('用户注册');
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);

    const item = res.body.items[0];
    expect(item.feature_id).toBe('jf-auth');
    expect(item.feature_name).toBe('注册能力');
    // 11 要素字段结构完整
    expect(item.ledger).toHaveProperty('fr');
    expect(item.ledger).toHaveProperty('nfr');
    expect(item.ledger).toHaveProperty('invariant');
    expect(item.ledger).toHaveProperty('checkpoints');
    expect(item.ledger).toHaveProperty('freshness_status');
    expect(item.ledger).toHaveProperty('death_alert');
    expect(item.ledger).toHaveProperty('failure_semantics');
    expect(item.ledger).toHaveProperty('effect_confirmed');
    expect(item.ledger).toHaveProperty('adversarial');
    expect(item.ledger).toHaveProperty('ledger_status');
    expect(item.ledger).toHaveProperty('axis_aligned');

    // 这个 feature 全齐，所以 fr/nfr/invariant 应该都是 ok
    expect(item.ledger.fr).toBe('ok');
    expect(item.ledger.nfr).toBe('ok');
    expect(item.ledger.invariant).toBe('ok');
    expect(item.ledger.death_alert).toBe('ok');
    expect(res.body.generated_at).toBeTruthy();
  });

  it('[JSL-2] step 存在但无关联 feature 格子 → items: [], total: 0', async () => {
    // 1: step 存在
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'step-empty', name: '空步骤' }] });
    // 2: 无格子
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/step-empty/ledger');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
    // 仅发出 2 次 query（step查找 + links查找），无 NFR/invariant 查询
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('[JSL-3] step 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/nonexistent/ledger');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('step not found');
  });

  it('[JSL-4] DB 错误 → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection refused'));

    const app = await makeApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/brain/journey_steps/step-any/ledger');

    expect(res.status).toBe(500);
  });

  it('[JSL-5] journeys.js 导入了 computeLedgerStatus 共享函数（不是复制代码）', async () => {
    // 验证 journeys.js 的源码确实 import computeLedgerStatus
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../journeys.js'), 'utf8');
    expect(src).toContain("import { computeLedgerStatus }");
    expect(src).toContain("eleven-elements-ledger");
  });
});
