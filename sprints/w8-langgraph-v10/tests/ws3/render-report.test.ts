import { describe, it, expect, beforeAll } from 'vitest';

// Generator 实现路径：sprints/w8-langgraph-v10/lib/render-report.cjs
// 红阶段：动态 import 失败 → 每个 it() 在断言 importError 时失败 → numFailedTests == it 数
// 绿阶段：mod 非 null → 测试体跑过 → numFailedTests == 0
let mod: any = null;
let importError: Error | null = null;

beforeAll(async () => {
  try {
    // @ts-ignore — 红阶段模块不存在
    mod = await import('../../lib/render-report.cjs');
  } catch (e) {
    importError = e as Error;
  }
});

describe('Workstream 3 — render-report [BEHAVIOR]', () => {
  it('aggregatePhaseDurations() 按 task_type 分桶聚合 (created_at→completed_at) 耗时', () => {
    expect(importError, 'lib/render-report.cjs 必须存在并可加载').toBeNull();
    const { aggregatePhaseDurations } = mod;
    const t0 = new Date('2026-05-09T10:00:00Z');
    const t1 = new Date('2026-05-09T10:05:00Z');
    const t2 = new Date('2026-05-09T10:20:00Z');
    const rows = [
      { task_type: 'harness_planner', created_at: t0, completed_at: t1 },
      { task_type: 'harness_contract_proposer', created_at: t1, completed_at: t2 },
      { task_type: 'harness_contract_reviewer', created_at: t1, completed_at: t2 },
      { task_type: 'harness_generator', created_at: t1, completed_at: t2 },
      { task_type: 'harness_evaluator', created_at: t1, completed_at: t2 },
    ];
    const buckets = aggregatePhaseDurations(rows);
    expect(buckets.planner.totalSeconds).toBe(300);
    expect(buckets.contractGan.taskCount).toBe(2);
    expect(buckets.generator.taskCount).toBe(1);
    expect(buckets.evaluator.taskCount).toBe(1);
  });

  it('renderMarkdown() 输出含起止时间块 + 4 行阶段表 + 最终 SQL 输出，缺阶段时仍渲染 N/A', () => {
    expect(importError, 'lib/render-report.cjs 必须存在并可加载').toBeNull();
    const { renderMarkdown } = mod;
    const md = renderMarkdown({
      initiativeId: 'INI-XYZ',
      startedAt: '2026-05-09T10:00:00Z',
      completedAt: '2026-05-09T11:00:00Z',
      finalSqlOutput: 'INI-XYZ | completed | 2026-05-09 11:00:00',
      buckets: {
        planner: { totalSeconds: 300, taskCount: 1 },
        contractGan: { totalSeconds: null, taskCount: 0 },
        generator: { totalSeconds: 1800, taskCount: 3 },
        evaluator: { totalSeconds: 600, taskCount: 1 },
      },
      subTasks: [],
    });
    expect(md).toMatch(/^- 起始时间: /m);
    expect(md).toMatch(/^- 结束时间: /m);
    expect(md).toMatch(/\| Planner /);
    expect(md).toMatch(/\| Contract GAN /);
    expect(md).toMatch(/\| Generator /);
    expect(md).toMatch(/\| Evaluator /);
    expect(md).toContain('INI-XYZ');
    expect(md).toContain('completed');
    expect(md).toMatch(/N\/A|0/);
  });
});
