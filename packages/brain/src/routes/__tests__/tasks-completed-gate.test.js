/**
 * PATCH /api/brain/tasks/:task_id — completed 状态硬闸 [BEHAVIOR]
 *
 * 三案实证漏洞（2026-07-19）:
 *   Rule 1: review_required=true + review_status=pending → 422 REVIEW_NOT_APPROVED
 *   Rule 2: pr_url 非空 + pr_merged_at 为空 → 422 PR_NOT_MERGED
 *   Rule 3: task_type=harness_initiative → 422 USE_HARNESS_COMPLETE
 *
 * 回归哨兵: 无 review_required / 无 pr_url / 非 harness_initiative 的普通任务仍可正常完成。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

describe('PATCH /api/brain/tasks/:task_id — completed 状态硬闸 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  // ── Rule 1: review_required=true + review_status=pending → 拒绝 ─────────────

  it('Rule1: review_required=true + review_status=pending → 422 REVIEW_NOT_APPROVED', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'task-rr-1', status: 'in_progress',
        task_type: 'dev', review_required_raw: 'true', review_status: 'pending',
        pr_url: null, pr_merged_at: null,
      }],
    });

    const res = await request(app)
      .patch('/api/brain/tasks/task-rr-1')
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('REVIEW_NOT_APPROVED');
    expect(res.body.current_review_status).toBe('pending');
  });

  it('Rule1: review_required=true + review_status=null → 422 REVIEW_NOT_APPROVED', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'task-rr-2', status: 'in_progress',
        task_type: 'dev', review_required_raw: 'true', review_status: null,
        pr_url: null, pr_merged_at: null,
      }],
    });

    const res = await request(app)
      .patch('/api/brain/tasks/task-rr-2')
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('REVIEW_NOT_APPROVED');
    expect(res.body.current_review_status).toBeNull();
  });

  it('Rule1: review_required=true + review_status=approved → 通过（写 completed）', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-rr-3', status: 'in_progress',
          task_type: 'dev', review_required_raw: 'true', review_status: 'approved',
          pr_url: null, pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-rr-3')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('Rule1: review_required=false → 无 review 门槛，可直接完成', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-rr-4', status: 'in_progress',
          task_type: 'dev', review_required_raw: 'false', review_status: 'pending',
          pr_url: null, pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-rr-4')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  // ── Rule 2: pr_url 非空 + pr_merged_at 为空 → 拒绝 ──────────────────────────

  it('Rule2: pr_url 已设置 + pr_merged_at 为 null → 422 PR_NOT_MERGED', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'task-pr-1', status: 'in_progress',
        task_type: 'dev', review_required_raw: null, review_status: null,
        pr_url: 'https://github.com/org/repo/pull/42', pr_merged_at: null,
      }],
    });

    const res = await request(app)
      .patch('/api/brain/tasks/task-pr-1')
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PR_NOT_MERGED');
    expect(res.body.pr_url).toBe('https://github.com/org/repo/pull/42');
  });

  it('Rule2: pr_url 已设置 + pr_merged_at 已填充 → 通过（写 completed）', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-pr-2', status: 'in_progress',
          task_type: 'dev', review_required_raw: null, review_status: null,
          pr_url: 'https://github.com/org/repo/pull/43', pr_merged_at: '2026-07-18T10:00:00Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-pr-2')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('Rule2: pr_url 为 null → 无 PR 门槛，可直接完成', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-pr-3', status: 'in_progress',
          task_type: 'dev', review_required_raw: null, review_status: null,
          pr_url: null, pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-pr-3')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  // ── Rule 3: harness_initiative → 必须走 /harness/complete ───────────────────

  it('Rule3: task_type=harness_initiative via 普通 PATCH → 422 USE_HARNESS_COMPLETE', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'task-hi-1', status: 'in_progress',
        task_type: 'harness_initiative', review_required_raw: null, review_status: null,
        pr_url: null, pr_merged_at: null,
      }],
    });

    const res = await request(app)
      .patch('/api/brain/tasks/task-hi-1')
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('USE_HARNESS_COMPLETE');
    expect(res.body.error).toContain('/harness/complete');
  });

  it('Rule3: harness_initiative → in_progress 仍然允许（只限 completed）', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-hi-2', status: 'queued',
          task_type: 'harness_initiative', review_required_raw: null, review_status: null,
          pr_url: null, pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'in_progress', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-hi-2')
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
  });

  // ── 回归哨兵: 普通 dev 任务（无 review_required、无 pr_url）仍可完成 ──────────

  it('回归哨兵: 普通 dev 任务（无任何门槛字段）→ 200 completed', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-dev-1', status: 'in_progress',
          task_type: 'dev', review_required_raw: null, review_status: null,
          pr_url: null, pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-dev-1')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('回归哨兵: completed→completed 幂等补写 result → 200（不触发硬闸）', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-idm-1', status: 'completed',
          task_type: 'harness_initiative', review_required_raw: 'true', review_status: 'pending',
          pr_url: 'https://github.com/org/repo/pull/99', pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-idm-1')
      .send({ status: 'completed', result: { pr_url: 'https://github.com/org/repo/pull/99' } });

    expect(res.status).toBe(200);
  });
});
