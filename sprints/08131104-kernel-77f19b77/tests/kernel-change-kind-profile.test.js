/**
 * TDD Red 证据（proposer round 1）—— 四档 change_kind 驱动 derive 执行 Profile。
 *
 * 这是 proposer 的红证据留档。Generator 交付时把等价断言落到
 * packages/brain/src/__tests__/kernel-change-kind-profile.test.js（brain CI 收割位置），
 * 并补齐 capability_change / G→E→J 保留 / evaluator 时钟等条目。
 *
 * 禁 mock 边：derive() 纯函数状态机真调，禁 mock（合同「禁 mock 边清单」）。
 *
 * 当前 RED 根因：orchestrator/derive.js 只消费 observed.gear，change_kind 零消费
 *（缺陷④）。bugfix / parameter_only 初始态本应跳 Planner/GAN 直进 generate，
 * 现全部落到 planning 门 → 断言失败（已实测 2 failed | 1 passed）。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const base = () => ({
  run: { phase: 'planning' },
  task: { status: 'in_progress' },
  prdExists: false,
  contract: { approved: false },
  pr: null,
  inflight: { containers: [], host_pids: [], attempts: [] },
  lastAgentExit: null,
  proposeBranchRn: null,
  ganLatestRoundVerdict: null,
  generatorSpawned: false,
  evaluateVerdict: null,
  judgeVerdict: null,
  reviewRequired: false,
  reviewApproved: false,
  counters: { hop: 1, noPushStreak: 0, noVerdictStreak: 0 },
  decisionLog: [],
  gear: 'default',
});

describe('四档 change_kind 驱动 derive 执行 Profile [BEHAVIOR]', () => {
  it('bugfix change_kind 初始态跳 Planner/GAN 直进 generate', () => {
    const d = derive({ ...base(), change_kind: 'bugfix' });
    expect(d.phase).toBe('generate'); // RED：现返回 planning（change_kind 未消费）
  });

  it('parameter_only change_kind 初始态跳 Planner/GAN 直进 generate', () => {
    const d = derive({ ...base(), change_kind: 'parameter_only' });
    expect(d.phase).toBe('generate'); // RED：现返回 planning
  });

  it('new_capability change_kind 走全链（初始态 planning）', () => {
    const d = derive({ ...base(), change_kind: 'new_capability' });
    expect(d.phase).toBe('planning'); // GREEN（现默认即 planning）
  });
});
