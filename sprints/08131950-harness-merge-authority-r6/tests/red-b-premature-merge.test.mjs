/**
 * RED-B 永久回归 — Kernel 提前合并 fail-closed（premature_merge）。
 *
 * 事故根因（PR #4870）：derive.js 对 `pr.merged === true` 无条件返回
 *   { phase:'done', action:'report', reason:'pr_merged' }，把「Generator 仍在跑、
 *   同 head_sha 无 Evaluator/Judge PASS receipt 时被外部抢先合并」当成功终态，
 *   run 记 done / task 记 completed（假成功）。
 *
 * 本刀要求：pr.merged 但缺少同一 head_sha 的 Evaluator PASS/FIXED + Judge PASS
 *   → fail-closed 记 premature_merge（phase:'failed', action:'mark_failed'），
 *   run 不得 done、task 不得 completed。只有两个同 head PASS receipt 齐备（Harness
 *   merge handler 合并的合法路径）才允许 done/pr_merged。
 *
 * 禁 mock 边：derive 是纯函数，无 DB 边（mock N/A）；DB 落库终态由 RED-B E2E 段
 *   在 local_api 真 markRunFailed → run/task 终态验证（见 contract-draft.md ## E2E 验收）。
 *
 * 永久落位（Generator 实现时迁入）：
 *   packages/brain/src/orchestrator/__tests__/derive.test.js
 *   （并更新旧「merged 短路」用例，为其补齐两个同 head PASS receipt——旧用例编码的
 *    「merged 无条件 done」正是本刀要修的 bug，不属零回归保护范围）。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const HEAD = 'sha-under-test';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: { url: 'https://github.com/x/y/pull/1', state: 'MERGED', ci: 'pass', merged: true, head_sha: HEAD },
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

describe('RED-B: Kernel 提前合并 fail-closed（premature_merge）', () => {
  it('Generator running + 无同 head Evaluator/Judge + 外部 merged → premature_merge（不 done）', () => {
    const r = derive(baseObserved());
    expect(r.phase).toBe('failed');
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toBe('premature_merge');
  });

  it('Evaluator PASS 但 Judge 缺失 → premature_merge（缺角色不得放行成功）', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD },
      judgeVerdict: null,
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('premature_merge');
  });

  it('两个 receipt 都 PASS 但锚定旧 head_sha → premature_merge（陈旧证据不算合法合并）', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'stale-sha' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'stale-sha' },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('premature_merge');
  });

  it('同 head_sha Evaluator PASS + Judge PASS（Harness merge handler 合法合并）→ done/pr_merged', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: HEAD },
    }));
    expect(r.phase).toBe('done');
    expect(r.action).toBe('report');
    expect(r.reason).toBe('pr_merged');
  });

  it('同 head_sha Evaluator FIXED + Judge PASS 也视同合法合并 → done/pr_merged', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'FIXED', pr_head_sha: HEAD },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: HEAD },
    }));
    expect(r.phase).toBe('done');
    expect(r.reason).toBe('pr_merged');
  });
});
