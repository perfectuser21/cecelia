// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：attempt callback(runner_failure, role=publisher) ↔ derive 决策
//
// 覆盖父路 F1「工厂·开发闭环」第 3 步「造完真验」（journey_id e6f803f2 / step F1-step3）。
//
// 背景（PRD 08221235-kernel-3354cd28，决策 109dd8eb 批次）：
//   runner_failure = 基础设施故障（容器/guard/依赖装配起不来），不是产品失败。与
//   infrastructure_blocked / account_exhausted 同族——有界重派同角色（≤2 次），超限进人审。
//   derive.js 的 INFRA_RETRY_ACTION_BY_ROLE 已挂 evaluator/judge/generator/... 唯独
//   publisher 缺表项：publisher 的 runner 起不来时（judge 已 PASS、候选已授权），
//   infrastructureRetryForCallback('publisher', …) 返回 undefined → derive 落
//   callback_runner_failure_route_unknown 进人审，享受不到与其他角色同等的有界重派。
//
// 按产物闸规矩写在被改的边上：真 derive（不 stub attemptCallbackRoute / infrastructureRetryForCallback）。
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

describe('F1 step3 — publisher runner_failure 有界重派（不再 route_unknown）', () => {
  // RED 复现：baseline 缺 publisher 表项 → route_unknown 进人审。GREEN 后返回 publish 重派动作。
  it('返回 publish 重派动作 phase=publish action=publish:approved_ref reason=callback_runner_failure_retry', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r.phase).not.toBe('review');
    expect(r.reason).not.toBe('callback_runner_failure_route_unknown');
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });

  it('publisher runner_failure 首次不判 run 终态（phase 不为 failed）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r.phase).not.toBe('failed');
    expect(r.action).not.toBe('mark_failed');
  });

  it('超限守恒：第 3 次 publisher runner_failure 仍进人审 callback_runner_failure_exhausted', () => {
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

  it('负向：publisher 普通 failed（无 failure_class）照旧判终态，不被本次放宽', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({ phase: 'failed', action: 'mark_failed', reason: 'callback_failed' });
  });

  it('回归守恒：evaluator runner_failure 首次仍重派 evaluator（不得回退既有角色行为）', () => {
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
