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

describe('GET /warroom/line/:id/command', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockCommandQueries({ lineName = 'Line 04' } = {}) {
    // 1. journey 本体
    mockPool.query.mockResolvedValueOnce({ rows: [{
      id: 'j1', notion_id: 'n1', name: lineName, description: '客户私域 AI 接管',
      status: 'active', maturity: 'growing',
    }] });
    // 2. notes (decisions)
    mockPool.query.mockResolvedValueOnce({ rows: [{
      id: 'd1', title: `军师决策[${lineName}] 暂停推进新 ability，优先修 bug`,
      content: '触发原因: CI 红了三次\n决策: 暂停推进\n自审: 正确', type: 'strategy', created_at: '2026-07-01T00:00:00Z',
    }] });
    // 3. journey_features
    mockPool.query.mockResolvedValueOnce({ rows: [
      { id: 'f1', name: '登录', kind: 'ability', status: 'done', group_name: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'f2', name: 'cookie 保活', kind: 'feature', status: 'in_progress', group_name: null, created_at: '2026-01-02T00:00:00Z' },
    ] });
    // 4. advancement_items
    mockPool.query.mockResolvedValueOnce({ rows: [{
      id: 'ai1', ability_id: 'f1', ability_name: '登录', title: '完成登录流', status: 'done', priority: 'P1', pr_url: null, created_at: '2026-06-01T00:00:00Z',
    }] });
    // 5. active tasks
    mockPool.query.mockResolvedValueOnce({ rows: [{
      id: 't1', title: 'fix cookie rotation', task_type: 'dev', status: 'in_progress', priority: 'P1',
      created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-02T00:00:00Z', pr_url: null,
    }] });
    // 6. open issues
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 7. recent runs（真列名 phase，handler 内映射为前端 status）
    mockPool.query.mockResolvedValueOnce({ rows: [
      { id: 'r1', phase: 'done', started_at: '2026-07-01T00:00:00Z', completed_at: '2026-07-01T01:00:00Z', created_at: '2026-07-01T00:00:00Z' },
    ] });
    // 8. health runs (30 days)（真列名 phase，done=成功）
    mockPool.query.mockResolvedValueOnce({ rows: [
      { id: 'r1', phase: 'done', created_at: '2026-07-01T00:00:00Z' },
      { id: 'r2', phase: 'failed', created_at: '2026-07-02T00:00:00Z' },
    ] });
    // 9. health pr count
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '3' }] });
  }

  it('正常返回 decisions / connections / health 三块', async () => {
    mockCommandQueries();
    const res = await request(app()).get('/warroom/line/j1/command');
    expect(res.status).toBe(200);

    // decisions
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.decisions[0].title).toContain('军师决策');

    // connections
    const { abilities, features, advancements, active_tasks } = res.body.connections;
    expect(abilities).toHaveLength(1);
    expect(abilities[0].name).toBe('登录');
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe('cookie 保活');
    expect(advancements).toHaveLength(1);
    expect(active_tasks).toHaveLength(1);

    // health
    expect(res.body.health.run_total).toBe(2);
    expect(res.body.health.run_success).toBe(1);
    expect(res.body.health.success_rate).toBe(50);
    expect(res.body.health.pr_count).toBe(3);
    expect(res.body.health.is_stopped).toBe(false);

    // line info
    expect(res.body.line.name).toBe('Line 04');
    expect(res.body.generated_at).toBeDefined();
  });

  it('journey 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app()).get('/warroom/line/bad-id/command');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('notes 表查询失败 → 优雅降级（decisions=[],其余正常）', async () => {
    // journey
    mockPool.query.mockResolvedValueOnce({ rows: [{
      id: 'j1', notion_id: null, name: 'Line 04', description: null, status: 'active', maturity: null,
    }] });
    // notes 查询失败
    mockPool.query.mockRejectedValueOnce(new Error('notes table missing'));
    // journey_features
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // advancement_items
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // active tasks
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // open issues
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // recent runs
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // health runs
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // health pr count
    mockPool.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const res = await request(app()).get('/warroom/line/j1/command');
    expect(res.status).toBe(200);
    expect(res.body.decisions).toEqual([]);
    expect(res.body.connections.abilities).toEqual([]);
  });
});
