/**
 * POST /api/brain/harness/staging-e2e — staging_e2e 派生端点（刀4 重构阶段1，决策 76ab76ea）。
 * 把 mergePrNode._spawnStagingE2eTask 的幂等建任务逻辑迁出图，供 controller merge 后调用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool, mockCreateTask } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockCreateTask: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

async function buildApp() {
  const { default: router } = await import('../routes/harness.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/harness', router);
  return a;
}

describe('POST /api/brain/harness/staging-e2e', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockCreateTask.mockReset();
    mockCreateTask.mockResolvedValue({ task: { id: 'staging-task' } });
  });

  it('缺 pr_url → 400，不 INSERT', async () => {
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({ initiative_id: 'i1' });
    expect(r.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('新建成功 → 200 {created:true}，payload 字段齐全', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({
      pr_url: 'https://github.com/o/r/pull/9', pr_branch: 'cp-x', sub_task_id: 't1',
      initiative_id: 'i1', journey_id: 'j1', base_repo: 'https://github.com/o/r.git', project_id: 'p1',
    });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const task = mockCreateTask.mock.calls[0][0];
    const payload = task.payload;
    expect(payload).toMatchObject({
      pr_url: 'https://github.com/o/r/pull/9', pr_branch: 'cp-x', sub_task_id: 't1',
      initiative_id: 'i1', journey_id: 'j1', base_repo: 'https://github.com/o/r.git', project_id: 'p1',
    });
    expect(task).toMatchObject({
      task_type: 'staging_e2e',
      source: 'child',
      source_id: 'staging-e2e:https://github.com/o/r/pull/9',
    });
  });

  it('幂等：同 pr_url 已存在（rowCount=0）→ 200 {created:false, reason:already_exists}', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'existing' }] });
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({ pr_url: 'https://github.com/o/r/pull/9' });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(false);
    expect(r.body.reason).toBe('already_exists');
  });

  it('可选字段缺省 → payload 用空串占位（不写 null）', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const app = await buildApp();
    await request(app).post('/api/brain/harness/staging-e2e').send({ pr_url: 'https://github.com/o/r/pull/9' });
    const payload = mockCreateTask.mock.calls[0][0].payload;
    expect(payload.pr_branch).toBe('');
    expect(payload.base_repo).toBe('');
    expect(payload.project_id).toBe('');
  });

  it('DB 异常 → 500，不抛未捕获', async () => {
    mockPool.query.mockRejectedValue(new Error('db down'));
    const app = await buildApp();
    const r = await request(app).post('/api/brain/harness/staging-e2e').send({ pr_url: 'https://github.com/o/r/pull/9' });
    expect(r.status).toBe(500);
  });
});
