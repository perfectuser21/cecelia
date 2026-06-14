/**
 * harness-initiative-health.test.ts — TDD Red
 *
 * 守护 GET /api/brain/harness/initiative/:id/health 健康裁决端点。
 * 路由未实现时：supertest 收到 404 → 全部断言失败（真红）。
 *
 * 数据源（纯只读两表）：
 *   initiative_runs（最新 run 的 phase）+ initiative_run_events（node/status/attempt/ts BIGINT 秒）
 * state 阈值对齐 harness-watchdog：stuck>=10min / zombie>=20min。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query: mockQuery } }));

const nowSec = () => Math.floor(Date.now() / 1000);

/** 按 SQL 文本路由 mock：命中 initiative_run_events 返回 events，否则返回 run */
function mockTables({ run, events }: { run: any[]; events: any[] }) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (/initiative_run_events/i.test(sql)) return { rows: events };
    return { rows: run };
  });
}

let app: any;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  app = express();
  app.use(express.json());
  const { default: harnessRouter } = await import('../../../packages/brain/src/routes/harness.js');
  app.use('/api/brain/harness', harnessRouter);
});

const VALID = '4225330d-6ff8-42ed-8eb1-d152be920b3b';

describe('GET /api/brain/harness/initiative/:id/health', () => {
  it('健康在跑（新鲜 event）→ 200 state=healthy healthy=true last_node=prep', async () => {
    mockTables({
      run: [{ phase: 'B_task_loop', started_at: new Date().toISOString() }],
      events: [{ node: 'prep', status: 'running', attempt: 1, ts: nowSec() }],
    });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.healthy).toBe(true);
    expect(res.body.state).toBe('healthy');
    expect(res.body.last_node).toBe('prep');
    expect(res.body.stuck_minutes).toBeLessThan(10);
  });

  it('卡 prep 反复重试（15min 前）→ state=stuck retries=2 interrupts=2 stuck_minutes>=10', async () => {
    const old = nowSec() - 900;
    mockTables({
      run: [{ phase: 'B_task_loop', started_at: new Date().toISOString() }],
      events: [
        { node: 'prep', status: 'failed', attempt: 1, ts: old - 100 },
        { node: 'prep', status: 'failed', attempt: 2, ts: old - 50 },
        { node: 'prep', status: 'running', attempt: 3, ts: old },
      ],
    });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('stuck');
    expect(res.body.healthy).toBe(false);
    expect(res.body.last_node).toBe('prep');
    expect(res.body.retries).toBe(2);
    expect(res.body.interrupts).toBe(2);
    expect(res.body.stuck_minutes).toBeGreaterThanOrEqual(10);
    expect(res.body.stuck_minutes).toBeLessThan(20);
  });

  it('僵尸（25min 前）→ state=zombie stuck_minutes>=20', async () => {
    const dead = nowSec() - 1500;
    mockTables({
      run: [{ phase: 'B_task_loop', started_at: new Date().toISOString() }],
      events: [{ node: 'generate', status: 'running', attempt: 1, ts: dead }],
    });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(res.body.state).toBe('zombie');
    expect(res.body.healthy).toBe(false);
    expect(res.body.stuck_minutes).toBeGreaterThanOrEqual(20);
  });

  it('已失败 run → state=failed healthy=false', async () => {
    mockTables({ run: [{ phase: 'failed', started_at: new Date().toISOString() }], events: [] });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('failed');
    expect(res.body.healthy).toBe(false);
  });

  it('已完成 run → state=completed healthy=true stuck_minutes=0', async () => {
    mockTables({ run: [{ phase: 'done', started_at: new Date().toISOString() }], events: [] });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(res.body.state).toBe('completed');
    expect(res.body.healthy).toBe(true);
    expect(res.body.stuck_minutes).toBe(0);
  });

  it('无 events → retries/interrupts=0 last_node=null 不报错', async () => {
    mockTables({ run: [{ phase: 'B_task_loop', started_at: new Date().toISOString() }], events: [] });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.retries).toBe(0);
    expect(res.body.interrupts).toBe(0);
    expect(res.body.last_node).toBeNull();
  });

  it('响应 schema 键恰好 8 个', async () => {
    mockTables({ run: [{ phase: 'done', started_at: new Date().toISOString() }], events: [] });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(Object.keys(res.body).sort()).toEqual(
      ['healthy', 'initiative_id', 'interrupts', 'last_node', 'reason', 'retries', 'state', 'stuck_minutes']
    );
  });

  it('非法 UUID → 400 带 error 字符串（不进 DB 查询）', async () => {
    const res = await request(app).get('/api/brain/harness/initiative/not-a-uuid/health');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('合法但不存在的 UUID → 404 带 error 字符串', async () => {
    mockTables({ run: [], events: [] });
    const res = await request(app).get(`/api/brain/harness/initiative/${VALID}/health`);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });
});
