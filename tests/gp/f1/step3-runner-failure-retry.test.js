// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：attempt callback(runner_failure) ↔ derive 决策
//
// 2026-08-19/20 生产实证（run 4bf639e3 r25 / 0749688a r26，同一死法）：
//   evaluator 的 runner 起不来（frozen_baseline_guard_unavailable —— 一次是
//   cannot capture dependency manifest，一次是 candidate tree assertion failed），
//   failure_class=runner_failure → derive 落进通用 mark_failed → **整条 run 被杀**。
//   此时 GAN 已收敛、judge 已 PASS、publisher 已产出 PR、generator-fix 已完成修复——
//   一次基础设施抖动烧掉了 80+ 分钟的全部工作。
//
// 语义修正（决策 109dd8eb 批次）：runner_failure 是基础设施故障，不是产品失败，
// 与 infrastructure_blocked / account_exhausted 同族——有界重派同角色（≤2 次），
// 超限后进人审（保底不静默重试到天荒地老），而不是判 run 终态。
//
// 按产物闸规矩写在边上：真 derive（不 stub attemptCallbackRoute）。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
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

describe('F1 step3 — runner_failure 有界重派，不再一刀杀 run', () => {
  it('evaluator 的 runner_failure（首次）→ 同 run 重派 evaluator，不判终态', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
      ],
    }));
    expect(r.phase).not.toBe('failed');
    expect(r).toMatchObject({
      phase: 'evaluate',
      action: 'spawn:evaluator',
      reason: 'callback_runner_failure_retry',
    });
  });

  it('generator 的 runner_failure（首次）→ 重派 generator-fix 路由，不判终态', () => {
    const r = derive(baseObserved({
      run: { phase: 'generate' },
      decisionLog: [
        cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'generator' }),
      ],
    }));
    expect(r.phase).not.toBe('failed');
    expect(r.reason).toBe('callback_runner_failure_retry');
  });

  it('同一 run 第 3 次 runner_failure → 进人审（有界，不无限重试）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
        { hop: 22, action: 'spawn:evaluator', detail: { reason: 'callback_runner_failure_retry' } },
        cb(25, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
        { hop: 26, action: 'spawn:evaluator', detail: { reason: 'callback_runner_failure_retry' } },
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_runner_failure_exhausted',
    });
  });

  it('负向：product 类失败（无 failure_class）照旧判终态，不被本次放宽', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'failed', role: 'evaluator' }),
      ],
    }));
    expect(r).toMatchObject({ phase: 'failed', action: 'mark_failed', reason: 'callback_failed' });
  });

  it('负向：cancelled 照旧判终态', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, { status: 'cancelled', role: 'evaluator' }),
      ],
    }));
    expect(r).toMatchObject({ phase: 'failed', action: 'mark_failed', reason: 'callback_cancelled' });
  });
});
