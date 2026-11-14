vi.mock('../../lib/task-completion-pr.js',()=>({verifyTaskCompletionPr:async task=>{if(task.pr_url&&!task.pr_merged_at)throw Object.assign(Error('PR_NOT_MERGED'),{code:'PR_NOT_MERGED',pr_url:task.pr_url});return null;}}));
/** 通用完成合同：审核approved，PR核验边界确认合并；无PR任务及终态幂等补写保留。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
const mockBlockTask = vi.fn().mockResolvedValue({ success: true });

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../../task-updater.js', () => ({
  blockTask: (...args) => mockBlockTask(...args),
}));

describe('PATCH /api/brain/tasks/:task_id — completed 状态硬闸 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockBlockTask.mockClear();
    mockBlockTask.mockResolvedValue({ success: true });
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

  // ── liveness probe 误杀回归（2026-07-19 实锤复现）────────────────────────
  // 根因链条：Rule1/2 拒绝(422)后任务原地留在 in_progress，headless 容器进程随后
  // 退出，executor.js:probeTaskLiveness()（WHERE status='in_progress'）把它当"进程
  // 消失=死了"，requeueTask 完整重新派发——产出多个重复 PR（dc69c8df 任务实测复现
  // 4106→4108→4112 三个几乎相同实现）。修法：拒绝的同时把任务转 blocked（task-updater.js
  // 现成的 blockTask，liveness probe 只扫 in_progress，不会再碰到它），PR 真正合并后
  // 由 engine-pr-watchdog 的终态 PATCH 重新尝试，此时 pr_merged_at 有值，Rule2 放行。

  it('Rule1拒绝(422)时应把任务转blocked，避免liveness probe误判死亡重跑', async () => {
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
    expect(mockBlockTask).toHaveBeenCalledWith('task-rr-1', expect.objectContaining({
      reason: 'review_not_approved',
    }));
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

  it('Rule2拒绝(422)时应把任务转blocked，避免liveness probe误判死亡重跑', async () => {
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
    expect(mockBlockTask).toHaveBeenCalledWith('task-pr-1', expect.objectContaining({
      reason: 'pr_not_merged',
    }));
  });

  it('正常完成(200)时不应调用blockTask', async () => {
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
    expect(mockBlockTask).not.toHaveBeenCalled();
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
          task_type: 'dev', review_required_raw: 'true', review_status: 'pending',
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
