// F1 step3「造完真验」冻结守卫 —— 边：publisher attempt callback(runner_failure) ↔ derive 决策
//
// thin_prd 法律：publisher 对 runner_failure 走 INFRA_RETRY_ACTION_BY_ROLE 有界重派，
// route_unknown 改写为有界重派，消灭 hop 累积死亡螺旋（bc9deca8/r44 同族死法）。
//
// 现状 bug（derive.js:240 INFRA_RETRY_ACTION_BY_ROLE）：只登记 planner/proposer/reviewer/
// generator/evaluator/judge/reporter 七个角色，缺 publisher。publisher runner_failure 回调 →
// infrastructureRetryForCallback('publisher',…) 取 map 得 undefined → 落 !retry 分支 →
// callback_runner_failure_route_unknown → WAIT_HUMAN_REVIEW（每次 runner 抖动都甩人审，
// hop 累积至 run 被确定性杀死）。
//
// 禁 mock 被改的边：真 derive（不 stub attemptCallbackRoute / infrastructureRetryForCallback），
// 真 INFRA_RETRY_ACTION_BY_ROLE 路由表。
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

describe('F1 step3 — publisher runner_failure 有界重派（消灭 route_unknown）', () => {
  it('publisher 的 runner_failure（首次）→ 同角色有界重派 publish:approved_ref，reason=callback_runner_failure_retry', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    // 不再命中 route_unknown / 人审
    expect(r.reason).not.toBe('callback_runner_failure_route_unknown');
    expect(r.action).not.toBe('wait:human_review');
    expect(r.phase).not.toBe('failed');
    // 命中 publisher 有界重派：复用正常派发的 phase=publish + action=publish:approved_ref
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });

  it('publisher 的 runner_failure（第二次，prior=1）→ 仍有界重派，未超限', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
        { hop: 22, action: 'spawn:publisher', detail: { reason: 'callback_runner_failure_retry' } },
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });

  it('同一 run 第 3 次 publisher runner_failure（prior>=2）→ 进人审 exhausted（有界，不无限重试）', () => {
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

  it('负向：publisher 的 product 类失败（无 failure_class）照旧判终态 mark_failed，不被本次放宽误命中', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({ phase: 'failed', action: 'mark_failed', reason: 'callback_failed' });
  });

  it('回归：evaluator 的 runner_failure（首次）仍重派 evaluator，publisher 补丁不越权他族', () => {
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
