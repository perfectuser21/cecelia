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

  it('persists the spec/code gate verdict field exactly, including FAIL', async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          task_type: 'code_review_gate',
          payload: { parent_task_id: 'parent-dev' },
        }],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await writeReviewResult('review-task', {
      verdict: 'FAIL',
      summary: 'blocker found',
      issues: [{ severity: 'blocker' }],
    }, pool);

    const writes = pool.query.mock.calls.filter((call) => (
      /UPDATE tasks SET review_result/.test(call[0])
    ));
    expect(writes).toHaveLength(2);
    expect(writes[0][1][0]).toContain('决定: FAIL');
    expect(writes[0][1][0]).toContain('摘要: blocker found');
    expect(writes[1][1][1]).toBe('parent-dev');
  });

  it('fails closed instead of writing PASS when a gate result has no verdict', async () => {
    const pool = makePool();
    pool.query
      .mockResolvedValueOnce({
        rows: [{ task_type: 'spec_review', payload: {} }],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await writeReviewResult('review-task', { summary: 'ambiguous' }, pool);

    const write = pool.query.mock.calls.find((call) => (
      /UPDATE tasks SET review_result/.test(call[0])
    ));
    expect(write[1][0]).toContain('决定: FAIL');
    expect(write[1][0]).not.toContain('决定: PASS');
  });
});
