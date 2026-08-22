// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：attempt callback(runner_failure, role=publisher) ↔ derive 决策
//
// GP 锚（决策 109dd8eb 产物闸）：本步骤守卫落在被改的流水线边上——真 import real derive.js，
// 不 mock 被改模块。守护 publisher runner_failure 的有界重派路由。
//
// 背景（sprint 08221235-kernel-3354cd28）：runner_failure = 基础设施故障，不是产品失败。
// 与 infrastructure_blocked / account_exhausted 同族——有界重派同角色（≤2 次），超限进人审。
// derive.js 的 INFRA_RETRY_ACTION_BY_ROLE 已挂 evaluator/judge/generator，唯独 publisher
// 缺表项 → infrastructureRetryForCallback('publisher', …) 返回 undefined → derive 落
// callback_runner_failure_route_unknown 进人审。本 sprint 补齐 publisher，语义与其他角色一致。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'publish' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: 'PASS',
    judgeVerdict: 'PASS',
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 30, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

const cb = (hop, detail) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: { hop: hop - 1, ...detail },
});

describe('F1 step3 — publisher runner_failure 有界重派 GP 锚（真 derive，守卫在边上）', () => {
  it('publisher runner_failure 首次 → publish 重派动作，不再 route_unknown', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r.reason).not.toBe('callback_runner_failure_route_unknown');
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });

  it('publisher runner_failure 首次不判 run 终态', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r.phase).not.toBe('failed');
    expect(r.action).not.toBe('mark_failed');
  });

  it('超限守恒：第 3 次 publisher runner_failure 仍进人审 exhausted', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
        { hop: 22, action: 'spawn:publisher', detail: { reason: 'callback_runner_failure_retry' } },
        cb(25, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
        { hop: 26, action: 'spawn:publisher', detail: { reason: 'callback_runner_failure_retry' } },
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_runner_failure_exhausted',
    });
  });

  it('回归守恒：evaluator runner_failure 首次仍重派 evaluator（既有角色行为不回退）', () => {
    const r = derive(baseObserved({
      run: { phase: 'evaluate' },
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'evaluate',
      action: 'spawn:evaluator',
      reason: 'callback_runner_failure_retry',
    });
  });
});
