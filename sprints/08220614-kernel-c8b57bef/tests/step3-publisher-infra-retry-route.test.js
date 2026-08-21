// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：attempt callback(runner_failure/publisher) ↔ derive 决策
//
// r40 hop175 / r41 生产实证：publisher 的 runner_failure / infrastructure_blocked 回调进
//   derive.js 的 infrastructureRetryForCallback('publisher', …) 时，查 INFRA_RETRY_ACTION_BY_ROLE
//   表**无 publisher 条目** → retry=undefined → derive 落
//   callback_runner_failure_route_unknown / callback_infrastructure_route_unknown → 无出口，
//   进人审死等。judge 已 PASS、候选已就绪，publisher 的 runner 一次没起来就把整条 run 卡成
//   人工兜底——publisher 是唯一没有有界重派待遇的角色。
//
// 语义（决策 109dd8eb 批次）：runner_failure = 基础设施故障，与 infrastructure_blocked /
//   account_exhausted 同族——有界重派同角色（≤2 次），超限进人审兜底，计数语义不变。
//
// 修（唯一实现改动）：INFRA_RETRY_ACTION_BY_ROLE 增加
//   publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }。
//
// 按产物闸规矩写在边上：真 derive（不 stub attemptCallbackRoute / infrastructureRetryForCallback）。
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

describe('F1 step3 — publisher 进 INFRA_RETRY_ACTION_BY_ROLE：有界重派不再 route_unknown', () => {
  // ① 首次 publisher runner_failure → 同 run 重派 publisher（publish:approved_ref），不再 route_unknown
  it('publisher 的 runner_failure（首次）→ 返回 publish 重派动作，reason=callback_runner_failure_retry', () => {
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

  // ④ 超限出口：≥2 次 publisher runner_failure 后进人审兜底（计数语义不变）
  it('publisher 第 3 次 runner_failure → 进人审兜底，reason=callback_runner_failure_exhausted（计数语义不变）', () => {
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

  // ⑤ 同族收益：publisher 的 infrastructure_blocked 一并命中表，返回 publish 重派而非 route_unknown
  it('publisher 的 infrastructure_blocked → 返回 publish 重派动作，reason=callback_infrastructure_blocked（不再 route_unknown）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'infrastructure_blocked', role: 'publisher' }),
      ],
    }));
    expect(r.reason).not.toBe('callback_infrastructure_route_unknown');
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_infrastructure_blocked',
    });
  });

  // ⑤ 同族收益：publisher 的 account_exhausted 一并命中表，返回 publish 重派而非 route_unknown
  it('publisher 的 account_exhausted → 返回 publish 重派动作，reason=callback_account_exhausted（不再 route_unknown）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'account_exhausted', role: 'publisher' }),
      ],
    }));
    expect(r.reason).not.toBe('callback_account_exhausted_route_unknown');
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_account_exhausted',
    });
  });

  // 回归：evaluator 同场景路由逐字不变（非 publisher 角色零漂移）
  it('回归：evaluator 的 runner_failure 仍重派 spawn:evaluator（非 publisher 零漂移）', () => {
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

  // 回归：judge 同场景路由逐字不变（非 publisher 角色零漂移）
  it('回归：judge 的 runner_failure 仍重派 spawn:judge（非 publisher 零漂移）', () => {
    const r = derive(baseObserved({
      run: { phase: 'judge' },
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'judge' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'judge',
      action: 'spawn:judge',
      reason: 'callback_runner_failure_retry',
    });
  });

  // 负向：product 类失败（无 failure_class）不被本次放宽，publisher 照旧判终态
  it('负向：publisher 的 product 类失败（无 failure_class）照旧判终态，不被本次放宽', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({ phase: 'failed', action: 'mark_failed', reason: 'callback_failed' });
  });
});
