/**
 * POST /api/brain/orchestrator/relay-runs/:initiative_id 路由单测
 *
 * 覆盖：
 * 1. 成功建档：新建 initiative_runs 行，返回 201 + 建档对象
 * 2. 幂等：该 initiative 已有 v2 未终态行 → 200 返回现有行，不重复 INSERT
 * 3. initiative_id 不存在 task → 404
 * 4. task_type 不是 harness_initiative → 404
 * 5. DB 失败 → 500
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../../db.js', () => ({ default: mockPool }));

let app;

async function buildApp() {
  const { default: router } = await import('../../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

beforeEach(async () => {
  vi.resetAllMocks();
  app = await buildApp();
});

const INITIATIVE_ID = 'aaaabbbb-1111-2222-3333-444455556666';

const HARNESS_TASK = {
  id: INITIATIVE_ID,
  task_type: 'harness_initiative',
  title: '测试 initiative',
};

const EXISTING_RUN = {
  id: randomUUID(),
  initiative_id: INITIATIVE_ID,
  phase: 'planning',
  orchestrator_version: 'v2',
  orchestrator_host: 'foreground',
  started_at: '2026-07-07T10:00:00.000Z',
  deadline_at: null,
};

describe('POST /api/brain/orchestrator/relay-runs/:initiative_id', () => {
  it('新建：task 存在 + 无现有 v2 run → INSERT + 201', async () => {
    // 1. task 存在且 task_type=harness_initiative
    mockPool.query.mockResolvedValueOnce({ rows: [HARNESS_TASK] });
    // 2. 无现有 v2 非终态 run
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    // 3. INSERT 返回新行
    const newRun = { ...EXISTING_RUN, id: randomUUID() };
    mockPool.query.mockResolvedValueOnce({ rows: [newRun] });

    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('initiative_id', INITIATIVE_ID);
    expect(res.body).toHaveProperty('orchestrator_version', 'v2');
    expect(res.body).toHaveProperty('orchestrator_host', 'foreground');
    expect(res.body).toHaveProperty('phase');
  });

  it('幂等：已有 v2 未终态行 → 200 + 返回现有行（不重 INSERT）', async () => {
    // 1. task 存在
    mockPool.query.mockResolvedValueOnce({ rows: [HARNESS_TASK] });
    // 2. 已有 v2 未终态 run
    mockPool.query.mockResolvedValueOnce({ rows: [EXISTING_RUN] });

    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('initiative_id', INITIATIVE_ID);
    // 只调用了两次 query（task 查询 + run 查询），没有 INSERT
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('initiative_id 无对应 task → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('task_type 不是 harness_initiative → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...HARNESS_TASK, task_type: 'dev' }] });

    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('DB 查询失败 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('INSERT 插入的 SQL 含 orchestrator_version=v2 + orchestrator_host=foreground', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [HARNESS_TASK] });
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query.mockResolvedValueOnce({ rows: [EXISTING_RUN] });

    await request(app)
      .post(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({});

    const insertCall = mockPool.query.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/i.test(sql)
    );
    expect(insertCall, 'INSERT 未调用').toBeTruthy();
    const [sql, params] = insertCall;
    expect(sql).toMatch(/orchestrator_version/);
    expect(sql).toMatch(/'v2'/);
    expect(sql).toMatch(/'foreground'/);
  });
});
