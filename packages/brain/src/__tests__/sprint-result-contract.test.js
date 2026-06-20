import { describe, it, expect } from 'vitest';
import { buildSprintResultContract, validateSprintResultContract, SPRINT_RESULT_CONTRACT_VERSION } from '../sprint-result-contract.js';

describe('buildSprintResultContract', () => {
  it('全量 input → 四段齐全 + 映射正确', () => {
    const c = buildSprintResultContract({
      initiativeId: 'init-1', verdict: 'PASS', failedScenarios: [],
      subTasks: [{ id: 'ws1', status: 'merged' }],
      stepTiming: [{ node: 'planner', started_at: '2026-06-20T00:00:00.000Z', duration_ms: 1000 }],
      wsIssues: [], wsCosts: [{ ws_id: 'ws1', cost_usd: 0.5 }], costUsd: 0.5,
      completedAt: '2026-06-20T00:10:00.000Z',
    });
    expect(c.contract_version).toBe(SPRINT_RESULT_CONTRACT_VERSION);
    expect(c.verdict).toBe('PASS');
    expect(c.total_cost).toBe(0.5);
    expect(c.node_telemetry[0]).toMatchObject({ node: 'planner', start_ts: '2026-06-20T00:00:00.000Z', end_ts: '2026-06-20T00:00:01.000Z', tokens: null, cost: null });
    expect(c.produced_assets).toEqual({ skills: [], tests: [], decisions: [] });
    expect(validateSprintResultContract(c)).toBe(true);
  });

  it('空 input → stub 空默认 + 不抛', () => {
    const c = buildSprintResultContract();
    expect(c.verdict).toBeNull();
    expect(c.failed_scenarios).toEqual([]);
    expect(c.incidental_bugs).toEqual([]);
    expect(c.improvement_items).toEqual([]);
    expect(c.linked_issues).toEqual([]);
    expect(c.open_issues_with_learnings).toEqual([]);
    expect(c.node_telemetry).toEqual([]);
    expect(c.total_cost).toBe(0);
    expect(c.total_tokens).toBeNull();
    expect(c.change_summary).toBeNull();
    expect(c.next_action).toBeNull();
    expect(c.learning_ref).toBeNull();
    expect(validateSprintResultContract(c)).toBe(true);
  });

  it('stepTiming 缺 duration_ms → end_ts=null 不抛', () => {
    const c = buildSprintResultContract({ stepTiming: [{ node: 'gan', started_at: '2026-06-20T00:00:00.000Z' }] });
    expect(c.node_telemetry[0].end_ts).toBeNull();
    expect(c.node_telemetry[0].start_ts).toBe('2026-06-20T00:00:00.000Z');
  });
});

describe('validateSprintResultContract', () => {
  it('合法契约通过', () => { expect(validateSprintResultContract(buildSprintResultContract())).toBe(true); });
  it('非对象抛', () => { expect(() => validateSprintResultContract(null)).toThrow(/object/); });
  it('缺字段抛', () => { const c = buildSprintResultContract(); delete c.node_telemetry; expect(() => validateSprintResultContract(c)).toThrow(/node_telemetry/); });
  it('字段类型错抛', () => { const c = buildSprintResultContract(); c.incidental_bugs = 'x'; expect(() => validateSprintResultContract(c)).toThrow(/incidental_bugs/); });
});
