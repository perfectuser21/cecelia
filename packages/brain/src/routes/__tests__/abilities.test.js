import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../abilities.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}
const req = async () => (await import('supertest')).default;

describe('abilities routes', () => {
  beforeEach(() => mockQuery.mockReset());

  it('GET /abilities 返回数组', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', name: '抖音视频发布', kind: 'ability' }] });
    const res = await (await req())(await makeApp()).get('/api/brain/abilities');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /abilities 缺 name 返回 400', async () => {
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ area: 'zenithjoy' });
    expect(res.status).toBe(400);
  });

  it('POST /abilities 建一条返回 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'area-uuid' }] }); // areas 表查 area_id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a2', name: 'X', area_id: 'area-uuid', kind: 'ability' }] }); // INSERT journey_features
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ name: 'X', area: 'zenithjoy' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('X');
    expect(res.body.kind).toBe('ability');
  });

  it('PATCH /abilities/:id 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await (await req())(await makeApp()).patch('/api/brain/abilities/nope').send({ status: 'working' });
    expect(res.status).toBe(404);
  });

  it('GET /golden_path 返回数组（按 order_no）', async () => {
    // 新模型：按 owner_task_id 过滤、order_no 排序（不再有 scope_type/ability_id）
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1', owner_task_id: 't1', order_no: 1, feature_id: 'f1' }] });
    const res = await (await req())(await makeApp()).get('/api/brain/golden_path?owner_task_id=t1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /golden_path 缺字段返回 400', async () => {
    // 新模型：缺 owner_task_id → 400
    const res = await (await req())(await makeApp()).post('/api/brain/golden_path').send({ order_no: 1 });
    expect(res.status).toBe(400);
  });


  it('POST /abilities 查 journey_features 而非 abilities（kind 字段必须存在）', async () => {
    // 不传 area，只做一次 INSERT query
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ab1', name: 'Y', kind: 'feature' }] }); // INSERT journey_features
    const res = await (await req())(await makeApp()).post('/api/brain/abilities').send({ name: 'Y', kind: 'feature' });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('feature');
  });

  it('DB 报错返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    const res = await (await req())(await makeApp()).get('/api/brain/abilities');
    expect(res.status).toBe(500);
  });

  // ── P0（A1 硬前置）: GET /journeys/:journey_id/golden-paths ──
  describe('GET /journeys/:journey_id/golden-paths', () => {
    it('按 owner_task_id 分组聚合，附 ability 元数据，组内按 order_no 排序', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { ability_id: 'ab1', ability_name: '发抖音视频', ability_status: 'done', owner_task_id: 't1', id: 'g1', order_no: 1, feature_id: 'f1', note: 'step1' },
          { ability_id: 'ab1', ability_name: '发抖音视频', ability_status: 'done', owner_task_id: 't1', id: 'g2', order_no: 2, feature_id: 'f2', note: 'step2' },
          { ability_id: 'ab2', ability_name: '快手发布', ability_status: 'done', owner_task_id: 't2', id: 'g3', order_no: 1, feature_id: 'f3', note: 'other' },
        ],
      });
      const res = await (await req())(await makeApp()).get('/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const t1 = res.body.find((g) => g.owner_task_id === 't1');
      expect(t1.ability_id).toBe('ab1');
      expect(t1.ability_name).toBe('发抖音视频');
      expect(t1.ability_status).toBe('done');
      expect(t1.steps.map((s) => s.order_no)).toEqual([1, 2]);
      expect(t1.steps[0]).toEqual({ id: 'g1', order_no: 1, feature_id: 'f1', note: 'step1' });
      // SQL 走三表桥：golden_path → tasks(ability_id) → journey_features(journey_id)
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/JOIN\s+tasks/i);
      expect(sql).toMatch(/JOIN\s+journey_features/i);
      expect(sql).toMatch(/journey_id/);
    });

    it('status 参数过滤 journey_features.status，且非法值 400', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const ok = await (await req())(await makeApp()).get('/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths?status=done');
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual([]);
      expect(mockQuery.mock.calls[0][1]).toContain('done');

      const bad = await (await req())(await makeApp()).get('/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963/golden-paths?status=nonsense');
      expect(bad.status).toBe(400);
    });

    it('非法 journey_id uuid → 400 而非 500', async () => {
      mockQuery.mockRejectedValueOnce(Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' }));
      const res = await (await req())(await makeApp()).get('/api/brain/journeys/not-a-uuid/golden-paths');
      expect(res.status).toBe(400);
    });
  });

  // ── P0（A1 硬前置）: GET /invariants ──
  describe('GET /invariants', () => {
    it('读 decisions 表 category=invariant AND status=active，返回数组', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', category: 'invariant', level: 'area', topic: '[系统]租户隔离' }] });
      const res = await (await req())(await makeApp()).get('/api/brain/invariants');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toMatch(/FROM\s+decisions/i);
      expect(sql).toMatch(/category\s*=\s*'invariant'/i);
      expect(sql).toMatch(/status\s*=\s*'active'/i);
      expect(sql).not.toMatch(/decision_log/i);
    });

    it('level 过滤进 SQL 参数；非法 level → 400', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const ok = await (await req())(await makeApp()).get('/api/brain/invariants?level=area');
      expect(ok.status).toBe(200);
      expect(mockQuery.mock.calls[0][1]).toContain('area');

      const bad = await (await req())(await makeApp()).get('/api/brain/invariants?level=galaxy');
      expect(bad.status).toBe(400);
    });

    it('target_type + target_id 过滤进 SQL 参数', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await (await req())(await makeApp()).get('/api/brain/invariants?target_type=journey_feature&target_id=ab1');
      expect(res.status).toBe(200);
      expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['journey_feature', 'ab1']));
    });
  });
});
