import { describe, it, expect, beforeAll } from 'vitest';

// Generator 实现路径：
//   - sprints/w8-langgraph-v10/lib/parse-task-row.cjs（导出 parseTaskRow）
//   - sprints/w8-langgraph-v10/lib/pg-task-query.cjs（导出 fetchTaskById / waitForStatus；可 re-export parseTaskRow）
// 红阶段：两个动态 import 失败 → 每个 it() 在断言 importError 时失败 → numFailedTests == it 数
// 绿阶段：两个 lib 都加载成功 → 测试体跑过 → numFailedTests == 0
let parseMod: any = null;
let queryMod: any = null;
let importError: Error | null = null;

beforeAll(async () => {
  try {
    // @ts-ignore — 红阶段模块不存在
    parseMod = await import('../../lib/parse-task-row.cjs');
    // @ts-ignore — 红阶段模块不存在
    queryMod = await import('../../lib/pg-task-query.cjs');
  } catch (e) {
    importError = e as Error;
  }
});

describe('Workstream 2 — wait/parse lib [BEHAVIOR]', () => {
  it('parseTaskRow() 把 PG 行解析成驼峰字段，缺字段时填 null', () => {
    expect(importError, 'lib/parse-task-row.cjs 必须存在并可加载').toBeNull();
    const { parseTaskRow } = parseMod;
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
    expect(importError, 'lib/pg-task-query.cjs 必须存在并可加载').toBeNull();
    const { waitForStatus } = queryMod;
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
    expect(importError, 'lib/pg-task-query.cjs 必须存在并可加载').toBeNull();
    const { waitForStatus } = queryMod;
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
