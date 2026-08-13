import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

// TDD Red（RED-B）：PR 被外部（CI 通用 auto-merge）抢合，但 Generator 仍 running、
// 无 Evaluator/Judge verdict 时，derive() 必须 fail-closed 路由 premature_merge，
// 而非现状 derive.js:686 的单信号短路 `pr.merged → {phase:'done', reason:'pr_merged'}`。
// 现状会返回 pr_merged/done（假成功）→ 本用例现在应为 RED。
function baseObserved() {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: {
      url: 'https://github.com/perfectuser21/cecelia/pull/4870',
      state: 'MERGED',
      ci: 'pass',
      merged: true,
      head_sha: 'ec49512cf39752e1254abd003c1b617fe5b9f2aa',
    },
    inflight: { containers: [], host_pids: [], attempts: [{ role: 'generator', status: 'running' }] },
    lastAgentExit: null,
    proposeBranchRn: 1,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 1, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
  };
}

describe('derive premature_merge fail-closed [BEHAVIOR]', () => {
  it('pr.merged + Generator running + 无 Evaluator/Judge → premature_merge（不假记完成）', () => {
    const out = derive(baseObserved());
    expect(out.reason).toBe('premature_merge');
    expect(out.phase).toBe('failed');
    expect(out.action).toBe('mark_failed');
  });

  it('pr.merged + 有同 head_sha 的 Evaluate/Judge 验收 → 正常 pr_merged（不误伤正常合并）', () => {
    const observed = baseObserved();
    observed.inflight.attempts = [];
    (observed as any).evaluateVerdict = { verdict: 'PASS', pr_head_sha: observed.pr.head_sha };
    (observed as any).judgeVerdict = { verdict: 'PASS', pr_head_sha: observed.pr.head_sha };
    const out = derive(observed);
    expect(out.reason).toBe('pr_merged');
    expect(out.phase).toBe('done');
  });
});
