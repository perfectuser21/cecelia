/**
 * tasks-postdeploy-gate.test.js
 * 五环 Gate4: PATCH /tasks/:id status=completed 时的 postdeploy_check 校验门
 * 及 issue 219a9efc result 非空软检查。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));
vi.mock('../../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../lib/callback-postprocess.js', () => ({
  promoteRegressionOnHarnessMerged: vi.fn().mockResolvedValue(undefined),
}));

describe('PATCH /api/brain/tasks/:task_id — postdeploy_check gate [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockQuery.mockReset();
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  it('task 无 postdeploy_check → status=completed 通过（原行为不变）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'in_progress', task_type: 'dev', payload: {}, result: { pr_url: 'https://github.com/o/r/pull/1' } }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t1')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('task 有 postdeploy_check 且 result.postdeploy_check_passed=true → completed 通过', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 't2', status: 'in_progress', task_type: 'harness_initiative',
          payload: { postdeploy_check: 'curl http://localhost:5221/health' },
          result: { postdeploy_check_passed: true }
        }]
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t2')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('task 有 postdeploy_check 但 result.postdeploy_check_passed=false → 422 拒绝', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 't3', status: 'in_progress', task_type: 'dev',
        payload: { postdeploy_check: 'curl http://localhost:5221/health' },
        result: { postdeploy_check_passed: false }
      }]
    });

    const res = await request(app)
      .patch('/api/brain/tasks/t3')
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('POSTDEPLOY_CHECK_REQUIRED');
  });

  it('task 有 postdeploy_check 但 result 为空 → 422 拒绝（未执行检查）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 't4', status: 'in_progress', task_type: 'dev',
        payload: { postdeploy_check: 'curl http://localhost:5221/health' },
        result: {}
      }]
    });

    const res = await request(app)
      .patch('/api/brain/tasks/t4')
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('POSTDEPLOY_CHECK_REQUIRED');
  });

  it('task 有 postdeploy_check 但有 postdeploy_exemption → 豁免，completed 通过', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 't5', status: 'in_progress', task_type: 'dev',
          payload: {
            postdeploy_check: 'curl http://localhost:5221/health',
            postdeploy_exemption: 'docs-only'
          },
          result: {}
        }]
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t5')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('219a9efc: dev task 以空 result 标 completed → 200 + P2 告警（软检查不阻断）', async () => {
    const { raise } = await import('../../alerting.js');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't6', status: 'in_progress', task_type: 'dev', payload: {}, result: {} }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t6')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(raise).toHaveBeenCalledWith('P2', 'completed_empty_result', expect.stringContaining('t6'));
  });

  it('219a9efc: harness_initiative task 以非空 result 标 completed → 无 P2 告警', async () => {
    const { raise } = await import('../../alerting.js');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't7', status: 'in_progress', task_type: 'harness_initiative', payload: {}, result: { pr_url: 'https://github.com/o/r/pull/7' } }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t7')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(raise).not.toHaveBeenCalledWith('P2', 'completed_empty_result', expect.anything());
  });
});
