/**
 * callback-postprocess.test.js — 共享回调后处理管道配套测试
 * 背景:5c11 串行解锁曾只存在于 routes/execution.js,DB 直写路径(callback-processor)
 * 缺失导致串行链不解锁(2026-07-10 活性合同 T2→T3 实证)。本文件直测共享模块本体。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { serialUnlockNext, writeReviewResult } from '../callback-postprocess.js';

function makePool() {
  return { query: vi.fn() };
}

describe('serialUnlockNext(5c11 串行解锁)', () => {
  let pool;
  beforeEach(() => { pool = makePool(); });

  it('dev task seq=N 完成 → 解锁 seq=N+1 的 blocked task 并注入 prev_task_result', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ task_type: 'dev', project_id: 'p-1', goal_id: null, title: 'T2', payload: { sequence_order: 2 } }] })
      .mockResolvedValueOnce({ rows: [{ id: 'next-3', title: 'T3', payload: { sequence_order: 3, depends_on_prev: 'true' } }] })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    await serialUnlockNext('task-2', { summary: '四刀接合同' }, 'https://pr/3718', pool);
    const unlockCall = pool.query.mock.calls.find((c) => /SET status = 'queued'/.test(c[0]));
    expect(unlockCall).toBeTruthy();
    expect(unlockCall[1][1]).toBe('next-3');
    const payload = JSON.parse(unlockCall[1][0]);
    expect(payload.prev_task_result.task_id).toBe('task-2');
    expect(payload.prev_task_result.pr_url).toBe('https://pr/3718');
    expect(payload.prev_task_result.sequence_order).toBe(2);
  });

  it('非 dev / 无 sequence_order → no-op 不再查询', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ task_type: 'code_review', project_id: 'p-1', payload: {} }] });
    await serialUnlockNext('task-x', {}, null, pool);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('无下一个串行 task → 不发 UPDATE', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ task_type: 'dev', project_id: 'p-1', payload: { sequence_order: 6 } }] })
      .mockResolvedValueOnce({ rows: [] });
    await serialUnlockNext('task-6', {}, null, pool);
    const unlockCall = pool.query.mock.calls.find((c) => /SET status = 'queued'/.test(c[0]));
    expect(unlockCall).toBeUndefined();
  });
});

describe('writeReviewResult(5c8b)', () => {
  it('非审查类 task_type → no-op', async () => {
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rows: [{ task_type: 'dev', payload: {} }] });
    await writeReviewResult('task-d', { verdict: 'PASS' }, pool);
    const writeCall = pool.query.mock.calls.find((c) => /review_result/.test(c[0]));
    expect(writeCall).toBeUndefined();
  });
});

describe('writeReviewResult 不伪造审核通过', () => {
  function reviewPool(taskType = 'decomp_review') {
    const writes = [];
    return {
      writes,
      query: vi.fn(async (sql, params) => {
        if (sql.startsWith('SELECT task_type')) return { rows: [{ task_type: taskType, payload: { parent_task_id: 'parent' } }] };
        writes.push({ sql, text: params[0], taskId: params[1] });
        return { rows: [], rowCount: 1 };
      }),
    };
  }

  it.each([null, {}, { summary: '没有结论' }, { decision: '' }])('缺失结论 %j 不能伪造通过或覆盖原结果', async result => {
    const pool = reviewPool('spec_review');
    await writeReviewResult('child', result, pool);
    expect(pool.writes).toEqual([]);
  });

  it.each([
    [{ verdict: 'rejected' }, 'rejected'],
    [{ result: { verdict: 'needs_revision' } }, 'needs_revision'],
    [{ decision: 'PASS', verdict: 'rejected' }, 'rejected'],
  ])('旧审查明确 verdict %j 必须真实反映在自身和父任务', async (result, verdict) => {
    const pool = reviewPool();
    await writeReviewResult('child', result, pool);
    expect(pool.writes.map(w => w.taskId)).toEqual(['child', 'parent']);
    for (const write of pool.writes) {
      expect(write.text).toContain(`决定: ${verdict}`);
      expect(write.text).not.toContain('决定: PASS');
    }
  });

  it.each(['PASS', 'NEEDS_FIX', 'CRITICAL_BLOCK', 'TEST_BLOCK'])('现役代码审核 decision=%s 保持原意', async decision => {
    const pool = reviewPool('code_review');
    await writeReviewResult('child', { decision, summary: '实际审查' }, pool);
    expect(pool.writes.map(w => w.taskId)).toEqual(['child', 'parent']);
    expect(pool.writes[0].text).toContain(`决定: ${decision}`);
    expect(pool.writes[0].text).toContain('摘要: 实际审查');
  });
});
