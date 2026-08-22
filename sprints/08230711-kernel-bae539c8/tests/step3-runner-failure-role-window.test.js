// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：attempt callback(runner_failure) ↔ derive 有界重派计数
//
// 本 sprint 冻结守卫（08230711-kernel-bae539c8 / r52）：真 import real derive.js，不 mock 被改模块。
//
// bug（r52 修复目标）：derive 的 `priorRunnerFailures` 按**全 run 全角色**累计 runner_failure 行——
//   早期角色（evaluator）失败耗光计数后，后期角色（publisher）首次 runner_failure 被误判「已超限」
//   直接进人审，本该属于 publisher 自己的重派额度被跨角色占用。
//
// 修复：`priorRunnerFailures` filter 只统计与当前 callback 同角色（callbackDetail(r).role === role）
//   的 runner_failure 行——每角色各自 ≤2 次重派额度；跨角色互不占用；同角色累计语义不变。
//
// 按产物闸规矩写在被改的那条边上：真 derive（不 stub attemptCallbackRoute）。
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

describe('F1 step3 — runner_failure 有界重派计数按角色窗口化（跨角色不误耗额度）', () => {
  it('跨角色不误耗：evaluator 已 2 次 runner_failure 后 publisher 首次 runner_failure 仍走 publish 重派', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
        { hop: 22, action: 'spawn:evaluator', detail: { reason: 'callback_runner_failure_retry' } },
        cb(25, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
        { hop: 26, action: 'spawn:evaluator', detail: { reason: 'callback_runner_failure_retry' } },
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });

  it('同角色有界语义不变：evaluator 同角色第 3 次 runner_failure 仍进人审 exhausted', () => {
    const r = derive(baseObserved({
      run: { phase: 'evaluate' },
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

  it('同角色计数只数自己：publisher 前有 1 次 evaluator + 1 次 publisher 失败，publisher 本次仍重派', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
        { hop: 22, action: 'spawn:evaluator', detail: { reason: 'callback_runner_failure_retry' } },
        cb(25, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
        { hop: 26, action: 'spawn:publisher', detail: { reason: 'callback_runner_failure_retry' } },
        cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'publisher' }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'publish',
      action: 'publish:approved_ref',
      reason: 'callback_runner_failure_retry',
    });
  });
});
