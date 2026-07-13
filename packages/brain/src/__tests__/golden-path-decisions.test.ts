import { describe, it, expect, vi, beforeEach } from 'vitest';

// 复用 abilities.test.js 的 mock 风格：mock db.js 的 default pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../routes/abilities.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

const REAL_TASK = '11111111-1111-1111-1111-111111111111';
const REAL_FEATURE = '22222222-2222-2222-2222-222222222222';
const REAL_STEP = '33333333-3333-3333-3333-333333333333';
const MISSING = '00000000-0000-0000-0000-000000000000';

describe('golden_path owner_task_id 模型 [BEHAVIOR]', () => {
  beforeEach(() => mockQuery.mockReset());

  it('POST /golden_path 用 owner_task_id + feature_id 建步返回 201 且回吐新模型字段', async () => {
    // 期望端点先校验 task 存在，再 INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: REAL_TASK }] })       // SELECT tasks 存在性
      .mockResolvedValueOnce({ rows: [{ id: REAL_STEP, owner_task_id: REAL_TASK, order_no: 1, feature_id: REAL_FEATURE, note: null }] }); // INSERT RETURNING
    const res = await (await req())(await makeApp())
      .post('/api/brain/golden_path')
      .send({ owner_task_id: REAL_TASK, order_no: 1, feature_id: REAL_FEATURE });
    expect(res.status).toBe(201);
    expect(res.body.owner_task_id).toBe(REAL_TASK);
    expect(res.body.feature_id).toBe(REAL_FEATURE);
    // 旧错模型列绝不回吐
    expect(res.body).not.toHaveProperty('scope_type');
    expect(res.body).not.toHaveProperty('ability_id');
  });

  it('POST /golden_path owner_task_id 不存在 → 400', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT tasks 查不到
    const res = await (await req())(await makeApp())
      .post('/api/brain/golden_path')
      .send({ owner_task_id: MISSING, order_no: 1, feature_id: REAL_FEATURE });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('POST /golden_path owner_task_id 非法 uuid → 400（不可 500）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
    const res = await (await req())(await makeApp())
      .post('/api/brain/golden_path')
      .send({ owner_task_id: 'not-a-uuid', order_no: 1, feature_id: REAL_FEATURE });
    expect(res.status).toBe(400);
  });
});

describe('decisions golden_path target 校验 [BEHAVIOR]', () => {
  beforeEach(() => mockQuery.mockReset());

  it('POST /decisions target_type=golden_path 指向真实步 → 201', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: REAL_STEP }] }) // SELECT golden_path 存在性
      .mockResolvedValueOnce({ rows: [{ id: 'dec-1', level: 'step', target_type: 'golden_path', target_id: REAL_STEP, scope: 'v1' }] }); // INSERT
    const res = await (await req())(await makeApp())
      .post('/api/brain/decisions')
      .send({ category: 'nfr', topic: '前后台', decision: '后台静默', level: 'step', target_type: 'golden_path', target_id: REAL_STEP, scope: 'v1' });
    expect(res.status).toBe(201);
    expect(res.body.target_type).toBe('golden_path');
    expect(res.body.level).toBe('step');
  });

  it('POST /decisions golden_path target_id 不存在 → 400', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT golden_path 查不到
    const res = await (await req())(await makeApp())
      .post('/api/brain/decisions')
      .send({ category: 'nfr', level: 'step', target_type: 'golden_path', target_id: MISSING, scope: 'v1' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('POST /decisions golden_path target_id 非法 uuid → 400（不可 500）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
    const res = await (await req())(await makeApp())
      .post('/api/brain/decisions')
      .send({ category: 'nfr', level: 'step', target_type: 'golden_path', target_id: 'not-a-uuid', scope: 'v1' });
    expect(res.status).toBe(400);
  });
});

describe('golden_path 决策读回视图 [BEHAVIOR]', () => {
  beforeEach(() => mockQuery.mockReset());

  it('GET /golden_path/:id/decisions?scope=v1 返回该步决策数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dec-1', target_type: 'golden_path', target_id: REAL_STEP, scope: 'v1', category: 'nfr' }] });
    const res = await (await req())(await makeApp())
      .get(`/api/brain/golden_path/${REAL_STEP}/decisions?scope=v1`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].target_id).toBe(REAL_STEP);
  });

  it('GET /golden_path/:id/decisions 无匹配 → 200 + 空数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await (await req())(await makeApp())
      .get(`/api/brain/golden_path/${MISSING}/decisions?scope=v1`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /tasks/:id/golden-path-decisions?category=nfr&scope=v1 按 owner_task_id join 返回验收单', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dec-1', target_type: 'golden_path', target_id: REAL_STEP, scope: 'v1', category: 'nfr', order_no: 1 }] });
    const res = await (await req())(await makeApp())
      .get(`/api/brain/tasks/${REAL_TASK}/golden-path-decisions?category=nfr&scope=v1`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].category).toBe('nfr');
  });

  it('GET /tasks/:id/golden-path-decisions 无匹配 → 200 + 空数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await (await req())(await makeApp())
      .get(`/api/brain/tasks/${MISSING}/golden-path-decisions?category=nfr&scope=v1`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
