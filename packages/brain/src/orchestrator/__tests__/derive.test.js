/**
 * derive(observed) 纯函数全分支测试。
 * 对齐：docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md §phase/action 推导语义
 *      + docs/current/harness-orchestration-redesign/routing-extraction.md 路由决策表。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../derive.js';
import * as constants from '../constants.js';

const {
  MAX_POLL_COUNT,
  MAX_HOPS,
  MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK,
  BUDGET_CAP_USD,
} = constants;

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: { url: 'https://github.com/x/y/pull/1', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-new' },
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

describe('合同故障重开 GAN（r40 实证：CONTRACT IS LAW 死锁出路）', () => {
  // r40 实证：Evaluator 真跑判 FAIL,根因在合同资产自身(final-E2E 脚本比较方式
  // bug)。Generator 无权改合同(CONTRACT IS LAW),旧路由一刀切 wait:human_review
  // → run 死等。合同的 bug 责任在 Proposer/Reviewer,必须自动退回 GAN 修合同。
  const cb = (hop, patch = {}) => ({
    hop,
    action: 'verdict:attempt_callback',
    detail: {
      run_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: `22222222-2222-4222-8222-${String(hop).padStart(12, '0')}`,
      lease_generation: 0,
      role: 'generator',
      hop: hop - 1,
      status: 'blocked',
      failure_class: 'semantic_refusal',
      error_code: 'CONTRACT_SELF_CONTRADICTION',
      artifacts: [],
      ...patch,
    },
  });

  it('generator 报合同故障码(blocked+CONTRACT_SELF_CONTRADICTION) → reopen_gan_contract,不转人工', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3),
      ],
    }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('reopen_gan_contract');
    expect(r.reason).toBe('contract_fault_reopen_gan');
    expect(r.callbackHop).toBe(3);
  });

  it('CONTRACT_TEST_UNSATISFIABLE(r33 形态)同样重开 GAN', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        cb(3, { error_code: 'CONTRACT_TEST_UNSATISFIABLE' }),
      ],
    }));
    expect(r.action).toBe('reopen_gan_contract');
  });

  it('同一 run 第二次合同故障 → 不再重开,回落 wait:human_review(防合同震荡)', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        cb(3),
        { hop: 4, action: 'reopen_gan_contract', detail: { callback_hop: 3 } },
        { hop: 5, action: 'spawn:generator', observed: {} },
        cb(7),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_semantic_refusal');
  });

  it('reopen 行(detail.callback_hop)消费其 callback:同一 callback 不再重复路由', () => {
    const r = derive(baseObserved({
      contract: { approved: false },
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        cb(3),
        { hop: 4, action: 'reopen_gan_contract', detail: { callback_hop: 3 } },
      ],
    }));
    expect(r.action).not.toBe('reopen_gan_contract');
    expect(r.action).not.toBe('wait:human_review');
    expect(r.phase).toBe('gan');
  });

  it('重开后 proposer 尚未出新一轮:趋势闸让路,不许 force_approve 把坏合同再批回去', () => {
    const reviewerRow = (round, rubric_scores) => ({ round, author_role: 'reviewer', rubric_scores });
    const caseFile = [
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 6, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 8, scope_match_prd: 7 }),
    ];
    const r = derive(baseObserved({
      contract: { approved: false },
      pr: null,
      proposeBranchRn: 3,
      ganLatestRoundVerdict: 'REVISION',
      caseFile,
      decisionLog: [
        { hop: 2, action: 'verdict:reviewer', detail: { verdict: 'REVISION' } },
        { hop: 3, action: 'verdict:attempt_callback', detail: { role: 'generator', status: 'blocked', failure_class: 'semantic_refusal', error_code: 'CONTRACT_SELF_CONTRADICTION', hop: 2 } },
        { hop: 4, action: 'reopen_gan_contract', detail: { callback_hop: 3 } },
      ],
    }));
    expect(r.action).toBe('spawn:proposer');
    expect(r.action).not.toBe('force_approve_contract');
  });
});

describe('规则 0：terminal', () => {
  it('run.phase=done → terminal', () => {
    const r = derive(baseObserved({ run: { phase: 'done' } }));
    expect(r.phase).toBe('terminal');
    expect(r.action).toBe('exit');
  });

  it('run.phase=failed → terminal', () => {
    const r = derive(baseObserved({ run: { phase: 'failed' } }));
    expect(r.phase).toBe('terminal');
  });

  it('task.status=aborted → terminal（P2 修订）', () => {
    const r = derive(baseObserved({ task: { status: 'aborted' } }));
    expect(r.phase).toBe('terminal');
    expect(r.action).toBe('exit');
  });

  it('task.status=cancelled → terminal', () => {
    const r = derive(baseObserved({ task: { status: 'cancelled' } }));
    expect(r.phase).toBe('terminal');
  });
});

describe('规则 0.5：在途观测（P0-1）', () => {
  it('inflight 容器非空 → wait:running，不重复 spawn，phase 不变', () => {
    const r = derive(baseObserved({
      run: { phase: 'generate' },
      pr: null,
      generatorSpawned: true,
      inflight: { containers: ['abc123'], host_pids: [], attempts: [] },
    }));
    expect(r.action).toBe('wait:running');
    expect(r.phase).toBe('generate');
  });

  it('inflight 主机 pid 非空 → wait:running', () => {
    const r = derive(baseObserved({ inflight: { containers: [], host_pids: [12345], attempts: [] } }));
    expect(r.action).toBe('wait:running');
  });

  it.each(['starting', 'running'])(
    'inflight remote Attempt status=%s → wait:running without a container or host pid',
    (status) => {
      const r = derive(baseObserved({
        inflight: {
          containers: [],
          host_pids: [],
          attempts: [{
            id: '30000000-0000-4000-8000-000000000001',
            status,
            execution_transport: 'remote-bridge',
          }],
        },
      }));
      expect(r).toEqual({
        phase: 'generate',
        action: 'wait:running',
        reason: 'agent_inflight',
      });
    },
  );
});

describe('R9/R10: append-only attempt callback convergence', () => {
  const callback = (hop, patch = {}) => ({
    hop,
    action: 'verdict:attempt_callback',
    detail: {
      run_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: `22222222-2222-4222-8222-${String(hop).padStart(12, '0')}`,
      lease_generation: 0,
      role: 'generator',
      hop: hop - 1,
      status: 'completed',
      failure_class: null,
      artifacts: [],
      ...patch,
    },
  });

  it('R9: needs_context pauses for one human answer and never enters no_pr fix', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, { status: 'needs_context', failure_class: 'needs_context' }),
      ],
    }));

    expect(r).toEqual({
      phase: 'paused',
      action: 'pause_run',
      reason: 'callback_needs_context',
    });
  });

  it('R9: an answer bound to an initial Generator callback retries the original action', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, { status: 'needs_context', failure_class: 'needs_context' }),
        {
          hop: 4,
          action: 'effect:context_requested',
          detail: {
            callback_hop: 3,
            context_version: 'context-v1:3:attempt-3',
          },
        },
        {
          hop: 5,
          action: 'verdict:context_answer',
          detail: {
            callback_hop: 3,
            context_request_hop: 4,
            context_version: 'context-v1:3:attempt-3',
            answer: 'Use the existing rollback policy.',
          },
        },
      ],
    }));

    expect(r).toEqual({
      phase: 'generate',
      action: 'spawn:generator',
      reason: 'context_answered_retry',
    });
  });

  it('R9: an answer bound to a Generator-fix callback preserves the fix action', () => {
    const r = derive(baseObserved({
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        callback(3, { status: 'needs_context', failure_class: 'needs_context' }),
        {
          hop: 4,
          action: 'effect:context_requested',
          detail: {
            callback_hop: 3,
            context_version: 'context-v1:3:attempt-3',
          },
        },
        {
          hop: 5,
          action: 'verdict:context_answer',
          detail: {
            callback_hop: 3,
            context_request_hop: 4,
            context_version: 'context-v1:3:attempt-3',
            answer: 'Keep the current PR and apply the requested repair.',
          },
        },
      ],
    }));

    expect(r).toEqual({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'context_answered_retry',
    });
  });

  it('only infrastructure_blocked callback can retry the same role on another target', () => {
    const infra = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, {
          status: 'blocked',
          failure_class: 'infrastructure_blocked',
          failure_signature: ['docker_unavailable'],
        }),
      ],
    }));
    const semantic = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, {
          status: 'blocked',
          failure_class: 'semantic_refusal',
        }),
      ],
    }));

    expect(infra).toEqual({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'callback_infrastructure_blocked',
    });
    expect(semantic).toEqual({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_semantic_refusal',
    });
  });

  it('routes the latest distinct expired-attempt infrastructure terminal effect like a callback', () => {
    const r = derive(baseObserved({
      pr: null,
      lastAgentExit: {
        code: 1,
        auth_failed: false,
        action: 'spawn:generator',
      },
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        {
          hop: 3,
          action: 'effect:expired_attempt_reconciled',
          detail: {
            attempt_id: '22222222-2222-4222-8222-000000000003',
            role: 'generator',
            status: 'failed',
            failure_class: 'infrastructure_blocked',
            signature: 'worker_attempt_missing_after_lease',
          },
        },
      ],
    }));

    expect(r).toEqual({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'callback_infrastructure_blocked',
    });
  });

  it('runner failure is terminal instead of a blind machine retry', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, { status: 'failed', failure_class: 'runner_failure' }),
      ],
    }));

    expect(r).toEqual({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'callback_runner_failure',
    });
  });

  it('R10: first unknown no-PR callback gets one recovery attempt', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3),
      ],
    }));

    expect(r).toEqual({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'unknown_no_pr',
    });
  });

  it('R10: the second identical no-PR signature fails without a third attempt', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3),
        { hop: 4, action: 'spawn:generator-fix', observed: {} },
        callback(6),
      ],
    }));

    expect(r).toEqual({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'repeated_unknown_no_pr',
    });
  });

  it('completed generator callback carrying a PR waits for authoritative projection', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, {
          artifacts: [{
            type: 'pull_request',
            url: 'https://github.com/acme/repo/pull/7',
            head_sha: 'a'.repeat(40),
          }],
        }),
      ],
    }));

    expect(r).toEqual({
      phase: 'generate',
      action: 'wait:running',
      reason: 'callback_pr_projection_pending',
    });
  });

  it('generator-fix infrastructure callback wins over stale no-progress evidence', () => {
    const r = derive(baseObserved({
      noProgress: true,
      noProgressReason: 'no_progress_same_sha',
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: { trigger_sha: 'sha-new' } },
        callback(3, {
          status: 'blocked',
          failure_class: 'infrastructure_blocked',
        }),
      ],
    }));

    expect(r).toEqual({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'callback_infrastructure_blocked',
    });
  });

  it('R10: unverified worker artifact churn cannot evade the second no-PR stop', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        callback(3, { artifacts: [{ type: 'note', value: 'first claim' }] }),
        { hop: 4, action: 'spawn:generator-fix', observed: {} },
        callback(6, { artifacts: [{ type: 'note', value: 'different claim' }] }),
      ],
    }));

    expect(r).toEqual({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'repeated_unknown_no_pr',
    });
  });
});

describe('规则 0.6：MAX_HOPS 宽兜底（P2）', () => {
  it('hops >= 4096 → failed reason=hop_cap', () => {
    const r = derive(baseObserved({
      counters: { hops: MAX_HOPS, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('hop_cap');
  });
});

describe('merged 短路（routeAfterPoll merged 语义）', () => {
  it('任何时刻 pr.merged=true → 直入 report，跳过所有 spawn', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'MERGED', ci: 'fail', merged: true, head_sha: 's' },
      contract: { approved: true },
    }));
    expect(r.action).toBe('report');
    expect(r.phase).toBe('done');
  });

  it('ci fail 也不入 fix，merged 优先', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'MERGED', ci: 'fail', merged: true, head_sha: 's' },
      counters: { hops: 1, fixRound: 3, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    }));
    expect(r.action).toBe('report');
  });

  it('no-progress 已落库后 PR 被 merge，merged 仍优先收敛为 done', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'MERGED', ci: 'fail', merged: true, head_sha: 's' },
      noProgress: true,
      noProgressReason: 'no_progress_same_sha',
    }));
    expect(r).toEqual({ phase: 'done', action: 'report', reason: 'pr_merged' });
  });
});

describe('human review rejection', () => {
  it('a rejection for the current SHA and request hop terminates the run', () => {
    const r = derive(baseObserved({
      decisionLog: [{
        hop: 7,
        action: 'effect:human_review_requested',
        observed: { pr: { head_sha: 'sha-new' } },
        detail: { review_reason: 'failure_set_repeated' },
      }, {
        hop: 8,
        action: 'verdict:human_review',
        observed: { pr: { head_sha: 'sha-new' } },
        detail: {
          verdict: 'REJECTED',
          approved: false,
          rejected: true,
          pr_head_sha: 'sha-new',
          review_request_hop: 7,
        },
      }],
    }));

    expect(r).toEqual({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'human_review_rejected',
    });
  });
});

describe('规则 1：planning', () => {
  it('!prd存在 → phase=planning, action=spawn:planner', () => {
    const r = derive(baseObserved({ prdExists: false, contract: { approved: false }, pr: null }));
    expect(r.phase).toBe('planning');
    expect(r.action).toBe('spawn:planner');
  });
});

describe('规则 2：GAN（prd 存在 && contract 未 approved）', () => {
  const gan = (overrides = {}) => baseObserved({ contract: { approved: false }, pr: null, ...overrides });

  it('分支无 rN 合同 → spawn:proposer', () => {
    const r = derive(gan({ proposeBranchRn: 0 }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('spawn:proposer');
  });

  it('最新 rN 合同存在且无本轮 verdict → spawn:reviewer', () => {
    const r = derive(gan({ proposeBranchRn: 1, ganLatestRoundVerdict: null }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('spawn:reviewer');
  });

  it('最新 rN 有 REVISION verdict → 回 proposer（GAN 交替）', () => {
    const r = derive(gan({ proposeBranchRn: 2, ganLatestRoundVerdict: 'REVISION' }));
    expect(r.action).toBe('spawn:proposer');
  });

  it('崩溃窗口：APPROVED 已出但 contract.approved 未落库 → persist_contract_approval，不 spawn proposer', () => {
    const r = derive(gan({ proposeBranchRn: 2, ganLatestRoundVerdict: 'APPROVED' }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('persist_contract_approval');
    expect(r.reason).toBe('approved_pending_persist');
  });

  it('守护：budgetCapUsd(10) → failed', () => {
    const r = derive(gan({
      counters: { hops: 1, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: BUDGET_CAP_USD },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('gan_budget_cap');
  });

  it('守护：no_push_streak >= 2 → failed', () => {
    const r = derive(gan({
      counters: { hops: 1, fixRound: 0, pollCount: 0, noPushStreak: MAX_NO_PUSH_STREAK, noVerdictStreak: 0, ganCostUsd: 0 },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('gan_no_push_streak');
  });

  it('守护：no_verdict_streak >= 3 → failed', () => {
    const r = derive(gan({
      counters: { hops: 1, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: MAX_NO_VERDICT_STREAK, ganCostUsd: 0 },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('gan_no_verdict_streak');
  });

  describe('rubric 趋势观测安全网（PR-B，issue ce42f68f）', () => {
    function reviewerRow(round, rubric_scores) {
      return { round, author_role: 'reviewer', rubric_scores };
    }

    it('最近 3 轮某维度连续走低（案卷 diverging）→ force_approve_contract', () => {
      const caseFile = [
        reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
        reviewerRow(2, { dod_machineability: 7, scope_match_prd: 7 }),
        reviewerRow(3, { dod_machineability: 6, scope_match_prd: 7 }),
      ];
      const r = derive(gan({ proposeBranchRn: 3, ganLatestRoundVerdict: 'REVISION', caseFile }));
      expect(r.phase).toBe('gan');
      expect(r.action).toBe('force_approve_contract');
      expect(r.reason).toBe('convergence_diverging');
    });

    it('最近 3 轮某维度高低高震荡（案卷 oscillating）→ force_approve_contract', () => {
      const caseFile = [
        reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
        reviewerRow(2, { dod_machineability: 6, scope_match_prd: 7 }),
        reviewerRow(3, { dod_machineability: 8, scope_match_prd: 7 }),
      ];
      const r = derive(gan({ proposeBranchRn: 3, ganLatestRoundVerdict: 'REVISION', caseFile }));
      expect(r.phase).toBe('gan');
      expect(r.action).toBe('force_approve_contract');
      expect(r.reason).toBe('convergence_oscillating');
    });

    it('案卷 converging（全维度持平/上升）→ 原路由不动，仍走 spawn:proposer', () => {
      const caseFile = [
        reviewerRow(1, { dod_machineability: 5, scope_match_prd: 5 }),
        reviewerRow(2, { dod_machineability: 6, scope_match_prd: 6 }),
        reviewerRow(3, { dod_machineability: 7, scope_match_prd: 7 }),
      ];
      const r = derive(gan({ proposeBranchRn: 3, ganLatestRoundVerdict: 'REVISION', caseFile }));
      expect(r.action).toBe('spawn:proposer');
    });

    it('案卷 insufficient_data（< 3 轮/缺字段）→ 原路由不动', () => {
      const r = derive(gan({ proposeBranchRn: 1, ganLatestRoundVerdict: null, caseFile: [] }));
      expect(r.action).toBe('spawn:reviewer');
    });

    it('observed.caseFile 缺省（未注入）→ 不崩，按 insufficient_data 走原路由', () => {
      const r = derive(gan({ proposeBranchRn: 1, ganLatestRoundVerdict: null }));
      expect(r.action).toBe('spawn:reviewer');
    });

    it('趋势闸在三闸（budget/noPush/noVerdict）之后判定：budget 超限优先 failed，不看案卷', () => {
      const caseFile = [
        reviewerRow(1, { dod_machineability: 8 }),
        reviewerRow(2, { dod_machineability: 7 }),
        reviewerRow(3, { dod_machineability: 6 }),
      ];
      const r = derive(gan({
        counters: { hops: 1, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: BUDGET_CAP_USD },
        caseFile,
      }));
      expect(r.phase).toBe('failed');
      expect(r.reason).toBe('gan_budget_cap');
    });

    it('F5（审查修复）：本轮 verdict 尚未产生（awaiting review）时，即使案卷发散，趋势闸仍让路给 spawn:reviewer——不冻结从未被评审过的 SHA', () => {
      const caseFile = [
        reviewerRow(1, { dod_machineability: 8 }),
        reviewerRow(2, { dod_machineability: 7 }),
        reviewerRow(3, { dod_machineability: 6 }),
      ];
      // proposeBranchRn>=1 且 ganLatestRoundVerdict==null → 趋势闸必须排在这条判断之后，
      // 否则会出现"强制批准一个还没有任何人（含代码）评审过的 SHA"的上线切换窗口。
      const r = derive(gan({ proposeBranchRn: 4, ganLatestRoundVerdict: null, caseFile }));
      expect(r.action).toBe('spawn:reviewer');
    });

    it('F2(b)（审查修复）：真实 reviewer APPROVED 不得被趋势闸劫持，即使案卷同时判 diverging 仍无条件 persist_contract_approval', () => {
      const caseFile = [
        reviewerRow(1, { dod_machineability: 9 }),
        reviewerRow(2, { dod_machineability: 8 }),
        reviewerRow(3, { dod_machineability: 7 }),
      ];
      const r = derive(gan({ proposeBranchRn: 3, ganLatestRoundVerdict: 'APPROVED', caseFile }));
      expect(r.phase).toBe('gan');
      expect(r.action).toBe('persist_contract_approval');
      expect(r.reason).toBe('approved_pending_persist');
    });

    it('F1（审查实锤复现修复）：最近一条 verdict:reviewer 是 validation-identity-policy 驳回当前 SHA 时，趋势闸让路回 spawn:proposer（防 4096 跳热循环）', () => {
      const sha = 'f'.repeat(40);
      const caseFile = [
        reviewerRow(1, { dod_machineability: 9 }),
        reviewerRow(2, { dod_machineability: 8 }),
        reviewerRow(3, { dod_machineability: 7 }),
      ];
      const decisionLog = [
        {
          hop: 5,
          action: 'verdict:reviewer',
          detail: {
            rn: 3,
            contract_sha: sha,
            verdict: 'REVISION',
            source: 'validation_identity_policy',
            summary: '合同硬编码了 validation identity。',
            reason: '删除硬编码字面值。',
          },
        },
      ];
      const r = derive(gan({
        proposeBranchRn: 3,
        proposeBranchSha: sha,
        ganLatestRoundVerdict: 'REVISION',
        caseFile,
        decisionLog,
      }));
      expect(r.action).toBe('spawn:proposer');
    });

    it('F1 对照组：最近一条 verdict:reviewer 是普通 REVISION（非 identity-policy 来源）时，趋势闸正常开火', () => {
      const sha = 'f'.repeat(40);
      const caseFile = [
        reviewerRow(1, { dod_machineability: 9 }),
        reviewerRow(2, { dod_machineability: 8 }),
        reviewerRow(3, { dod_machineability: 7 }),
      ];
      const decisionLog = [
        {
          hop: 5,
          action: 'verdict:reviewer',
          detail: { rn: 3, contract_sha: sha, verdict: 'REVISION' },
        },
      ];
      const r = derive(gan({
        proposeBranchRn: 3,
        proposeBranchSha: sha,
        ganLatestRoundVerdict: 'REVISION',
        caseFile,
        decisionLog,
      }));
      expect(r.action).toBe('force_approve_contract');
    });

    it('F1 对照组：identity-policy 驳回的是旧 SHA（proposer 已经 push 了新一轮），趋势闸不该被旧记录挡住', () => {
      const oldSha = 'a'.repeat(40);
      const newSha = 'b'.repeat(40);
      const caseFile = [
        reviewerRow(1, { dod_machineability: 9 }),
        reviewerRow(2, { dod_machineability: 8 }),
        reviewerRow(3, { dod_machineability: 7 }),
      ];
      const decisionLog = [
        {
          hop: 5,
          action: 'verdict:reviewer',
          detail: {
            rn: 3, contract_sha: oldSha, verdict: 'REVISION', source: 'validation_identity_policy',
          },
        },
      ];
      const r = derive(gan({
        proposeBranchRn: 4,
        proposeBranchSha: newSha,
        ganLatestRoundVerdict: 'REVISION',
        caseFile,
        decisionLog,
      }));
      expect(r.action).toBe('force_approve_contract');
    });
  });
});

describe('规则 3a：contract approved && !pr', () => {
  it('generator 从未派过 → spawn:generator', () => {
    const r = derive(baseObserved({ pr: null, generatorSpawned: false, lastAgentExit: { code: null, auth_failed: false } }));
    expect(r.phase).toBe('generate');
    expect(r.action).toBe('spawn:generator');
  });

  it('generator 已退出且无 PR（no_pr）→ spawn:generator-fix，fixRound 仅观测', () => {
    const r = derive(baseObserved({ pr: null, generatorSpawned: true, lastAgentExit: { code: 0, auth_failed: false } }));
    expect(r.action).toBe('spawn:generator-fix');
  });

  it('no_pr && 任意高 fixRound 仍由收敛探测决定，不能命中固定轮次 cap', () => {
    const r = derive(baseObserved({
      pr: null,
      generatorSpawned: true,
      counters: { hops: 1, fixRound: 10000, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    }));
    expect(r).toMatchObject({ phase: 'generate', action: 'spawn:generator-fix', reason: 'no_pr' });
  });
});

describe('规则 3d：exit/auth 观测分路（P0-3，routeAfterCallback ci_fail_type∈{container_exit,auth_failed}→fix）', () => {
  it('evaluator provider 退出 → 重派 evaluator，不误派 generator-fix', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 's' },
      lastAgentExit: { code: 1, auth_failed: false, action: 'spawn:evaluator' },
    }));
    expect(r.phase).toBe('evaluate');
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('no_evaluate_verdict_for_head_sha');
  });

  it('auth_failed → spawn:generator-fix（熔断状态给 T3 换号）', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' },
      lastAgentExit: { code: 1, auth_failed: true },
    }));
    expect(r.action).toBe('spawn:generator-fix');
  });

  it('container_exit（非零退出码，如 OOM 137）→ spawn:generator-fix', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' },
      lastAgentExit: { code: 137, auth_failed: false },
    }));
    expect(r.action).toBe('spawn:generator-fix');
  });

  it('auth_failed && 任意高 fixRound 仍可按真实故障路由 fix', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' },
      lastAgentExit: { code: 1, auth_failed: true },
      counters: { hops: 1, fixRound: 10000, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    }));
    expect(r).toMatchObject({ phase: 'generate', action: 'spawn:generator-fix', reason: 'auth_failed' });
  });
});

describe('规则 3b：ci pending → poll', () => {
  it('pr && ci pending → wait:poll_ci', () => {
    const r = derive(baseObserved({ pr: { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' } }));
    expect(r.action).toBe('wait:poll_ci');
  });

  it('poll 超限（20×90s）→ failed reason=ci_timeout（旧 timeout→END，新=failed 终局，语义等价声明）', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'OPEN', ci: 'pending', merged: false, head_sha: 's' },
      counters: { hops: 1, fixRound: 0, pollCount: MAX_POLL_COUNT, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('ci_timeout');
  });
});

describe('规则 3c：ci fail → 收敛驱动 fix loop', () => {
  it('ci fail → spawn:generator-fix', () => {
    const r = derive(baseObserved({ pr: { url: 'u', state: 'OPEN', ci: 'fail', merged: false, head_sha: 's' } }));
    expect(r.action).toBe('spawn:generator-fix');
  });

  it('ci fail && 任意高 fixRound 仍继续，禁止固定轮次终局', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'OPEN', ci: 'fail', merged: false, head_sha: 's' },
      counters: { hops: 1, fixRound: 10000, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    }));
    expect(r).toMatchObject({ phase: 'generate', action: 'spawn:generator-fix', reason: 'ci_fail' });
  });

  it('Run B 重现 Run A 的规范化 failure set → human review，不创建 generator-fix', () => {
    const r = derive(baseObserved({
      pr: {
        url: 'u',
        state: 'OPEN',
        ci: 'fail',
        merged: false,
        head_sha: 'sha-run-b',
        failed_checks: ['test:b', 'lint'],
      },
      historicalFailureSets: [[' lint ', 'test:b', 'lint']],
    }));

    expect(r).toEqual({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'failure_set_repeated_across_runs',
    });
  });
});

describe('规则 4a：evaluate（verdict SHA 锚定，P0-2）', () => {
  it('当前 head_sha 无 evaluate 记录 → spawn:evaluator', () => {
    const r = derive(baseObserved({ evaluateVerdict: null }));
    expect(r.phase).toBe('evaluate');
    expect(r.action).toBe('spawn:evaluator');
  });

  it('stale PASS + 新 sha → 重新 evaluate（gates 拒绝 stale PASS 的 derive 侧对应）', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-old' },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-new' },
    }));
    expect(r.action).toBe('spawn:evaluator');
  });

  it('FIXED 归一为 PASS → 进 judge 而非重新 evaluate（harness-evaluator-verdict-bug）', () => {
    const r = derive(baseObserved({ evaluateVerdict: { verdict: 'FIXED', pr_head_sha: 'sha-new' } }));
    expect(r.action).toBe('spawn:judge');
  });

  it("failure_class='contract_invalid' → failed 不入 fix loop（routeAfterEvaluate 语义：责任在 GAN）", () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'contract_invalid' },
    }));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('contract_invalid');
  });

  it('evaluate FAIL（非 contract_invalid，本 sha）→ spawn:generator-fix（routeAfterEvaluate 否则 fix）', () => {
    const r = derive(baseObserved({ evaluateVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new' } }));
    expect(r.action).toBe('spawn:generator-fix');
  });
});

describe('规则 4b：judge 硬门禁', () => {
  it('evaluate PASS（本 sha）&& 无 judge 记录（本 sha）→ spawn:judge', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: null,
    }));
    expect(r.action).toBe('spawn:judge');
  });

  it('judge 记录是旧 sha → 视为无记录，重新 spawn:judge', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-old' },
    }));
    expect(r.action).toBe('spawn:judge');
  });
});

describe('规则 4c：judge FAIL → 显式分支（P0-2）', () => {
  it('judge FAIL（本 sha）且 failure_class 字段缺失 → unknown human review', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new' },
    }));
    expect(r).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'unknown:awaiting_human_review',
    });
  });
});

describe('规则 4c：unsigned evidence approval one-shot repair', () => {
  const unsignedVerdict = {
    hop: 3,
    action: 'verdict:evaluate',
    detail: {
      verdict: 'FAIL',
      failure_class: 'evidence_invalid',
      pr_head_sha: 'sha-new',
    },
  };
  const firstRepair = {
    hop: 4,
    action: 'spawn:evaluator-evidence-repair',
    observed: {
      pr: { head_sha: 'sha-new' },
      failure_class: 'evidence_invalid',
    },
  };
  const repeatedUnsignedVerdict = {
    hop: 5,
    action: 'verdict:evaluate',
    detail: {
      verdict: 'FAIL',
      failure_class: 'evidence_invalid',
      pr_head_sha: 'sha-new',
    },
  };
  const reviewRequest = {
    hop: 6,
    action: 'effect:human_review_requested',
    observed: {
      pr: { head_sha: 'sha-new' },
      failure_class: 'evidence_invalid',
    },
    detail: { review_reason: 'unknown:missing_failure_signature' },
  };
  const approval = {
    hop: 7,
    action: 'verdict:human_review',
    detail: {
      approved: true,
      review_class: 'evidence_repair',
      pr_head_sha: 'sha-new',
      review_request_hop: 6,
    },
  };

  it('approval unlocks exactly one unsigned evidence repair', () => {
    const r = derive(baseObserved({
      evaluateVerdict: repeatedUnsignedVerdict.detail,
      decisionLog: [
        unsignedVerdict,
        firstRepair,
        repeatedUnsignedVerdict,
        reviewRequest,
        approval,
      ],
    }));

    expect(r).toMatchObject({
      phase: 'evaluate',
      action: 'spawn:evaluator-evidence-repair',
      reason: 'evidence_invalid:approved_single_retry',
    });
  });

  it('another unsigned verdict after the approved repair fails without a second review', () => {
    const approvedRepair = {
      hop: 8,
      action: 'spawn:evaluator-evidence-repair',
      observed: {
        pr: { head_sha: 'sha-new' },
        failure_class: 'evidence_invalid',
      },
    };
    const postApprovalVerdict = {
      hop: 9,
      action: 'verdict:evaluate',
      detail: {
        verdict: 'FAIL',
        failure_class: 'evidence_invalid',
        pr_head_sha: 'sha-new',
      },
    };
    const r = derive(baseObserved({
      evaluateVerdict: postApprovalVerdict.detail,
      decisionLog: [
        unsignedVerdict,
        firstRepair,
        repeatedUnsignedVerdict,
        reviewRequest,
        approval,
        approvedRepair,
        postApprovalVerdict,
      ],
    }));

    expect(r).toMatchObject({
      phase: 'failed',
      action: 'mark_failed',
      reason: 'repeated_evidence_invalid_after_approval',
    });
  });
});

describe('规则 4d：human review', () => {
  it('双 PASS && review_required && 未批准 → wait:human_review', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      reviewRequired: true,
      reviewApproved: false,
    }));
    expect(r.action).toBe('wait:human_review');
  });
});

describe('规则 4e：merge', () => {
  it('全门过 && !merged → merge_pr', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      reviewRequired: false,
    }));
    expect(r.action).toBe('merge_pr');
  });

  it('review_required 且已批准 → merge_pr', () => {
    const r = derive(baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      reviewRequired: true,
      reviewApproved: true,
    }));
    expect(r.action).toBe('merge_pr');
  });
});

describe('确定性纪律：observed 缺字段 fail-fast', () => {
  it('缺 inflight → throw 带字段名', () => {
    const o = baseObserved();
    delete o.inflight;
    expect(() => derive(o)).toThrow(/inflight/);
  });

  it('缺 counters → throw 带字段名', () => {
    const o = baseObserved();
    delete o.counters;
    expect(() => derive(o)).toThrow(/counters/);
  });

  it('缺 pr 键（区别于 pr:null）→ throw 带字段名', () => {
    const o = baseObserved();
    delete o.pr;
    expect(() => derive(o)).toThrow(/pr/);
  });
});
