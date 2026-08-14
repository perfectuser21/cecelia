/**
 * derive(observed) 纯函数全分支测试。
 * 对齐：docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md §phase/action 推导语义
 *      + docs/current/harness-orchestration-redesign/routing-extraction.md 路由决策表。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../derive.js';
import { deriveCounters } from '../counters.js';
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

  // 仲裁制(Alex 拍板 2026-08-06):Generator 喊"合同有矛盾"只是申诉,不能自动
  // 成立——运动员不能自己当裁判。必须由独立 Judge 仲裁:成立才重开 GAN,
  // 驳回则打回 generator-fix 继续干活。
  const arb = (hop, cbHop, upheld) => ({
    hop,
    action: 'verdict:contract_arbitration',
    detail: { callback_hop: cbHop, upheld, reasoning: 'x' },
  });

  it.each([
    ['FROZEN_CONTRACT_ARTIFACTS_MISSING', 'frozen_contract_artifacts_missing'],
    ['FROZEN_CONTRACT_ARTIFACT_INVALID', 'frozen_contract_artifact_invalid'],
    ['FROZEN_CONTRACT_ARTIFACT_MATERIALIZATION_FAILED', 'frozen_contract_artifact_materialization_failed'],
  ])('approved artifact assembly fault %s 精确终止，不进入 human review', (errorCode, reason) => {
    const result = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        cb(3, { error_code: errorCode }),
      ],
    }));

    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe(reason);
  });

  it('generator 报合同故障码且无仲裁记录 → 先派仲裁,不直接重开', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3),
      ],
    }));
    expect(r.action).toBe('arbitrate:contract_fault');
    expect(r.reason).toBe('contract_fault_appeal');
    expect(r.callbackHop).toBe(3);
  });

  it('CONTRACT_CI_SCOPE_CONFLICT(r43 实证:合同范围与仓库 CI 硬要求冲突)同样进仲裁', () => {
    // r43 实证:合同限定只改 scripts/product-map/,但仓库 CI Orphan Test Check
    // 强制要求登记根目录 test-registry.yaml——合同与仓库级约定客观冲突,
    // generator/generator-fix 无法在不违约的前提下修复 CI。这是合同的锅
    // (GAN 不知道仓库约定),必须能走仲裁→重开 GAN 扩范围,不能死等人工。
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3, { error_code: 'CONTRACT_CI_SCOPE_CONFLICT' }),
      ],
    }));
    expect(r.action).toBe('arbitrate:contract_fault');
  });

  it('故障码拼写漂移(CONTRACT_SCOPE_CI_CONFLICT 词序不同)同样命中——LLM 产码非稳定枚举(r43 二次实证)', () => {
    // r43 实证:同一模型两次采样分别报 CONTRACT_CI_SCOPE_CONFLICT 与
    // CONTRACT_SCOPE_CI_CONFLICT,后者绕过精确匹配掉回死等人工。
    // 机器侧必须 token 集合归一化匹配,不能指望 LLM 拼写稳定。
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3, { error_code: 'CONTRACT_SCOPE_CI_CONFLICT' }),
      ],
    }));
    expect(r.action).toBe('arbitrate:contract_fault');
  });

  it('故障码带额外前缀词(APPROVED_CONTRACT_CI_CONFLICT,丢词序漂移)仍命中——F6/codexC 案卷实证', () => {
    // run 8374ab73(codex team2)案卷:LLM 报 APPROVED_CONTRACT_CI_CONFLICT——
    // 比 CONTRACT_CI_SCOPE_CONFLICT 多了修饰词 APPROVED、少了 SCOPE。
    // 精确 token 集合比对(排序后整体相等)对不上，漏判掉进死等人工。
    // 核心 token 子集匹配（reported ⊇ canonical 核心词）能扛住"多词/丢词"两种漂移。
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3, { error_code: 'APPROVED_CONTRACT_CI_CONFLICT' }),
      ],
    }));
    expect(r.action).toBe('arbitrate:contract_fault');
  });

  it('无关故障码不误判进仲裁——核心子集匹配不过度放宽', () => {
    // 防回归：子集匹配改法必须精确到"核心词组合"，不能退化成任意包含 CONTRACT
    // 就算数——否则会把真正的产品 bug 误路由成合同申诉。status/failure_class
    // 与真实合同故障同款(blocked)，唯一变量是 error_code 与三个核心组合都不沾边。
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3, { error_code: 'CONTRACT_MISSING_FIXTURE' }),
      ],
    }));
    expect(r.action).not.toBe('arbitrate:contract_fault');
    expect(r.action).toBe('wait:human_review');
  });

  it('仲裁 upheld=true → reopen_gan_contract', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator-fix', observed: {} },
        cb(3),
        arb(4, 3, true),
      ],
    }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('reopen_gan_contract');
    expect(r.reason).toBe('contract_fault_reopen_gan');
    expect(r.callbackHop).toBe(3);
  });

  it('仲裁 upheld=false(申诉驳回) → 打回 generator-fix,合同不动', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        cb(3),
        arb(4, 3, false),
      ],
    }));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('contract_appeal_rejected');
  });

  it('仲裁 upheld=null(仲裁器不可用) → 等人工,不误判任何一方', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        cb(3),
        arb(4, 3, null),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('contract_arbitration_unavailable');
  });

  it('CONTRACT_TEST_UNSATISFIABLE(r33 形态)+仲裁成立同样重开 GAN', () => {
    const r = derive(baseObserved({
      pr: null,
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        cb(3, { error_code: 'CONTRACT_TEST_UNSATISFIABLE' }),
        arb(4, 3, true),
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
        arb(4, 3, true),
        { hop: 5, action: 'reopen_gan_contract', detail: { callback_hop: 3 } },
        { hop: 6, action: 'spawn:generator', observed: {} },
        cb(8),
        arb(9, 8, true),
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
        arb(4, 3, true),
        { hop: 5, action: 'reopen_gan_contract', detail: { callback_hop: 3 } },
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

  it('重开后 reviewer 已出新 REVISION:趋势闸仍不得拿跨纪元旧轮判震荡强批(r43 实证)', () => {
    // r43 实证:重开后 reviewer 重审判 REVISION(hop>reopen),#4664 的让路守卫
    // (reopen 比最新 reviewer 行新)随即解除,趋势闸用重开前 1-3 轮 + 重开后 1 轮
    // 的全量案卷判 oscillating → 把刚被证伪的合同原样强批回去,重开被撤销。
    // 纪元规则:趋势闸只看重开纪元内的案卷轮(E 号故障轮起);不足以判趋势 →
    // 老实回 spawn:proposer 修合同。
    const reviewerRow = (round, rubric_scores) => ({ round, author_role: 'reviewer', rubric_scores });
    const caseFile = [
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 6, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 8, scope_match_prd: 7 }),
      // 重开写入的 E 号故障轮(round 4)
      {
        round: 4,
        author_role: 'reviewer',
        rubric_scores: null,
        blockers: [{ id: 'E4-1', status: 'open', title: '合同资产被下游执行证伪（合同故障重开）' }],
      },
      // 重开后 reviewer 重审(round 4 之后的新轮打分)——与重开前旧轮拼起来
      // 正好构成 6<8>6 双腿≥2 的"震荡",这是 r43 被强批的确切形态
      reviewerRow(5, { dod_machineability: 6, scope_match_prd: 7 }),
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
        { hop: 6, action: 'verdict:reviewer', detail: { verdict: 'REVISION_REQUESTED', rn: 3 } },
      ],
    }));
    expect(r.action).toBe('spawn:proposer');
    expect(r.action).not.toBe('force_approve_contract');
  });
});

describe('证据不足退回 Evaluator 重新取证（r41 实证：Judge 要证据却退给 Generator 改码）', () => {
  // Judge 判 FAIL 说"你给的证据不足/取证方式不对"时，要做的是重新取证（Evaluator
  // 的活），不是改产品代码（Generator 的活）——产品代码可能完全正确。r41 实证：
  // Judge 要"失败路径下直接执行 CLI 的原始 stdout 与退出码"，而 Evaluator 只交了
  // "回归测试套件跑绿了"。旧实现没有这条路径，Judge FAIL 全掉 unknown 死等人工。
  const judgeFail = (fc) => baseObserved({
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
    judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: fc },
    decisionLog: [
      { hop: 1, action: 'spawn:generator', observed: {} },
      { hop: 2, action: 'verdict:evaluate', detail: { verdict: 'PASS', pr_head_sha: 'sha-new' } },
      { hop: 3, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: fc, feedback: '需要失败路径直接执行的 stdout 与退出码' } },
    ],
  });

  it('judge FAIL + evidence_insufficient → 重派 evaluator 取证，不派 generator-fix', () => {
    const r = derive(judgeFail('evidence_insufficient'));
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
    expect(r.phase).toBe('evaluate');
  });

  it('judge FAIL + product_failure → 仍走 generator-fix（改代码）', () => {
    const r = derive(judgeFail('product_failure'));
    expect(r.action).toBe('spawn:generator-fix');
  });

  it('同一 SHA 已重新取证过一次仍 evidence_insufficient → 不再重派，回落人工（防取证死循环）', () => {
    const o = judgeFail('evidence_insufficient');
    o.decisionLog.push({ hop: 4, action: 'spawn:evaluator', observed: { trigger_sha: 'sha-new' }, detail: { reason: 'judge_evidence_insufficient_recollect' } });
    o.decisionLog.push({ hop: 5, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'evidence_insufficient' } });
    const r = derive(o);
    expect(r.action).toBe('wait:human_review');
  });

  // === 永久回归 port（issue dbea513f / run 06e4566c 取证死循环双修，bug-fix 死规矩）===
  // 与 sprints/08111523-kernel-c9043059/tests/derive-recollect-loop.test.ts 的 B-01/B-02 同构，
  // 入 derive.test.js 作 CI 常驻回归，防护栏再破。

  it('recollect 后更晚 evaluate PASS 遮蔽陈旧 judge FAIL → 派 judge 复核（evaluate_passed_awaiting_judge）', () => {
    const o = judgeFail('evidence_insufficient');
    // 补证：晚于最新 judge(hop3) 的 evaluate PASS(hop5)
    o.decisionLog.push({ hop: 4, action: 'spawn:evaluator', observed: { pr: { head_sha: 'sha-new' } }, detail: { reason: 'judge_evidence_insufficient_recollect' } });
    o.decisionLog.push({ hop: 5, action: 'verdict:evaluate', detail: { verdict: 'PASS', pr_head_sha: 'sha-new' } });
    const r = derive(o);
    expect(r.action).toBe('spawn:judge');
    expect(r.reason).toBe('evaluate_passed_awaiting_judge');
  });

  it('recollect 快照缺 trigger_sha 仅 pr.head_sha，重审仍不足 → guard 兜底落人审（evidence_insufficient_after_recollect）', () => {
    const o = judgeFail('evidence_insufficient');
    // spawn:evaluator 快照顶层缺 trigger_sha（生产实证），只有 pr.head_sha
    o.decisionLog.push({ hop: 4, action: 'spawn:evaluator', observed: { pr: { head_sha: 'sha-new' } }, detail: { reason: 'judge_evidence_insufficient_recollect' } });
    o.decisionLog.push({ hop: 5, action: 'verdict:evaluate', detail: { verdict: 'PASS', pr_head_sha: 'sha-new' } });
    o.decisionLog.push({ hop: 6, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'evidence_insufficient' } });
    const r = derive(o);
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
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

describe('规则 0.4 no-progress：基础设施 fix 轮无事可做不终局（b19e6e6e 集成）', () => {
  // deriveCounters → derive 全链：基础设施触发的 fix 轮 SHA 不变，不得判 no-progress
  // 终局，而应放行到下游正常路由（CI 轮询 / verdict chain），不 mark_failed。
  const triggerSha = 'b4d2c85e5e82d1375f6a1baa56096534007d08a3';
  const infraFixLog = [
    {
      hop: 21,
      action: 'spawn:generator-fix',
      observed: { trigger_sha: triggerSha, failure_class: 'infrastructure_blocked' },
    },
    {
      hop: 24,
      action: 'verdict:generator-fix-callback',
      observed: { pr_head_sha: triggerSha, trigger_hop: 21 },
      detail: {
        status: 'completed_with_concerns',
        verification_status: 'verified',
        pr_head_sha: triggerSha,
        trigger_sha: triggerSha,
      },
    },
  ];

  it('基础设施场景喂 derive → action 不是 mark_failed，进入下游路由', () => {
    const counters = deriveCounters(infraFixLog, { proposeBranchMaxRn: 0 });
    expect(counters.noProgress).toBe(false);
    const r = derive(baseObserved({
      pr: { url: 'https://github.com/x/y/pull/4746', state: 'OPEN', ci: 'pass', merged: false, head_sha: triggerSha },
      decisionLog: infraFixLog,
      noProgress: counters.noProgress,
      noProgressReason: counters.noProgressReason,
    }));
    expect(r.action).not.toBe('mark_failed');
    expect(r.phase).not.toBe('failed');
  });

  it('反向红线：product_failure 同签名 SHA 不变 → derive 仍 mark_failed（no_progress_same_sha）', () => {
    const productFixLog = [
      {
        hop: 21,
        action: 'spawn:generator-fix',
        observed: { trigger_sha: triggerSha, failure_class: 'product_failure' },
      },
      {
        hop: 24,
        action: 'verdict:generator-fix-callback',
        observed: { pr_head_sha: triggerSha, trigger_hop: 21 },
        detail: {
          status: 'completed_with_concerns',
          verification_status: 'verified',
          pr_head_sha: triggerSha,
          trigger_sha: triggerSha,
        },
      },
    ];
    const counters = deriveCounters(productFixLog, { proposeBranchMaxRn: 0 });
    expect(counters.noProgress).toBe(true);
    const r = derive(baseObserved({
      pr: { url: 'https://github.com/x/y/pull/4746', state: 'OPEN', ci: 'pass', merged: false, head_sha: triggerSha },
      decisionLog: productFixLog,
      noProgress: counters.noProgress,
      noProgressReason: counters.noProgressReason,
    }));
    expect(r).toEqual({ phase: 'failed', action: 'mark_failed', reason: 'no_progress_same_sha' });
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

describe('merged 短路（routeAfterPoll merged 语义 — fail-closed 双 PASS receipt 守卫）', () => {
  // #4870 修法：merged 不再无条件 done。合法合并须同一 head_sha 上 Evaluator PASS/FIXED
  // + Judge PASS 双 receipt 齐备（Harness merge handler 合法路径），旧「merged 即 done」用例
  // 补齐双 PASS receipt；缺 receipt 的外部提前合并另立 premature_merge 用例覆盖。
  const dualPass = (sha) => ({
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: sha },
    judgeVerdict: { verdict: 'PASS', pr_head_sha: sha },
  });

  it('双 PASS receipt + pr.merged=true → 直入 report，跳过所有 spawn', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'MERGED', ci: 'fail', merged: true, head_sha: 's' },
      contract: { approved: true },
      ...dualPass('s'),
    }));
    expect(r.action).toBe('report');
    expect(r.phase).toBe('done');
  });

  it('ci fail 也不入 fix，merged（双 PASS receipt）优先', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'MERGED', ci: 'fail', merged: true, head_sha: 's' },
      counters: { hops: 1, fixRound: 3, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
      ...dualPass('s'),
    }));
    expect(r.action).toBe('report');
  });

  it('no-progress 已落库后 PR 被 merge（双 PASS receipt）→ 仍收敛为 done', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'MERGED', ci: 'fail', merged: true, head_sha: 's' },
      noProgress: true,
      noProgressReason: 'no_progress_same_sha',
      ...dualPass('s'),
    }));
    expect(r).toEqual({ phase: 'done', action: 'report', reason: 'pr_merged' });
  });

  it('外部提前合并（merged=true 但缺同 head 双 PASS receipt）→ premature_merge，不假 done', () => {
    const r = derive(baseObserved({
      pr: { url: 'u', state: 'MERGED', ci: 'pass', merged: true, head_sha: 's' },
    }));
    expect(r).toEqual({ phase: 'failed', action: 'mark_failed', reason: 'premature_merge' });
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

describe('跨 Run 恢复：已有 PR 必须由当前 Run 的 Generator 重新封印', () => {
  it.each(['default', 'segmented'])(
    'gear=%s 且当前 Run 没有 Generator 证据时先派 generator-fix，不越级进 Evaluator',
    (gear) => {
      const r = derive(baseObserved({
        gear,
        generatorSpawned: false,
        decisionLog: [],
        pr: {
          url: 'https://github.com/perfectuser21/cecelia/pull/4851',
          state: 'OPEN',
          ci: 'pass',
          merged: false,
          head_sha: '5fcb7b48b7f6cff567da93e79b6e7b463ace29e8',
        },
      }));

      expect(r).toEqual({
        phase: 'generate',
        action: 'spawn:generator-fix',
        reason: 'current_run_generator_required_for_existing_pr',
      });
    },
  );
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

/**
 * [BEHAVIOR] kernel derive() 按 payload.gear 三档分流（sprint 08091640）。
 *
 * 覆盖父路 e6f803f2 工厂·F1 开发闭环·步1「接单进车间即分档」(3bf6c116) 第 3-4 步。
 * 纯函数真验（无 mock、无替身、无 DB）——被改的边就是 derive 状态机本身，直接喂 observed 断言。
 * 来源：sprints/08091640-kernel-gear-dispatch/tests/derive-gear.test.js（合同 TDD Red 证据副本原样搬入）。
 */
