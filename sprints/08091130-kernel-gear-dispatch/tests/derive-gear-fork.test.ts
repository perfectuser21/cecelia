import { describe, it, expect } from 'vitest';
// @ts-nocheck
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

/**
 * TDD RED（proposer 红证据）——落地版由 generator 写入
 * packages/brain/src/orchestrator/__tests__/derive-gear.test.js（it 名逐字一致，供 DoD -t 映射）。
 *
 * 断言 kernel derive.js 初始态按 observed.gear 分叉：
 *   - hotfix → 跳 planning/gan，action=spawn:generator（≠ spawn:planner）
 *   - default/缺省 → spawn:planner（零回归）
 * 当前 derive 完全忽略 gear（全目录 grep gear=0），prdExists=false 恒返回 spawn:planner，
 * 故 hotfix 两条断言现在必然 FAIL = RED。
 */
function initialObserved(overrides: Record<string, unknown> = {}) {
  return {
    run: { phase: 'planning' },
    task: { status: 'in_progress' },
    prdExists: false,
    contract: { approved: false },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 1, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

describe('kernel derive gear 分叉 [BEHAVIOR]', () => {
  it('gear=hotfix 初始态 action 不等于 spawn:planner', () => {
    const r = derive(initialObserved({ gear: 'hotfix' }));
    expect(r.action).not.toBe('spawn:planner');
  });

  it('gear=hotfix 初始态 action 等于 spawn:generator', () => {
    const r = derive(initialObserved({ gear: 'hotfix' }));
    expect(r.phase).toBe('generate');
    expect(r.action).toBe('spawn:generator');
  });

  it('gear=default 初始态 action 等于 spawn:planner', () => {
    const withDefault = derive(initialObserved({ gear: 'default' }));
    expect(withDefault.action).toBe('spawn:planner');
    // 老快照回放：完全不含 gear 字段也必须归一 default（零回归护栏）
    const withoutGear = derive(initialObserved());
    expect(withoutGear.action).toBe('spawn:planner');
  });
});
