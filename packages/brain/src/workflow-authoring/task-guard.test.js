import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query } }));
vi.mock('../lib/task-terminal.js', () => ({
  afterTerminalTransition: vi.fn().mockResolvedValue({}),
  isRelayTerminalStatus: (s) => ['completed', 'completed_no_pr'].includes(s),
  isTerminalStatus: (s) => ['completed', 'completed_no_pr', 'failed'].includes(s),
}));

let task;
const id = '11111111-1111-4111-8111-111111111111';
const app = express();
app.use(express.json());
beforeAll(async () => {
  const { default: tasks } = await import('../routes/tasks.js');
  const { registerTaskPatchRoute } = await import('../routes/task-task-patch.js');
  const { default: execution } = await import('../routes/execution.js');
  const { default: actions } = await import('../routes/actions.js');
  app.use('/api/brain', tasks);
  const nested = express.Router();
  registerTaskPatchRoute(nested, { pool: { query }, terminalStatuses: ['completed', 'failed'] });
  app.use('/nested', nested);
  app.use('/api/brain', execution);
  app.use('/api/brain', actions);
});
beforeEach(() => {
  task = { id, status: 'in_progress', task_type: 'research', payload: { workflow_authoring: true },
    result: { workflow_authoring: { stage: 'verify', outputs: {} } } };
  query.mockReset();
  query.mockImplementation(async (sql) => {
    if (/SELECT[\s\S]*FROM tasks/.test(sql)) return { rows: [task] };
    if (/UPDATE tasks/.test(sql)) return { rows: [{ ...task, updated_at: 'now' }] };
    return { rows: [] };
  });
});

describe('workflow authoring 通用任务写入口保护', () => {
  for (const url of [`/api/brain/tasks/${id}`, `/nested/${id}`]) {
    it(`${url} 拒绝保留状态字段伪造`, async () => {
      const res = await request(app).patch(url).send({ result: { workflow_authoring: { stage: 'completed' } } });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WORKFLOW_AUTHORING_RESERVED');
      expect(query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql))).toBe(false);
    });
    it.each(['completed', 'completed_no_pr'])(`${url} 未登记回读不得写 %s`, async (status) => {
      const res = await request(app).patch(url).send({ status });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WORKFLOW_AUTHORING_INCOMPLETE');
      expect(query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql))).toBe(false);
    });
    it(`${url} 完整登记后允许完成`, async () => {
      task.result.workflow_authoring = { stage: 'completed', outputs: { register: { readback_verified: true } } };
      const res = await request(app).patch(url).send({ status: 'completed', result: { summary: '真实回读完成' } });
      expect(res.status).toBe(200);
    });
    it.each([null, { stage: 'completed', outputs: { register: { readback_verified: false } } }])(
      `${url} 缺状态或未验真回读仍不能完成`, async (state) => {
        task.result.workflow_authoring = state;
        const res = await request(app).patch(url).send({ status: 'completed' });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('WORKFLOW_AUTHORING_INCOMPLETE');
      },
    );
    it(`${url} 未完成的管理流程仍可失败收账`, async () => {
      const res = await request(app).patch(url).send({ status: 'failed' });
      expect(res.status).toBe(200);
    });
    it(`${url} 普通任务沿用完成语义`, async () => {
      task.payload = {};
      task.result = {};
      const res = await request(app).patch(url).send({ status: 'completed' });
      expect(res.status).toBe(200);
    });
  }
  it('execution-callback 不允许伪造状态，并且不进入待重放队列', async () => {
    const res = await request(app).post('/api/brain/execution-callback').send({
      task_id: id, status: 'AI Done', result: { workflow_authoring: { stage: 'completed' } },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORKFLOW_AUTHORING_RESERVED');
    expect(query.mock.calls.some(([sql]) => /INSERT INTO callback_queue|UPDATE tasks/.test(sql))).toBe(false);
  });
  it('execution-callback 不允许通过正常回执提前完成管理流程', async () => {
    const res = await request(app).post('/api/brain/execution-callback').send({ task_id: id, status: 'AI Done' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORKFLOW_AUTHORING_INCOMPLETE');
    expect(query.mock.calls.some(([sql]) => /INSERT INTO callback_queue|UPDATE tasks/.test(sql))).toBe(false);
  });
  for (const [action, params] of [
    ['update-task', { task_id: id, status: 'completed' }],
    ['batch-update-tasks', { filter: { status: 'in_progress' }, update: { status: 'completed' } }],
  ]) {
    it(`${action} 同样不能提前完成管理任务`, async () => {
      const res = await request(app).post(`/api/brain/action/${action}`).send(params);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('六活动');
      expect(query.mock.calls.some(([sql]) => /UPDATE tasks/.test(sql))).toBe(false);
    });
  }
});
