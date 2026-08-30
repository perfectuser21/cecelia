// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：merge gate ↔ derive 路由（PR 冲突自愈）
//
// 永久回归位（PRD r84 要求 #5：测试放 tests/gp/f1/，真 import derive.js）。与
// sprints/08300956-kernel-pr-conflict-rebase/tests/pr-conflict-rebase-route.test.js
// 同断言集，二者都进 CI 常驻回归。
//
// r83（run 32873c79）+ 第 45 批 #5089 版本号撞车 → PR DIRTY。DIRTY 的 PR GitHub 不触发
// pull_request 工作流（CI 永不绿），kernel-handlers.merge_pr 遇 DIRTY 只返回 BLOCKED，
// derive 无自愈路由——死等 / automation_deadline_exceeded 判死。修法：derive.js merge
// gate 前新增 DIRTY/CONFLICTING → spawn:generator-fix(pr_conflict_rebase) 有界路由，
// ≥3 条仍 DIRTY → wait:human_review(pr_conflict_unresolved)。
//
// 禁 mock 被改的边：真 import derive.js，直接构造 observed 注入（纯函数可重放）。
import { describe, expect, it } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const HEAD = 'a'.repeat(40);
const IDENTITY = { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' };

function observed(overrides = {}, prOverrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    pr: {
      url: 'https://github.com/perfectuser21/cecelia/pull/5099',
      state: 'OPEN',
      head_sha: HEAD,
      mergeStateStatus: 'CLEAN',
      merged: false,
      ci: 'pass',
      ...prOverrides,
    },
    candidate: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:judge' },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    contract: { approved: true, identity: IDENTITY },
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: HEAD, contract_identity: IDENTITY },
    judgeVerdict: { verdict: 'PASS', pr_head_sha: HEAD, contract_identity: IDENTITY },
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 40, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog: [],
    ...overrides,
  };
}

const rebaseRow = (hop) => ({ hop, action: 'spawn:generator-fix', detail: { reason: 'pr_conflict_rebase' } });
const otherFixRow = (hop, reason) => ({ hop, action: 'spawn:generator-fix', detail: { reason } });

describe('F1 step3：PR DIRTY/CONFLICTING → generator-fix rebase 有界路由（r83/r84 回归）', () => {
  it('DIRTY 双PASS 路由 generator-fix rebase pr_conflict_rebase', () => {
    const r = derive(observed({}, { mergeStateStatus: 'DIRTY' }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  it('CONFLICTING 双PASS 路由 generator-fix rebase pr_conflict_rebase', () => {
    const r = derive(observed({}, { mergeStateStatus: 'CONFLICTING' }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  it('DIRTY ci_pending 优先于 poll_ci 路由 generator-fix', () => {
    const r = derive(observed({}, { mergeStateStatus: 'DIRTY', ci: 'pending' }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  it('DIRTY reviewRequired 优先于 human_review 路由 generator-fix', () => {
    const r = derive(observed({ reviewRequired: true, reviewApproved: false }, { mergeStateStatus: 'DIRTY' }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  it('DIRTY 已有2条rebase意图 第3次仍派 generator-fix', () => {
    const r = derive(observed({ decisionLog: [rebaseRow(10), rebaseRow(20)] }, { mergeStateStatus: 'DIRTY' }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  it('DIRTY 已有3条rebase意图 第4次升 human_review pr_conflict_unresolved', () => {
    const r = derive(observed(
      { decisionLog: [rebaseRow(10), rebaseRow(20), rebaseRow(30)] },
      { mergeStateStatus: 'DIRTY' },
    ));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('pr_conflict_unresolved');
  });

  it('计数只认 pr_conflict_rebase reason 其它reason的generator-fix不计入本界', () => {
    const r = derive(observed(
      { decisionLog: [otherFixRow(10, 'ci_fail'), otherFixRow(20, 'ci_fail'), otherFixRow(30, 'container_exit')] },
      { mergeStateStatus: 'DIRTY' },
    ));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  it('负向 BEHIND 仍走 merge_pr all_gates_passed', () => {
    const r = derive(observed({}, { mergeStateStatus: 'BEHIND' }));
    expect(r.action).toBe('merge_pr');
    expect(r.reason).toBe('all_gates_passed');
  });

  it('负向 CLEAN 仍走 merge_pr', () => {
    const r = derive(observed({}, { mergeStateStatus: 'CLEAN' }));
    expect(r.action).toBe('merge_pr');
  });

  it('负向 BLOCKED 仍走 merge_pr', () => {
    const r = derive(observed({}, { mergeStateStatus: 'BLOCKED' }));
    expect(r.action).toBe('merge_pr');
  });

  it('负向 UNSTABLE 仍走 merge_pr', () => {
    const r = derive(observed({}, { mergeStateStatus: 'UNSTABLE' }));
    expect(r.action).toBe('merge_pr');
  });

  it('负向 mergeStateStatus 缺失 null 不误触发 走 merge_pr', () => {
    const r = derive(observed({}, { mergeStateStatus: null }));
    expect(r.action).toBe('merge_pr');
  });

  it('负向 UNKNOWN 不误触发 走 merge_pr', () => {
    const r = derive(observed({}, { mergeStateStatus: 'UNKNOWN' }));
    expect(r.action).toBe('merge_pr');
  });

  it('负向 已 merged 的 DIRTY PR 短路 report pr_merged', () => {
    const r = derive(observed({}, { mergeStateStatus: 'DIRTY', merged: true }));
    expect(r.action).toBe('report');
    expect(r.reason).toBe('pr_merged');
  });

  it('负向 CLEAN ci_pending 仍 wait poll_ci 不被 rebase 劫持', () => {
    const r = derive(observed({}, { mergeStateStatus: 'CLEAN', ci: 'pending' }));
    expect(r.action).toBe('wait:poll_ci');
  });
});
