/**
 * routes/warroom.test.js — 战情室 feed API 集成测试（mock pool）
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../warroom.js');
  router = mod.default;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/warroom', router);
  return a;
}

describe('GET /warroom/feed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('聚合任务 → areas + stats 结构', async () => {
    mockPool.query
      // tasks
      .mockResolvedValueOnce({ rows: [
        { id: 'a', task_type: 'harness_initiative', status: 'completed', title: 'brain x',
          created_at: '2026-06-02T01:00:00Z', completed_at: '2026-06-02T02:00:00Z',
          pr_url: 'http://pr/1', payload: { base_repo: 'cecelia.git' } },
        { id: 'b', task_type: 'harness_initiative', status: 'failed', title: 'iLink 通道',
          created_at: '2026-06-02T00:00:00Z',
          payload: { base_repo: 'zenithjoy-workspace.git', journey_id: 'j1' } },
      ] })
      // journeys
      .mockResolvedValueOnce({ rows: [{ id: 'j1', notion_id: null, name: '客户私域 AI 接管' }] });

    const res = await request(app()).get('/warroom/feed');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    // 两个 area
    const cecelia = res.body.areas.find((a) => a.areaKey === 'cecelia');
    const zj = res.body.areas.find((a) => a.areaKey === 'zenithjoy');
    expect(cecelia.count).toBe(1);
    expect(zj.count).toBe(1);
    expect(zj.groups[0].groupName).toBe('客户私域 AI 接管');
    // stats
    expect(res.body.stats).toHaveProperty('active');
    expect(res.body.stats).toHaveProperty('failed_today');
  });

  it('空表 → areas:[] 不报错', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })   // tasks
      .mockResolvedValueOnce({ rows: [] });  // journeys
    const res = await request(app()).get('/warroom/feed');
    expect(res.status).toBe(200);
    expect(res.body.areas).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('active harness 查 events 算进度', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [
        { id: 'h1', task_type: 'harness_initiative', status: 'in_progress', title: 'x',
          created_at: '2026-06-02T01:00:00Z', started_at: '2026-06-02T01:00:00Z',
          payload: { base_repo: 'cecelia.git' } },
      ] })
      .mockResolvedValueOnce({ rows: [] })  // journeys
      .mockResolvedValueOnce({ rows: [{ initiative_id: 'h1', node: 'ganLoop' }] }); // events

    const res = await request(app()).get('/warroom/feed');
    expect(res.status).toBe(200);
    const task = res.body.areas[0].groups[0].tasks[0];
    expect(task.progress_pct).toBe(40);
    expect(task.current_node).toBe('ganLoop');
  });

  it('DB 异常 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app()).get('/warroom/feed');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/db down/);
  });
});
