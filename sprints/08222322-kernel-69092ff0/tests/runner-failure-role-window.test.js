/**
 * Frozen contract test — Sprint 08222322-kernel-69092ff0
 * runner_failure 有界重派计数按角色窗口化（priorRunnerFailures per-role）
 *
 * 锚定父路：独立小路（无父路）—— kernel derive 决策纯函数窗口化，journey
 *   e6f803f2 / step aad25bdb 的 planned 行为，非既有 golden path 步骤推进。
 *
 * TDD RED（对 implementation_baseline d055671e 未修 derive.js）：
 *   - 「跨角色 runner_failure 不再互耗额度」用例 FAIL：现码把 evaluator 的
 *     runner_failure 计入 publisher 窗口 → priorRunnerFailures>=2 → exhausted。
 *   - 「缺 role 字段的历史 runner_failure 行不计入」用例 FAIL：现码无 role 过滤，
 *     role-less 历史行被计入当前角色窗口。
 *   - 「同角色 runner_failure 3 连败第 3 次仍进人审」用例 GREEN（负向语义不变，
 *     现码与修复码一致）。
 * GREEN（generator 给 priorRunnerFailures filter 加同角色条件后）三条全绿。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CURRENT_CONTRACT_IDENTITY = Object.freeze({
  contract_id: '99999999-9999-4999-8999-999999999999',
  manifest_sha256: '9'.repeat(64),
  source_revision: '8'.repeat(64),
});

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: CURRENT_CONTRACT_IDENTITY },
    pr: { url: 'https://github.com/x/y/pull/1', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-new' },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

const callback = (hop, patch = {}) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: {
    run_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: `22222222-2222-4222-8222-${String(hop).padStart(12, '0')}`,
    lease_generation: 0,
    role: 'generator',
    hop: hop - 1,
    status: 'completed',
    failure_class: null,
    artifacts: [],
    ...patch,
  },
});

describe('runner_failure 有界重派按角色窗口化 [BEHAVIOR]', () => {
  it('跨角色 runner_failure 不再互耗额度：evaluator 2 败后 publisher 首败仍可重派', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:evaluator', observed: {} },
        callback(3, { role: 'evaluator', status: 'failed', failure_class: 'runner_failure' }),
        { hop: 4, action: 'spawn:evaluator', observed: {} },
        callback(6, { role: 'evaluator', status: 'failed', failure_class: 'runner_failure' }),
        { hop: 7, action: 'spawn:publisher', observed: {} },
        callback(9, { role: 'publisher', status: 'failed', failure_class: 'runner_failure' }),
      ],
    }));
    expect(r).toEqual({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });

  it('同角色 runner_failure 3 连败第 3 次仍进人审（窗口化不放宽负向语义）', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:publisher', observed: {} },
        callback(3, { role: 'publisher', status: 'failed', failure_class: 'runner_failure' }),
        { hop: 4, action: 'spawn:publisher', observed: {} },
        callback(6, { role: 'publisher', status: 'failed', failure_class: 'runner_failure' }),
        { hop: 7, action: 'spawn:publisher', observed: {} },
        callback(9, { role: 'publisher', status: 'failed', failure_class: 'runner_failure' }),
      ],
    }));
    expect(r).toEqual({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_runner_failure_exhausted',
    });
  });

  it('缺 role 字段的历史 runner_failure 行不计入当前角色窗口', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:evaluator', observed: {} },
        callback(3, { role: undefined, status: 'failed', failure_class: 'runner_failure' }),
        { hop: 4, action: 'spawn:evaluator', observed: {} },
        callback(6, { role: undefined, status: 'failed', failure_class: 'runner_failure' }),
        { hop: 7, action: 'spawn:publisher', observed: {} },
        callback(9, { role: 'publisher', status: 'failed', failure_class: 'runner_failure' }),
      ],
    }));
    expect(r).toEqual({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });
});
