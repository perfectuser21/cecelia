import { describe, it, expect } from 'vitest';

// Generator 实现路径：sprints/w8-langgraph-v10/lib/pg-task-query.cjs
// 当前未实现 → import 阶段即失败 → Red 证据
// @ts-ignore — Red 阶段模块不存在
import {
  parseTaskRow,
  waitForStatus,
  fetchTaskById,
} from '../../lib/pg-task-query.cjs';

describe('Workstream 2 — wait/parse lib [BEHAVIOR]', () => {
  it('parseTaskRow() 把 PG 行解析成驼峰字段，缺字段时填 null', () => {
    const row = {
      id: 'abc',
      status: 'in_progress',
      task_type: 'harness_planner',
      logical_task_id: 'lid-1',
      completed_at: null,
    };
    const parsed = parseTaskRow(row);
    expect(parsed.id).toBe('abc');
    expect(parsed.status).toBe('in_progress');
    expect(parsed.taskType).toBe('harness_planner');
    expect(parsed.logicalTaskId).toBe('lid-1');
    expect(parsed.completedAt).toBeNull();

    const partial = parseTaskRow({ id: 'x', status: 'pending' });
    expect(partial.taskType).toBeNull();
    expect(partial.logicalTaskId).toBeNull();
  });

  it('waitForStatus() 在 fake pgClient 立即返回 target status 时立即 resolve', async () => {
    const fakePg = {
      query: async () => ({
        rows: [{ id: 'abc', status: 'completed', task_type: 'harness_initiative' }],
      }),
    };
    const start = Date.now();
    await expect(
      waitForStatus({ pgClient: fakePg, id: 'abc', target: 'completed', timeoutSeconds: 10 }),
    ).resolves.toMatchObject({ status: 'completed' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('waitForStatus() 在超时窗口内未达终态时抛 TimeoutError，不静默通过', async () => {
    const fakePg = {
      query: async () => ({ rows: [{ id: 'abc', status: 'in_progress', task_type: 'harness_initiative' }] }),
    };
    await expect(
      waitForStatus({
        pgClient: fakePg,
        id: 'abc',
        target: 'completed',
        timeoutSeconds: 1,
        pollIntervalMs: 100,
      }),
    ).rejects.toThrow(/timeout/i);
  });
});
