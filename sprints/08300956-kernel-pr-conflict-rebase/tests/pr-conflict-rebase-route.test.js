// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：merge gate ↔ derive 路由（PR 冲突自愈）
//
// 覆盖父路 factory/F1 造完真验 第 3 步（merge gate 前的路由裁决）。
//
// 2026-08-30 生产实证（r83 run 32873c79 + 第 45 批 #5089 版本号撞车）：r83 零人碰跑到
// judge PASS + merge gate，但其基线早于 #5089 合并，两者都 bump 同一版本号
// （.brain-versions / DEFINITION.md 版本行 / packages/brain/package.json / package-lock）
// → PR 变 DIRTY。DIRTY 的 PR GitHub 不触发 pull_request 工作流（CI 永不绿），
// kernel-handlers.merge_pr 遇 DIRTY 只返回 BLOCKED，derive 无任何自愈路由——
// 只能死等或 automation_deadline_exceeded 判死。
//
// 修法（本 sprint）：derive.js 纯函数路由层在 merge gate 前新增
//   observed.pr 存在 && !merged && mergeStateStatus ∈ {DIRTY, CONFLICTING}
//   → spawn:generator-fix, reason=pr_conflict_rebase（优先于 wait:poll_ci / merge_pr /
//   wait:human_review）；同一 run 内已累计 ≥3 条 reason=pr_conflict_rebase 意图行仍 DIRTY
//   → wait:human_review, reason=pr_conflict_unresolved（人审请求行由 loop.humanReviewDetail
//   带候选头锚）。负向：BEHIND/CLEAN/BLOCKED/UNSTABLE/null/UNKNOWN 既有路由一字不变；
//   已 merged 短路不受影响。
//
// 禁 mock 被改的边：真 import derive.js，直接构造 observed 注入（纯函数可重放，无替身）。
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

// 意图行：spawn:generator-fix + detail.reason（derive 计数读 asStructuredJson(detail).reason）
const rebaseRow = (hop) => ({ hop, action: 'spawn:generator-fix', detail: { reason: 'pr_conflict_rebase' } });
const otherFixRow = (hop, reason) => ({ hop, action: 'spawn:generator-fix', detail: { reason } });

describe('F1 step3：PR DIRTY/CONFLICTING → generator-fix rebase 有界路由（r83/r84 案卷）', () => {
  // ── 正向：DIRTY/CONFLICTING 路由 generator-fix（RED：修前 merge_pr / poll_ci / human_review）──
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
    // DIRTY 时 GitHub 不触发 pull_request → CI 永不绿；按 ci pending 死等是 r83 死因之一。
    const r = derive(observed({}, { mergeStateStatus: 'DIRTY', ci: 'pending' }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  it('DIRTY reviewRequired 优先于 human_review 路由 generator-fix', () => {
    const r = derive(observed({ reviewRequired: true, reviewApproved: false }, { mergeStateStatus: 'DIRTY' }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  // ── 有界：第 1/2/3 次派 generator-fix，第 4 次（已累计 ≥3）升人审 ──
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
    // 3 条非 pr_conflict_rebase 的 generator-fix（ci_fail / container_exit）不占本界额度。
    const r = derive(observed(
      { decisionLog: [otherFixRow(10, 'ci_fail'), otherFixRow(20, 'ci_fail'), otherFixRow(30, 'container_exit')] },
      { mergeStateStatus: 'DIRTY' },
    ));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('pr_conflict_rebase');
  });

  // ── 负向：非冲突枚举既有路由一字不变（修前修后皆 GREEN，回归护栏）──
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
