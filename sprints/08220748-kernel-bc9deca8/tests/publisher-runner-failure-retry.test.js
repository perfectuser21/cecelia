// Sprint 08220748-kernel-bc9deca8 — publisher 进 INFRA_RETRY_ACTION_BY_ROLE
// 覆盖父路 F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：attempt callback(runner_failure) ↔ derive 决策
//
// 背景（r40 hop175 / r41 hop54 生产实证）：publisher 角色的 attempt 以
// failure_class='runner_failure' 回调时，derive 走 runner_failure 分支调用
// infrastructureRetryForCallback('publisher', ...)，因 INFRA_RETRY_ACTION_BY_ROLE
// 缺 publisher 条目返回 undefined → 命中 !retry 兜底 → callback_runner_failure_route_unknown
// → 整条 run 判死。本 sprint 给 publisher 补上重派动作，与 evaluator/judge 同等享受
// 有界重派（≤2 次）+ 超限人审兜底，重派额度语义不变。
//
// 禁 mock 边：真调 derive（不 stub attemptCallbackRoute / infrastructureRetryForCallback），
// 真实 decisionLog 驱动路由判定。
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
    evaluateVerdict: null,
    judgeVerdict: null,
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

describe('publisher runner_failure 有界重派，不再 route_unknown', () => {
  it('B-01 publisher runner_failure 首次 → 返回 publish 重派而非 route_unknown', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    // RED 证据（未加 publisher 映射时）：reason === 'callback_runner_failure_route_unknown'
    // GREEN（加映射后）：
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
    expect(r.reason).not.toBe('callback_runner_failure_route_unknown');
  });

  it('B-02 publisher runner_failure 累计 ≥2 次 → 人审兜底 exhausted（有界，不无限重派）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
        { hop: 22, action: 'publish:approved_ref', detail: { reason: 'callback_runner_failure_retry' } },
        cb(25, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
        { hop: 26, action: 'publish:approved_ref', detail: { reason: 'callback_runner_failure_retry' } },
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_runner_failure_exhausted',
    });
  });

  it('B-03 回归：非 publisher（evaluator）runner_failure 路由完全不变', () => {
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

  it('B-04 边界：publisher 普通 failed（无 failure_class）不受本次改动影响，仍判终态', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', role: 'publisher' }),
      ],
    }));
    expect(r.reason).not.toBe('callback_runner_failure_retry');
    expect(r.action).not.toBe('publish:approved_ref');
    expect(r).toMatchObject({ phase: 'failed', action: 'mark_failed' });
  });
});
