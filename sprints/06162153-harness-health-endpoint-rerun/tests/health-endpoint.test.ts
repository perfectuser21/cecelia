/**
 * health-endpoint.test.ts
 * 验证 GET /harness/initiative/:id/health 端点（Golden Path 健康裁决）
 *
 * 查询顺序约定（generator 必须遵守，单测据此 mock）：
 *   query 1 = initiative_runs（取 phase/started_at/completed_at/failure_reason，最新 1 条）
 *   query 2 = initiative_run_events（取 node/status/attempt/ts，按 ts 升序）
 *
 * TDD Red：端点未实现时路由返回 404 → 所有 200 断言 FAIL。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));

const { default: harnessRouter } = await import('../../../packages/brain/src/routes/harness.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/harness', harnessRouter);
  return app;
}

const ID = '00000000-0000-0000-0000-000000000abc';
const nowSec = () => Math.floor(Date.now() / 1000);

/** mock 两次查询：run 行 + 事件行 */
function mockRun(runRows: any[], eventRows: any[]) {
  mockPool.query
    .mockResolvedValueOnce({ rows: runRows })    // initiative_runs
    .mockResolvedValueOnce({ rows: eventRows }); // initiative_run_events
}

describe('GET /harness/initiative/:id/health [BEHAVIOR]', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('running：最近事件的进行中 run → state=running, healthy=true, last_node 取最新事件', async () => {
    mockRun(
      [{ phase: 'B_task_loop', started_at: new Date(), completed_at: null, failure_reason: null }],
      [{ node: 'generator', status: 'running', attempt: 1, ts: nowSec() - 60 }],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('running');
    expect(res.body.healthy).toBe(true);
    expect(res.body.last_node).toBe('generator');
    expect(res.body.stuck_minutes).toBeLessThan(15);
  });

  it('stuck：prep 反复重试、30 分钟前最后事件 → state=stuck, last_node=prep, retries=1, interrupts=2', async () => {
    mockRun(
      [{ phase: 'B_task_loop', started_at: new Date(), completed_at: null, failure_reason: null }],
      [
        { node: 'prep', status: 'failed', attempt: 1, ts: nowSec() - 2400 },
        { node: 'prep', status: 'failed', attempt: 2, ts: nowSec() - 1800 },
      ],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('stuck');
    expect(res.body.healthy).toBe(false);
    expect(res.body.last_node).toBe('prep');
    expect(res.body.retries).toBe(1);
    expect(res.body.interrupts).toBe(2);
    expect(res.body.stuck_minutes).toBeGreaterThanOrEqual(15);
    expect(res.body.stuck_minutes).toBeLessThan(60);
  });

  it('zombie：进行中但 120 分钟无事件 → state=zombie, healthy=false, stuck_minutes>=60', async () => {
    mockRun(
      [{ phase: 'A_contract', started_at: new Date(), completed_at: null, failure_reason: null }],
      [{ node: 'planner', status: 'running', attempt: 1, ts: nowSec() - 7200 }],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('zombie');
    expect(res.body.healthy).toBe(false);
    expect(res.body.stuck_minutes).toBeGreaterThanOrEqual(60);
  });

  it('completed：phase=done → state=completed, healthy=true', async () => {
    mockRun(
      [{ phase: 'done', started_at: new Date(), completed_at: new Date(), failure_reason: null }],
      [{ node: 'report', status: 'completed', attempt: 1, ts: nowSec() - 120 }],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('completed');
    expect(res.body.healthy).toBe(true);
  });

  it('failed：phase=failed → state=failed, healthy=false', async () => {
    mockRun(
      [{ phase: 'failed', started_at: new Date(), completed_at: null, failure_reason: 'eval FAIL x3' }],
      [{ node: 'evaluator', status: 'failed', attempt: 3, ts: nowSec() - 300 }],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('failed');
    expect(res.body.healthy).toBe(false);
  });

  it('no_data 边界：run 存在但无事件 → 200, state=no_data, last_node=null, 计数全 0（不 500）', async () => {
    mockRun(
      [{ phase: 'A_contract', started_at: new Date(), completed_at: null, failure_reason: null }],
      [],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('no_data');
    expect(res.body.last_node).toBeNull();
    expect(res.body.retries).toBe(0);
    expect(res.body.interrupts).toBe(0);
    expect(res.body.stuck_minutes).toBe(0);
    expect(typeof res.body.reason).toBe('string');
    expect(res.body.reason.length).toBeGreaterThan(0);
  });

  it('schema 完整性：顶层 keys 排序后完全等于 PRD 7 字段', async () => {
    mockRun(
      [{ phase: 'B_task_loop', started_at: new Date(), completed_at: null, failure_reason: null }],
      [{ node: 'generator', status: 'running', attempt: 1, ts: nowSec() - 60 }],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['healthy', 'interrupts', 'last_node', 'reason', 'retries', 'state', 'stuck_minutes'],
    );
  });

  it('禁用字段反向：不得含 status/node/health/message', async () => {
    mockRun(
      [{ phase: 'B_task_loop', started_at: new Date(), completed_at: null, failure_reason: null }],
      [{ node: 'generator', status: 'running', attempt: 1, ts: nowSec() - 60 }],
    );
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(200);
    for (const banned of ['status', 'node', 'health', 'message', 'data', 'result']) {
      expect(res.body).not.toHaveProperty(banned);
    }
  });

  it('非法 UUID → 400 + error(string)', async () => {
    const res = await request(app).get('/harness/initiative/not-a-uuid/health');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('合法但 initiative_runs 无记录 → 404 + error(string)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // initiative_runs 空
    const res = await request(app).get(`/harness/initiative/${ID}/health`);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });
});
