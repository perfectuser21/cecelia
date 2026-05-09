// Workstream 3 — scripts/v15-report.mjs [BEHAVIOR]
// 目标：computeVerdict / extractFailureNode 行为正确，markdown 渲染含必要段头。
// Red 阶段：scripts/v15-report.mjs 不存在，import 必失败。

import { describe, it, expect } from 'vitest';

describe('Workstream 3 — v15 report [BEHAVIOR]', () => {
  it('computeVerdict returns PASS when all green', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    const v = mod.computeVerdict({
      task_status: 'completed',
      phase: 'done',
      sub_tasks: [{ status: 'completed' }, { status: 'completed' }],
    });
    expect(v).toBe('PASS');
  });

  it('computeVerdict returns FAIL when task failed', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    expect(mod.computeVerdict({
      task_status: 'failed', phase: 'done', sub_tasks: [{ status: 'completed' }],
    })).toBe('FAIL');
  });

  it('computeVerdict returns FAIL when phase not done', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    expect(mod.computeVerdict({
      task_status: 'completed', phase: 'failed', sub_tasks: [{ status: 'completed' }],
    })).toBe('FAIL');
  });

  it('computeVerdict returns FAIL when any sub-task not completed', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    expect(mod.computeVerdict({
      task_status: 'completed', phase: 'done', sub_tasks: [{ status: 'completed' }, { status: 'failed' }],
    })).toBe('FAIL');
  });

  it('computeVerdict returns PASS when sub_tasks empty (absorption skipped边界)', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    expect(mod.computeVerdict({
      task_status: 'completed', phase: 'done', sub_tasks: [],
    })).toBe('PASS');
  });

  it('extractFailureNode picks node from latest error event', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    const events = [
      { event_type: 'node_start', payload: { node: 'planner_node' }, created_at: '2026-05-09T15:00:00Z' },
      { event_type: 'node_error', payload: { node: 'evaluator_node' }, created_at: '2026-05-09T15:05:00Z' },
    ];
    expect(mod.extractFailureNode(events)).toBe('evaluator_node');
  });

  it('extractFailureNode returns unknown_node when no events / failure_reason / error', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    expect(mod.extractFailureNode([])).toMatch(/^unknown_node/);
  });

  it('renderReport produces markdown with all required section headers', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    const md = mod.renderReport({
      verdict: 'PASS',
      initiative_id: '11111111-2222-3333-4444-555555555555',
      task_status: 'completed',
      phase: 'done',
      sub_tasks: [],
      timeline: [],
      events: [],
      generated_at: '2026-05-09T15:30:00.000Z',
      trinity: { prd: true, contract: true, task_plan: true },
    });
    expect(md).toMatch(/^## Verdict: PASS$/m);
    expect(md).toMatch(/^## Sprint Trinity Check/m);
    expect(md).toMatch(/^## Generated at: 2026-05-09T15:30:00.000Z$/m);
    expect(md).toMatch(/^## Timeline/m);
    expect(md).toMatch(/^## Initiative State/m);
  });
});
