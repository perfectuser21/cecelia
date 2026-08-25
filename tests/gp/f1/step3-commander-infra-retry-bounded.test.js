// GP-Anchor: factory/F1 造完真验 #step3
//
// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：commander lease 过期收割
// ↔ derive 纯函数 infrastructure 重试路由（有界重派）
//
// r70 (run 919d957f) / r71 连续两轮生产实证：kernel commander 的 attempt 被
// lease 过期收割（effect:expired_attempt_reconciled, failure_class=
// infrastructure_blocked, signature=worker_attempt_replacement_required_after_lease），
// infrastructureRetryForCallback 对 role='commander' 无重试路由 → 返回 null →
// derive 落 wait:human_review(callback_infrastructure_route_unknown) → 每轮都要
// 人批一次 diagnostic 才能续跑（#5058 已修消费锚，但根因——commander 缺重试
// 路由——未除）。planner/proposer/evaluator/judge 等角色都有重试路由，commander
// 是唯一漏网的角色。
//
// r60 案卷（step3-commander-degrade-continue.test.js）已确立原则：Commander 是
// 监理不是承重墙，基础设施类失败应降级续跑走 kernel 默认决策（kernel-only 语义，
// 已长期验证安全）。本批把同一原则下沉到 derive 的 expired_attempt_reconciled
// 路径（该路径被 latestUnconsumedAttemptResult 当作 terminal 捕获，coordinator 的
// degrade-continue 覆盖不到）。
//
// 修法（本批，全部落 derive.js 纯函数，只读 orchestrator_decision_log 行时序）：
//   a) commander 的 infrastructure 类失败（expired/failed + infrastructure_blocked）
//      不再直接挂人审——低于上限时 derive 让主链在当前 phase 续跑（commander 由
//      commander-coordinator 独立重派，无副作用），观测面 = action ≠ wait:human_review；
//   b) 有界兜底：同 run 内 commander 的 infrastructure 类失败累计达上限（5）后仍
//      wait:human_review，reason 保持 callback_infrastructure_route_unknown 语义并带
//      触发 callback hop 锚（fail-closed，禁止无限重派）；
//   c) 角色隔离：非 commander 角色（planner…）重试语义完全不变；
//   d) 失败类隔离：非 infrastructure 类失败（account_exhausted…）的 commander 路由不变。
//
// 按 GP 产物闸规矩写在边上：真 import derive，不 mock 被改的边（真实 decisionLog 行）。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CAND_SHA = 'df13ca81519019e790d6387229f497ba78071cfc';
const IDENTITY = { contract_id: 'c72', manifest_sha256: 'm72', source_revision: 'r72' };

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: null,
    candidate: { branch: 'cp-route-api-43e948c0', head_sha: CAND_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CAND_SHA, contract_identity: IDENTITY },
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 120, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// commander attempt lease 过期被 reconcile（r70 hop112 实录形状）
const expiredCommanderReconciled = (hop, patch = {}) => ({
  hop,
  action: 'effect:expired_attempt_reconciled',
  detail: {
    role: 'commander',
    status: 'failed',
    failure_class: 'infrastructure_blocked',
    signature: 'worker_attempt_replacement_required_after_lease',
    attempt_id: `33333333-3333-4333-8333-${String(hop).padStart(12, '0')}`,
    ...patch,
  },
});

// 单次 commander 过期链（r70 复刻）
const singleExpiredChain = () => ([
  { hop: 101, action: 'spawn:commander', observed: {} },
  expiredCommanderReconciled(112),
]);

// N 次 commander infrastructure 失败链（有界计数）
const nExpiredChain = (n) => ([
  { hop: 101, action: 'spawn:commander', observed: {} },
  ...Array.from({ length: n }, (_unused, i) => expiredCommanderReconciled(111 + i)),
]);

describe('F1 step3 — commander lease 过期有界重派根除 route_unknown 人审（r72 案卷）', () => {
  it('commander infra 单次过期 → 主链续跑不挂人审（根因修复）', () => {
    const r = derive(baseObserved({ decisionLog: singleExpiredChain() }));
    expect(r.action).not.toBe('wait:human_review');
    expect(r.reason).not.toBe('callback_infrastructure_route_unknown');
  });

  it('commander infra 过期对主链透明 → action 等于无回调基线', () => {
    // 无任何 commander 回调时主链在 evaluate PASS 后应派 judge；commander 过期收割
    // 应对主链完全透明（监理角色降级续跑）。
    const baseline = derive(baseObserved({
      decisionLog: [{ hop: 101, action: 'spawn:generator', observed: {} }],
    }));
    const withExpired = derive(baseObserved({ decisionLog: singleExpiredChain() }));
    expect(baseline.action).toBe('spawn:judge');
    expect(withExpired.action).toBe(baseline.action);
  });

  it('commander infra 上限内4次仍续跑不挂人审', () => {
    const r = derive(baseObserved({ decisionLog: nExpiredChain(4) }));
    expect(r.action).not.toBe('wait:human_review');
  });

  it('commander infra 累计达上限5 → fail-closed 回落人审带 hop 锚', () => {
    const r = derive(baseObserved({ decisionLog: nExpiredChain(5) }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
    // 触发 callback hop 锚 = 最新一条 commander infra 收割行的 hop（111+5-1=115）
    expect(r.callbackHop).toBe(115);
  });

  it('角色隔离：planner infra 过期语义不变（重派 spawn:planner）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        { hop: 101, action: 'spawn:planner', observed: {} },
        expiredCommanderReconciled(112, { role: 'planner' }),
      ],
    }));
    expect(r).toEqual({
      phase: 'planning',
      action: 'spawn:planner',
      reason: 'callback_infrastructure_blocked',
    });
  });

  it('失败类隔离：commander account_exhausted 语义不变（仍 route_unknown）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        { hop: 101, action: 'spawn:commander', observed: {} },
        {
          hop: 112,
          action: 'verdict:attempt_callback',
          detail: {
            role: 'commander',
            status: 'failed',
            failure_class: 'account_exhausted',
            attempt_id: '44444444-4444-4444-8444-000000000112',
          },
        },
      ],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_account_exhausted_route_unknown');
  });

  it('纯函数可重放：同输入同输出（禁引入新状态存储）', () => {
    const input = () => baseObserved({ decisionLog: nExpiredChain(5) });
    expect(derive(input())).toEqual(derive(input()));
  });
});
