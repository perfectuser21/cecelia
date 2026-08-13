/**
 * derive-recollect-convergence.test.js — 同 SHA recollect 一次仍 evidence_insufficient 收敛人审（B-07）。
 *
 * 回归锁定既有 `alreadyRecollected → wait:human_review` 护栏（本 sprint 只增测试不改语义）。
 * 禁 mock 被改的边：真回放 decisionLog 数组走真实 derive，不 stub derive / 替身 schema。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../derive.js';

const HEAD_SHA = 'sha-recollect-head';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: { url: 'https://github.com/x/y/pull/1', state: 'OPEN', ci: 'pass', merged: false, head_sha: HEAD_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD_SHA },
    judgeVerdict: { verdict: 'FAIL', pr_head_sha: HEAD_SHA, failure_class: 'evidence_insufficient' },
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 6, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog: [
      { hop: 2, action: 'verdict:evaluate', detail: { verdict: 'PASS', pr_head_sha: HEAD_SHA } },
      { hop: 3, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: HEAD_SHA, failure_class: 'evidence_insufficient' } },
    ],
    ...overrides,
  };
}

describe('recollect 收敛护栏（B-07 / INV-5）', () => {
  it('首次 evidence_insufficient → 重派 evaluator 取证，不派 generator-fix', () => {
    const r = derive(baseObserved());
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
    expect(r.action).not.toBe('spawn:generator-fix');
  });

  it('同 SHA 已 recollect 一次再判不足收敛 wait human_review', () => {
    const o = baseObserved();
    // 已重新取证过一次（judge_evidence_insufficient_recollect），锚定当前 head_sha
    o.decisionLog.push({
      hop: 4,
      action: 'spawn:evaluator',
      observed: { trigger_sha: HEAD_SHA },
      detail: { reason: 'judge_evidence_insufficient_recollect' },
    });
    // 补证后仍判证据不足
    o.decisionLog.push({
      hop: 5,
      action: 'verdict:judge',
      detail: { verdict: 'FAIL', pr_head_sha: HEAD_SHA, failure_class: 'evidence_insufficient' },
    });
    const r = derive(o);
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
    // INV-5：任何分支都不误派 generator-fix
    expect(r.action).not.toBe('spawn:generator-fix');
  });
});
