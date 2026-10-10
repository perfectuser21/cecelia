/**
 * 回归测试：GET /api/brain/tasks（status.js，生产实际命中的处理器）
 * 非法 status / limit 必须 400 且不查库；库错误不得透出 details。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const mockGetTopTasks = vi.hoisted(() => vi.fn());

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../focus.js', () => ({
  getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn(),
}));
vi.mock('../../tick.js', () => ({ getTickStatus: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../../routes/shared.js', () => ({
  getActivePolicy: vi.fn(), getWorkingMemory: vi.fn(), getTopTasks: mockGetTopTasks,
  getRecentDecisions: vi.fn(), IDEMPOTENCY_TTL: 0, ALLOWED_ACTIONS: [],
}));
vi.mock('../../nightly-orchestrator.js', () => ({ getNightlyOrchestratorStatus: vi.fn() }));
vi.mock('../../websocket.js', () => ({ default: {}, WS_EVENTS: {} }));

let app;

beforeAll(async () => {
  vi.resetModules();
  const { default: statusRouter } = await import('../../routes/status.js');
  app = express();
  app.use('/api/brain', statusRouter);
});

describe('生产任务列表的项目隔离与分页', () => {
  const projectId = '8386209b-ed0f-4f0f-a1f0-9ddf1bddbff6';
  beforeEach(() => { mockPool.query.mockReset(); mockGetTopTasks.mockReset(); });

  it('巡查项目两页绑定不同 offset，同时隔离项目和脚本类型', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'first', project_id: projectId }] });
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'second', project_id: projectId }] });
    const prefix = `/api/brain/tasks?project_id=${projectId}&task_type=script_run&limit=200`;
    const first = await request(app).get(`${prefix}&offset=0`);
    const second = await request(app).get(`${prefix}&offset=200`);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(first.body[0].id).not.toBe(second.body[0].id);
    const [sql, firstParams] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/project_id = \$\d+/);
    expect(sql).toMatch(/task_type = \$\d+/);
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC LIMIT \$\d+ OFFSET \$\d+/);
    expect(firstParams).toEqual(['script_run', projectId, 200, 0]);
    expect(mockPool.query.mock.calls[1][1]).toEqual(['script_run', projectId, 200, 200]);
    expect(mockGetTopTasks).not.toHaveBeenCalled();
  });

  it('只有 project_id 也使用项目查询，offset 缺省为 0', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'project-task', project_id: projectId }] });
    const res = await request(app).get(`/api/brain/tasks?project_id=${projectId}`);
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls[0][1]).toEqual([projectId, 100, 0]);
    expect(mockGetTopTasks).not.toHaveBeenCalled();
  });

  it.each(['-1', '2.5', 'abc', '1 OR 1=1', '9007199254740992'])('非法 offset=%s → 400 且不查库', async (offset) => {
    const res = await request(app).get(`/api/brain/tasks?task_type=script_run&offset=${encodeURIComponent(offset)}`);
    expect(res.status).toBe(400); expect(res.body.error).toBe('invalid_offset');
    expect(mockPool.query).not.toHaveBeenCalled(); expect(mockGetTopTasks).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', '', 'x%27%20OR%201%3D1', `${projectId}&project_id=${projectId}`])('非法 project_id=%s → 400 且不查库', async (project) => {
    const res = await request(app).get(`/api/brain/tasks?project_id=${project}&task_type=script_run`);
    expect(res.status).toBe(400); expect(res.body.error).toBe('invalid_project_id');
    expect(mockPool.query).not.toHaveBeenCalled(); expect(mockGetTopTasks).not.toHaveBeenCalled();
  });
});

describe('GET /api/brain/tasks 查询参数校验', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockGetTopTasks.mockReset();
  });

  it('status=bogus → 400 且不查库', async () => {
    const res = await request(app).get('/api/brain/tasks?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
    expect(res.body.allowed).toContain('queued');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it.each(['limit=abc', 'limit=-1', 'status=queued&limit=99999999999999999999'])(
    '%s → 400 invalid_limit 且不查库',
    async (qs) => {
      const res = await request(app).get(`/api/brain/tasks?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_limit');
      expect(res.body).not.toHaveProperty('details');
      expect(mockPool.query).not.toHaveBeenCalled();
      expect(mockGetTopTasks).not.toHaveBeenCalled();
    },
  );

  it('status=queued&limit=5 → 200，SQL 参数包含缺省 offset=0', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'queued' }] });
    const res = await request(app).get('/api/brain/tasks?status=queued&limit=5');
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['queued', 5, 0]);
  });

  it('无参数 → 200 数组，getTopTasks(100)', async () => {
    mockGetTopTasks.mockResolvedValueOnce([{ id: 't1' }]);
    const res = await request(app).get('/api/brain/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(mockGetTopTasks).toHaveBeenCalledWith(100);
  });

  it('库报错 → 500 且响应体无 details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPool.query.mockRejectedValueOnce(new Error('LIMIT must not be negative'));
    const res = await request(app).get('/api/brain/tasks?status=queued');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to get tasks' });
    expect(res.body).not.toHaveProperty('details');
  });
});
