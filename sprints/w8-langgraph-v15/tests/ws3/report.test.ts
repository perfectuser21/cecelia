// Workstream 3 — scripts/v15-report.mjs [BEHAVIOR]
// 目标：computeVerdict / extractFailureNode（含 R1 STUCK_QUEUED → dispatcher_pickup / R2 STALL@X → X）/ markdown 渲染。
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

  it('computeVerdict returns PASS when sub_tasks empty (absorption skipped 边界)', async () => {
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
    expect(mod.extractFailureNode(events, [])).toBe('evaluator_node');
  });

  it('extractFailureNode returns unknown_node when no events / failure_reason / error', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    expect(mod.extractFailureNode([], [])).toMatch(/^unknown_node/);
  });

  // === R1: timeline 含 STUCK_QUEUED → Failure Node = dispatcher_pickup ===
  it('extractFailureNode maps STUCK_QUEUED timeline entry → dispatcher_pickup', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    const timeline = [
      { ts: '2026-05-09T15:00:00Z', phase: 'STUCK_QUEUED' },
    ];
    expect(mod.extractFailureNode([], timeline)).toBe('dispatcher_pickup');
  });

  // === R2: timeline 含 STALL@<phase> → Failure Node = <phase> ===
  it('extractFailureNode maps STALL@<phase> timeline entry → <phase>', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    const timeline = [
      { ts: '2026-05-09T15:00:00Z', phase: 'A_contract' },
      { ts: '2026-05-09T15:11:00Z', phase: 'STALL@A_contract' },
    ];
    expect(mod.extractFailureNode([], timeline)).toBe('A_contract');
  });

  // timeline 信号 优先于 events（dispatcher_pickup 已经写出且更确定）
  it('extractFailureNode prefers timeline STUCK_QUEUED over later events', async () => {
    // @ts-expect-error: 脚本尚未实现
    const mod = await import('../../../../scripts/v15-report.mjs');
    const events = [
      { event_type: 'node_error', payload: { node: 'evaluator_node' }, created_at: '2026-05-09T15:05:00Z' },
    ];
    const timeline = [
      { ts: '2026-05-09T15:00:00Z', phase: 'STUCK_QUEUED' },
    ];
    expect(mod.extractFailureNode(events, timeline)).toBe('dispatcher_pickup');
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
