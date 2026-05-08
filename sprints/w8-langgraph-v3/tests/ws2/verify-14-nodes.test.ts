import { describe, it, expect } from 'vitest';

// @ts-expect-error: lib not yet implemented (red phase)
import * as nodeReport from '../../../harness-acceptance-v3/lib/14-nodes-report.mjs';

const ALL_14 = [
  'prep', 'planner', 'parsePrd', 'ganLoop', 'inferTaskPlan', 'dbUpsert',
  'pick_sub_task', 'run_sub_task', 'evaluate', 'advance', 'retry',
  'terminal_fail', 'final_evaluate', 'report',
];

describe('Workstream 2 — 14 节点轮询与报告 [BEHAVIOR]', () => {
  it('renderNodeReport() 输入 14 节点齐全的 events 时输出 nodes 字段恰好 14 个 key', () => {
    const events = ALL_14.map((name) => ({
      payload: { node_name: name },
      created_at: new Date('2026-05-07T12:00:00Z').toISOString(),
    }));
    const report = nodeReport.renderNodeReport(events);
    expect(Object.keys(report.nodes)).toHaveLength(14);
    for (const name of ALL_14) {
      expect(report.nodes[name].count).toBeGreaterThanOrEqual(1);
    }
  });

  it('renderNodeReport() 输入缺失节点时，对应 key 标 count: 0', () => {
    const partial = ALL_14.slice(0, 10).map((name) => ({
      payload: { node_name: name },
      created_at: new Date().toISOString(),
    }));
    const report = nodeReport.renderNodeReport(partial);
    for (const name of ALL_14.slice(10)) {
      expect(report.nodes[name].count).toBe(0);
    }
  });

  it('pollAndReport() 在 deadline 之前返回 fulfilled，超过 deadline 返回 timeout error', async () => {
    let now = 0;
    const clock = { now: () => now };
    const fakeQuery = async () => []; // 永远空，触发 timeout
    const result = await nodeReport.pollAndReport({
      taskId: 't1',
      deadlineMs: 1000,
      pollIntervalMs: 100,
      clock: { ...clock, advance: () => { now += 100; } },
      query: fakeQuery,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timeout/i);
  });
});
