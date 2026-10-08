import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), route: vi.fn(), trigger: vi.fn(), available: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../../executor.js', async (original) => ({
  ...await original(), triggerCeceliaRun: mocks.trigger, checkCeceliaRunAvailable: mocks.available,
}));
vi.mock('../../dispatcher.js', async (original) => ({ ...await original(), dispatchQiumiTask: mocks.route }));
vi.mock('../../anchor-check.js', () => ({ checkAnchor: () => ({ blocked: false }) }));
vi.mock('../../lib/manual-dispatch-device-gate.js', () => ({
  checkDeviceLockForManualDispatch: async () => ({ pass: true, acquired: false }),
  releaseDeviceLockNonFatal: vi.fn(),
}));

describe('qiumi-manual-dispatch：手机单任务派发与 coding Bridge 分离', () => {
  let app;
  let task;
  beforeEach(async () => {
    vi.clearAllMocks();
    task = { id: 'phone-task', title: '只读巡检', task_type: 'qiumi_task', status: 'queued', payload: {}, claimed_by: null };
    mocks.query.mockImplementation(async (sql, args = []) => {
      if (sql.includes('SELECT * FROM tasks')) return { rows: [structuredClone(task)] };
      if (sql.includes('UPDATE tasks')) {
        if (sql.includes("AND claimed_by IS NULL") && (task.status !== 'queued' || task.claimed_by)) return { rows: [] };
        if (sql.includes('AND claimed_by = $2') && task.claimed_by !== args[1]) return { rows: [] };
        if (sql.includes('claimed_by = $2')) task.claimed_by = args[1];
        if (sql.includes("status = 'in_progress'") || args[0] === 'in_progress') task.status = 'in_progress';
        if (sql.includes('claimed_by = NULL')) task.claimed_by = null;
        if (sql.includes('dispatch_uncertain')) task.result = { dispatch_uncertain: JSON.parse(args[2]) };
        return { rows: [structuredClone(task)] };
      }
      return { rows: [] };
    });
    mocks.available.mockResolvedValue({ available: false, error: 'Bridge not running' });
    mocks.route.mockImplementation(async () => {
      expect(task.status).toBe('queued');
      expect(task.claimed_by).toBeTruthy();
      task.payload = { run_id: 'qiumi-fixed-run', qiumi_department: 'skill-factory', qiumi_route: {} };
      return { outcome: 'proceed' };
    });
    mocks.trigger.mockImplementation(async (routed) => ({
      success: Boolean(routed.payload?.run_id), runId: routed.payload?.run_id, error: 'missing run_id/department',
    }));
    app = express(); app.use(express.json());
    app.use('/api/brain', (await import('../tasks.js')).default);
    app.use('/api/brain', (await import('../execution.js')).default);
  });

  for (const endpoint of ['task', 'dispatch-now']) {
    const dispatch = () => endpoint === 'task'
      ? request(app).post('/api/brain/tasks/phone-task/dispatch').send({})
      : request(app).post('/api/brain/dispatch-now').send({ task_id: 'phone-task' });
    it(`${endpoint}：Bridge 离线仍先路由手机并使用固定 run_id`, async () => {
      const r = await dispatch();
      expect(r.status).toBe(202);
      expect(mocks.available).not.toHaveBeenCalled();
      expect(mocks.route).toHaveBeenCalledOnce();
      expect(mocks.trigger).toHaveBeenCalledOnce();
      expect(mocks.trigger.mock.calls[0][0].payload.run_id).toBe('qiumi-fixed-run');
    });
    it(`${endpoint}：已被其他执行体认领不再派发`, async () => {
      task.claimed_by = 'another-owner';
      const r = await dispatch();
      expect(r.status).toBe(409);
      expect(mocks.route).not.toHaveBeenCalled();
      expect(mocks.trigger).not.toHaveBeenCalled();
      expect(task.claimed_by).toBe('another-owner');
    });
  }

  it('两个入口同时派同一任务，只认领并启动一次', async () => {
    const replies = await Promise.all([
      request(app).post('/api/brain/tasks/phone-task/dispatch').send({}),
      request(app).post('/api/brain/dispatch-now').send({ task_id: 'phone-task' }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(mocks.trigger).toHaveBeenCalledOnce();
  });

  it.each(['qiumi_routed_device', 'qiumi_device_unresolved', 'qiumi_route_failed'])('路由 %s 不启动 Agent 或复活任务', async (reason) => {
    mocks.route.mockImplementation(async () => {
      task.status = reason === 'qiumi_route_failed' ? 'failed' : 'blocked';
      task.claimed_by = null;
      return { outcome: 'return', result: { reason } };
    });
    const r = await request(app).post('/api/brain/tasks/phone-task/dispatch').send({});
    expect(r.status).toBe(reason === 'qiumi_routed_device' ? 202 : 422);
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(task.status).toBe(reason === 'qiumi_route_failed' ? 'failed' : 'blocked');
  });

  it('路由中人工急停，不能重新标为运行或启动', async () => {
    mocks.route.mockImplementation(async () => {
      task.status = 'cancelled'; task.claimed_by = null;
      return { outcome: 'proceed' };
    });
    const r = await request(app).post('/api/brain/tasks/phone-task/dispatch').send({});
    expect(r.status).toBe(409);
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(task.status).toBe('cancelled');
  });

  it('远端接受后写库抛错，保留运行状态和原 run_id，重复请求409', async () => {
    mocks.trigger.mockRejectedValue(new Error('DB unavailable after DISPATCHED'));
    const r = await request(app).post('/api/brain/tasks/phone-task/dispatch').send({});
    expect(r.status).toBe(202);
    expect(r.body.execution_state).toBe('unknown');
    expect(r.body.run_id).toBe('qiumi-fixed-run');
    expect(task.result.dispatch_uncertain.message).toContain('原运行');
    expect(task.status).toBe('in_progress');
    expect((await request(app).post('/api/brain/tasks/phone-task/dispatch').send({})).status).toBe(409);
    expect(mocks.trigger).toHaveBeenCalledOnce();
  });

  it('SSH 响应不确定，保留运行交结果收割，不能回队重复派单', async () => {
    mocks.trigger.mockResolvedValue({ success: false, dispatchUncertain: true, reason: 'openclaw_agent_spawn_failed', error: 'SSH timeout' });
    const r = await request(app).post('/api/brain/tasks/phone-task/dispatch').send({});
    expect(r.status).toBe(202);
    expect(r.body.execution_state).toBe('unknown');
    expect(task.status).toBe('in_progress');
    expect(task.payload.run_id).toBe('qiumi-fixed-run');
  });

  it('coding 任务仍受 Bridge 可用性检查', async () => {
    task.task_type = 'dev';
    const r = await request(app).post('/api/brain/tasks/phone-task/dispatch').send({});
    expect(r.status).toBe(503);
    expect(mocks.available).toHaveBeenCalledOnce();
    expect(mocks.route).not.toHaveBeenCalled();
  });
});
