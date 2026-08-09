/**
 * [BEHAVIOR] kernel derive() 按 payload.gear 三档分流（sprint 08091640）。
 *
 * 覆盖父路 e6f803f2 工厂·F1 开发闭环·步1「接单进车间即分档」(3bf6c116) 第 3-4 步。
 * 纯函数真验（无 mock、无替身、无 DB）——被改的边就是 derive 状态机本身，直接喂 observed 断言。
 *
 * 生成器落地目标：这些用例应搬进 packages/brain/src/orchestrator/__tests__/derive.test.js，
 * 由 brain-unit CI 常驻回归（本 sprint 目录测试只做 TDD Red 证据，不进 CI include）。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

/** 初始态：prd 未落盘、合同未批、无 PR、generator 未派——现行 default 从这里进 planner。 */
function initialObserved(overrides = {}) {
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
    decisionLog: [],
    counters: {
      hops: 1, fixRound: 0, pollCount: 0,
      noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
    },
    ...overrides,
  };
}

describe('kernel derive() gear 三档分流 [BEHAVIOR]', () => {
  it('gear=hotfix 初始态 返回 action 不等于 spawn:planner（跳过 planning/gan 直进 generate）', () => {
    const d = derive(initialObserved({ gear: 'hotfix' }));
    expect(d.action).not.toBe('spawn:planner');
    expect(d.phase).toBe('generate');
    expect(d.action).toBe('spawn:generator');
  });

  it('gear=hotfix 全程不派 planner/proposer/reviewer（三角色 spawn 均不出现）', () => {
    // 初始态直接进 generate，不经 planning/gan，故不可能派出这三个角色
    const d = derive(initialObserved({ gear: 'hotfix' }));
    expect(['spawn:planner', 'spawn:proposer', 'spawn:reviewer']).not.toContain(d.action);
  });

  it('gear=default 初始态 返回 spawn:planner（零回归：与改动前逐字节等价）', () => {
    const d = derive(initialObserved({ gear: 'default' }));
    expect(d.phase).toBe('planning');
    expect(d.action).toBe('spawn:planner');
  });

  it('gear 缺省（undefined）等价 default（零回归：现有全部用例不传 gear）', () => {
    const d = derive(initialObserved()); // 不传 gear
    expect(d.action).toBe('spawn:planner');
  });

  it('gear=segmented 初始态 照跑 planner（对齐 controller segmented：planner→proposer 多段）', () => {
    const d = derive(initialObserved({ gear: 'segmented' }));
    expect(d.phase).toBe('planning');
    expect(d.action).toBe('spawn:planner');
  });

  it('gear=turbo（非法值）kernel 侧 fail-closed → mark_failed reason=invalid_gear（对齐 executor.js invalid_gear）', () => {
    const d = derive(initialObserved({ gear: 'turbo' }));
    expect(d.phase).toBe('failed');
    expect(d.action).toBe('mark_failed');
    expect(d.reason).toBe('invalid_gear');
  });
});
