/**
 * renderReportContract.test.ts — Sprint 产物契约 → Markdown 纯渲染逻辑测试
 *
 * 闭环边界「展示」读取者①：把 reportNode 写入的契约对象（sprint-result-contract.js）
 * 渲染成 Report tab 可读的 Markdown。验证至少七类字段全部进入输出：
 *   verdict / change_summary / next_action / total_cost / node_telemetry 表 /
 *   发现四类 / failed_scenarios。
 */

import { describe, it, expect } from 'vitest';
import { renderReportContract } from '../lifecycle';

function sampleContract() {
  return {
    contract_version: 1,
    initiative_id: 'pipe-1',
    verdict: 'PASS',
    change_summary: '加了 X 功能并修了 Y',
    next_action: '继续推进 Z',
    produced_assets: { skills: ['skill-a'], tests: ['t1.test.ts'], decisions: ['dec-1'] },
    learning_ref: 'docs/learnings/cp-xxx.md',
    incidental_bugs: ['路上撞见 bug A'],
    improvement_items: ['改进项 B'],
    linked_issues: ['ISSUE-123'],
    open_issues_with_learnings: ['未解决 issue C'],
    failed_scenarios: ['场景甲挂了'],
    node_telemetry: [
      { node: 'proposer', start_ts: '2026-06-20T10:00:00Z', end_ts: '2026-06-20T10:05:00Z', tokens: 1200, cost: 0.42 },
      { node: 'generator', start_ts: '2026-06-20T10:05:00Z', end_ts: null, tokens: null, cost: null },
    ],
    total_tokens: 1200,
    total_cost: 1.23,
    sub_tasks: [],
    ws_issues: [],
    ws_costs: [],
    completed_at: '2026-06-20T10:10:00Z',
  };
}

describe('renderReportContract', () => {
  it('null/非对象输入 → 返回 null（让上层走未到该步占位）', () => {
    expect(renderReportContract(null)).toBeNull();
    expect(renderReportContract(undefined)).toBeNull();
    expect(renderReportContract('not-an-object')).toBeNull();
  });

  it('verdict / change_summary / next_action 进入输出', () => {
    const md = renderReportContract(sampleContract())!;
    expect(md).toContain('PASS');
    expect(md).toContain('加了 X 功能并修了 Y');
    expect(md).toContain('继续推进 Z');
  });

  it('total_cost 渲染为美元金额', () => {
    const md = renderReportContract(sampleContract())!;
    expect(md).toContain('1.23');
  });

  it('node_telemetry 渲染为 Markdown 表格（含表头与每个节点名）', () => {
    const md = renderReportContract(sampleContract())!;
    // Markdown 表格分隔行
    expect(md).toMatch(/\|\s*-+\s*\|/);
    expect(md).toContain('proposer');
    expect(md).toContain('generator');
    expect(md).toContain('1200'); // tokens
  });

  it('failed_scenarios 进入输出', () => {
    const md = renderReportContract(sampleContract())!;
    expect(md).toContain('场景甲挂了');
  });

  it('发现四类全部进入输出', () => {
    const md = renderReportContract(sampleContract())!;
    expect(md).toContain('路上撞见 bug A');   // incidental_bugs
    expect(md).toContain('改进项 B');          // improvement_items
    expect(md).toContain('ISSUE-123');         // linked_issues
    expect(md).toContain('未解决 issue C');    // open_issues_with_learnings
  });

  it('缺字段不抛错，空数组段不报错', () => {
    const minimal = { verdict: 'FAIL' };
    expect(() => renderReportContract(minimal)).not.toThrow();
    const md = renderReportContract(minimal)!;
    expect(md).toContain('FAIL');
  });

  it('FAIL + failed_scenarios 渲染出失败场景列表', () => {
    const c = { ...sampleContract(), verdict: 'FAIL', failed_scenarios: ['登录场景超时', '发布场景 404'] };
    const md = renderReportContract(c)!;
    expect(md).toContain('登录场景超时');
    expect(md).toContain('发布场景 404');
  });
});
