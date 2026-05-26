import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

const GRAPH_FILE = 'packages/brain/src/workflows/harness-initiative.graph.js';

describe('reportNode WS4 contract — step_timing / ws_issues / ws_costs', () => {
  const content = readFileSync(GRAPH_FILE, 'utf8');
  const reportNodeStart = content.indexOf('export async function reportNode');
  const reportNodeSlice = content.slice(reportNodeStart, reportNodeStart + 4000);

  it('reportNode 源码含三字段 step_timing / ws_issues / ws_costs', () => {
    expect(content).toContain('step_timing');
    expect(content).toContain('ws_issues');
    expect(content).toContain('ws_costs');
  });

  it('reportNode 含 report_content 键写入 tasks.result', () => {
    expect(content).toContain('report_content');
  });

  it('禁用字段（timings/timing/issues/costs/breakdown）不作为独立键名出现在 reportNode 上下文', () => {
    const banned = ['timings', 'timing', 'issues', 'costs', 'breakdown'];
    banned.forEach(f => {
      const rx = new RegExp(`["'\\x27]${f}["'\\x27]\\s*:`);
      expect(rx.test(reportNodeSlice), `禁用字段 "${f}" 不应作为 reportNode 键名`).toBe(false);
    });
  });

  it('ws_issues 元素含 feedback + ci_fail_type 字段逻辑', () => {
    expect(reportNodeSlice).toContain('feedback');
    expect(reportNodeSlice).toContain('ci_fail_type');
  });
});
