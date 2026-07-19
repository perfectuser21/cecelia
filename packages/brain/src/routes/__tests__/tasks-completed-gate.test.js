/**
 * PATCH /api/brain/tasks/:task_id — completed 状态硬闸 [BEHAVIOR]
 *
 * 三案实证漏洞（2026-07-19）:
 *   Rule 1: review_required=true + review_status=pending → 422 REVIEW_NOT_APPROVED
 *   Rule 2: pr_url 非空 + pr_merged_at 为空 → 422 PR_NOT_MERGED
 *
 * task_type=harness_initiative && orchestrator=skill-relay 的任务不受 Rule1/2 约束——
 * 它们已有专属的"收账权收归"机制（finalizeHarnessTask，决策dc18d43d）独立核验外部真相
 * 并优雅降级为 200 accepted:false，本文件的硬闸只覆盖该机制不管的其余场景（07-19 回归
 * 实测发现：不排除会与 harness-completion-authority.test.js 的既有场景冲突，已改用
 * isSkillRelayHarness 显式让路，见下方对应测试）。
 *
 * 回归哨兵: 无 review_required / 无 pr_url 的普通任务仍可正常完成。
 */
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

  // ── skill-relay harness 任务让路给 finalizeHarnessTask，不受 Rule1/2 约束 ────

  it('harness_initiative(skill-relay) + review_required未过 → 不触发Rule1，交给finalizeHarnessTask放行', async () => {
    const finalizeMock = vi.fn().mockResolvedValue({ applies: true, allow: true });
    vi.doMock('../../lib/harness-finalize.js', () => ({ finalizeHarnessTask: finalizeMock }));
    vi.resetModules();
    mockQuery.mockReset();
    const { default: freshRouter } = await import('../tasks.js');
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use('/api/brain', freshRouter);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-hi-1', status: 'in_progress',
          task_type: 'harness_initiative', orchestrator: 'skill-relay',
          review_required_raw: 'true', review_status: 'pending',
          pr_url: null, pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(freshApp)
      .patch('/api/brain/tasks/task-hi-1')
      .send({ status: 'completed' });

    // 没有被本文件的硬闸拦下（不是422 REVIEW_NOT_APPROVED）——finalizeHarnessTask 是唯一权威
    expect(res.status).not.toBe(422);
    expect(finalizeMock).toHaveBeenCalled();
  });

  it('harness_initiative 但非 skill-relay orchestrator → 仍受 Rule1/2 约束（不是全体 harness_initiative 都豁免）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'task-hi-2', status: 'in_progress',
        task_type: 'harness_initiative', orchestrator: null,
        review_required_raw: 'true', review_status: 'pending',
        pr_url: null, pr_merged_at: null,
      }],
    });

    const res = await request(app)
      .patch('/api/brain/tasks/task-hi-2')
      .send({ status: 'completed' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('REVIEW_NOT_APPROVED');
  });

  it('harness_initiative(skill-relay) → in_progress 转换不受影响（只有 completed 会考虑豁免）', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-hi-3', status: 'queued',
          task_type: 'harness_initiative', review_required_raw: null, review_status: null,
          pr_url: null, pr_merged_at: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ status: 'in_progress', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-hi-3')
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
