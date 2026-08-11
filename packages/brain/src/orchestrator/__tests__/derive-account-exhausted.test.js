/**
 * derive × account_exhausted 不判 run 终态（Brain issue 7c9f427e, P0）。
 *
 * 根因：derive 的 attemptCallbackRoute 对 status='failed' 一律 mark_failed 判 run
 * 终态。配额耗尽类失败（account_exhausted）应视为「账号耗尽·可轮换」——不判 run
 * 终态，而是在同一 run 内重派该角色（新 attempt 的 target 选择会消费 exhausted +
 * account-usage 轮换到 account2）。
 *
 * 本测试锚定：
 *  - failed + account_exhausted → 非终态重试（generator → spawn:generator-fix,
 *    reason=callback_account_exhausted），run 不进 failed。
 *  - failed + runner_failure → 仍判 run 终态 mark_failed（回归保护，边界：非配额
 *    语义不误轮换）。
 *
 * DB-free 纯函数测试（derive 是纯状态机）。
 */
import { describe, it, expect } from 'vitest';

import { derive } from '../derive.js';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
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
    status: 'failed',
    failure_class: 'runner_failure',
    artifacts: [],
    ...patch,
  },
});

describe('derive account_exhausted 不判 run 终态', () => {
  it('account_exhausted 的 attempt callback → 同 run 重试，run 不进 failed 终态', () => {
    const r = derive(baseObserved({
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, { failure_class: 'account_exhausted' }),
      ],
    }));
    expect(r.phase).not.toBe('failed');
    expect(r.phase).not.toBe('terminal');
    expect(r).toEqual({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'callback_account_exhausted',
    });
  });

  it('普通 runner_failure 仍判 run 终态 mark_failed（回归保护）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, { failure_class: 'runner_failure' }),
      ],
    }));
    expect(r).toEqual({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'callback_runner_failure',
    });
  });
});
