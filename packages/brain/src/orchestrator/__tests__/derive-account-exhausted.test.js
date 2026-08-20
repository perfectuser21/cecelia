/**
 * derive attemptCallbackRoute account_exhausted 路由回归测试（issue 7c9f427e）。
 *
 * 契约锚点：contract-draft.md ## Response Schema —— derive 对 attempt callback
 * {status:failed, failure_class:account_exhausted, role:generator} 走「账号耗尽·非终态重试」
 * 分支（复用 INFRA_RETRY_ACTION_BY_ROLE[role]），reason=callback_account_exhausted，phase 不为
 * failed/terminal；普通 runner_failure 仍判 run 终态（回归护栏，非配额语义不误轮换）。
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：derive ↔ observed.decisionLog——本测试真调 derive 并
 * 断言真实返回的 {phase,action,reason}，不 stub derive 或替换 attemptCallbackRoute。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../derive.js';

// derive 全字段 observed 骨架（pr:null 走 attempt callback 路由，不触 merged 短路）
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

// 未消费的 attempt callback 决策行
function callbackRow(hop, detail) {
  return { hop, action: 'verdict:attempt_callback', detail: { role: 'generator', hop: hop - 1, ...detail } };
}

describe('derive account_exhausted 非终态轮换（429 周限不判 run 终态）', () => {
  it('account_exhausted 的 attempt callback → 同 run 重派 generator-fix，不判终态', () => {
    const r = derive(baseObserved({
      decisionLog: [
        callbackRow(3, { status: 'failed', failure_class: 'account_exhausted', role: 'generator' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'callback_account_exhausted',
    });
    expect(r.phase).not.toBe('failed');
    expect(r.phase).not.toBe('terminal');
  });

  // 2026-08-20 语义修正（决策 109dd8eb 批次，run 4bf639e3/0749688a 实证）：
  // runner_failure 是基础设施故障，改为有界重派（≤2 次）不再一刀判终态——
  // r25/r26 里 judge 已 PASS、PR 已产出，一次 guard 起不来烧掉全部工作。
  // 原「非配额语义不误轮换」的护栏语义由 reason 区分保留：
  // runner_failure 走 callback_runner_failure_retry（不轮换账号语义），
  // account_exhausted 才走 callback_account_exhausted（轮换账号）。
  it('普通 runner_failure 有界重派（reason 与 account_exhausted 区分，不误轮换）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        callbackRow(3, { status: 'failed', failure_class: 'runner_failure', role: 'generator' }),
      ],
    }));
    expect(r.phase).not.toBe('failed');
    expect(r.reason).toBe('callback_runner_failure_retry');
    expect(r.reason).not.toBe('callback_account_exhausted');
  });
});