describe('kernel derive() gear 三档分流 [BEHAVIOR]', () => {
  /** 初始态：prd 未落盘、合同未批、无 PR、generator 未派——现行 default 从这里进 planner。 */
  function gearInitialObserved(overrides = {}) {
    return {
      run: { phase: 'planning' },
      task: { status: 'in_progress' },
      prdExists: false,
      contract: { approved: false },
      pr: null,
      inflight: { containers: [], host_pids: [], attempts: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: false,
      evaluateVerdict: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: [],
      counters: {
        hops: 1, fixRound: 0, pollCount: 0,
        noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
      },
      ...overrides,
    };
  }

  it('gear=hotfix 初始态 返回 action 不等于 spawn:planner（跳过 planning/gan 直进 generate）', () => {
    const d = derive(gearInitialObserved({ gear: 'hotfix' }));
    expect(d.action).not.toBe('spawn:planner');
    expect(d.phase).toBe('generate');
    expect(d.action).toBe('spawn:generator');
  });

  it('gear=hotfix 全程不派 planner/proposer/reviewer（三角色 spawn 均不出现）', () => {
    // 初始态直接进 generate，不经 planning/gan，故不可能派出这三个角色
    const d = derive(gearInitialObserved({ gear: 'hotfix' }));
    expect(['spawn:planner', 'spawn:proposer', 'spawn:reviewer']).not.toContain(d.action);
  });

  it('gear=default 初始态 返回 spawn:planner（零回归：与改动前逐字节等价）', () => {
    const d = derive(gearInitialObserved({ gear: 'default' }));
    expect(d.phase).toBe('planning');
    expect(d.action).toBe('spawn:planner');
  });

  it('gear 缺省（undefined）等价 default（零回归：现有全部用例不传 gear）', () => {
    const d = derive(gearInitialObserved()); // 不传 gear
    expect(d.action).toBe('spawn:planner');
  });

  it('gear=segmented 初始态 照跑 planner（对齐 controller segmented：planner→proposer 多段）', () => {
    const d = derive(gearInitialObserved({ gear: 'segmented' }));
    expect(d.phase).toBe('planning');
    expect(d.action).toBe('spawn:planner');
  });

  it('gear=turbo（非法值）kernel 侧 fail-closed → mark_failed reason=invalid_gear（对齐 executor.js invalid_gear）', () => {
    const d = derive(gearInitialObserved({ gear: 'turbo' }));
    expect(d.phase).toBe('failed');
    expect(d.action).toBe('mark_failed');
    expect(d.reason).toBe('invalid_gear');
  });
});
