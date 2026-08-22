// F1 step3「造完真验」r45 —— 边：attempt callback(runner_failure, role=publisher) ↔ derive 决策
//
// 冻结合同测试（sprint 目录），封印闸 requireTests 认这一份为本 sprint RED 证据。
// 真 derive（不 stub attemptCallbackRoute），产物闸规矩写在被改的边上。
//
// 背景（PRD F1-S3 r45）：runner_failure=基础设施故障，derive 已为
// evaluator/judge/generator 配置有界重派，但 INFRA_RETRY_ACTION_BY_ROLE 缺 publisher。
// publisher 回调 runner_failure 时 infrastructureRetryForCallback 返回 undefined →
// derive 落进 callback_runner_failure_route_unknown（误判需人审，烧一轮 run）。
// 本 sprint 补 publisher 条目，使其与 evaluator/judge 同享有界重派（≤2 次）+ 超限人审兜底。
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

describe('F1 step3 r45 — publisher runner_failure 有界重派，不再 route_unknown', () => {
  it('publisher runner_failure（首次 priorRunnerFailures=0）→ 重派 publish，返回 callback_runner_failure_retry', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    // RED（改前）：publisher 不在 INFRA_RETRY_ACTION_BY_ROLE → reason=callback_runner_failure_route_unknown → 本断言失败复现 bug
    expect(r.phase).not.toBe('failed');
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
    expect(r.reason).not.toBe('callback_runner_failure_route_unknown');
  });

  it('publisher 同 run 第 3 次 runner_failure（priorRunnerFailures>=2）→ 人审兜底 callback_runner_failure_exhausted（有界不变）', () => {
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

  it('负向：publisher product 类失败（无 failure_class）照旧判终态，不被本次放宽', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({ phase: 'failed', action: 'mark_failed', reason: 'callback_failed' });
  });

  it('回归不退：evaluator runner_failure（首次）仍重派 evaluator，既有行为不回退', () => {
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
