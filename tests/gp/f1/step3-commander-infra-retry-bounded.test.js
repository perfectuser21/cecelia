// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：commander lease 过期有界自动重派 [r74]
//
// 与 sprints/08251745-kernel-r74-commander-retry/tests/commander-infra-retry-bounded.test.ts
// 是同一改动的两个 CI 闸产物：本文件满足 F1 gp-anchor 闸（tests/gp/f1/step3-*），
// 冻结那份满足封印闸 + finalizer HEAD 树校验。两者都真 import 被改文件 derive.js，
// 禁 mock 被改的边（commander infra 路由 ↔ decisionLog 行）。
//
// 背景（r73/run da3aa553 案卷）：kernel 编排器 derive.js 的 attemptCallbackRoute 对
// infrastructure_blocked 失败按角色查 INFRA_RETRY_ACTION_BY_ROLE 重派，该表独缺 commander。
// 故 commander attempt lease 过期被收割器 reconcile
// （effect:expired_attempt_reconciled, role=commander, failure_class=infrastructure_blocked）
// 后 infrastructureRetryForCallback 返回 undefined → 直接 wait:human_review
// （callback_infrastructure_route_unknown），每轮都要人审，破坏 zero-human-gate。
//
// 修法（本批，纯函数）：commander 纳入「有界」infrastructure 重试——
//  · 同 run 内 commander infrastructure 类 expired 行累计 < 5：attemptCallbackRoute 不再挂人审
//    （返回不阻塞的路由，主链继续；重派由 commanderCoordinator 在下一 tick 独立负责）。
//  · 累计 ≥ 5（fail-closed 兜底）：仍 wait:human_review + reason=callback_infrastructure_route_unknown，
//    且决策对象带 callbackHop=Number(row.hop)（与 #5058 diagnostic 消费锚兼容）。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CAND_SHA = 'df13ca81519019e790d6387229f497ba78071cfc';
const IDENTITY = { contract_id: 'c74', manifest_sha256: 'm74', source_revision: 'r74' };

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: null,
    candidate: { branch: 'cp-route-api-4ca29496', head_sha: CAND_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CAND_SHA, contract_identity: IDENTITY },
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 115, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// commander attempt lease 过期被 reconcile（r70 hop112 实录形状）
const expiredCommander = (hop, patch = {}) => ({
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

// 非 commander 角色的同类 infra 过期（语义应完全不变）
const expiredRole = (hop, role) => ({
  hop,
  action: 'effect:expired_attempt_reconciled',
  detail: { role, status: 'failed', failure_class: 'infrastructure_blocked' },
});

const HOPS = [103, 105, 107, 109, 112, 114, 116];

// N 条 commander infra 过期链（含首个 spawn:commander 锚）；返回链 + 最后一条 hop（callbackHop 期望）
function commanderExpiryChain(count) {
  const rows = [{ hop: 101, action: 'spawn:commander', observed: {} }];
  for (let i = 0; i < count; i++) rows.push(expiredCommander(HOPS[i]));
  return { rows, lastHop: HOPS[count - 1] };
}

describe('F1 step3 — commander lease 过期有界自动重派 [r74]', () => {
  it('单条 commander infra 过期（<上限）不再挂人审 改由coordinator重派', () => {
    const { rows } = commanderExpiryChain(1);
    const r = derive(baseObserved({ decisionLog: rows }));
    expect(r.action).not.toBe('wait:human_review');
    expect(r.reason).not.toBe('callback_infrastructure_route_unknown');
  });

  it('边界 累计4条（第5条前）仍不挂人审', () => {
    const { rows } = commanderExpiryChain(4);
    const r = derive(baseObserved({ decisionLog: rows }));
    expect(r.action).not.toBe('wait:human_review');
    expect(r.reason).not.toBe('callback_infrastructure_route_unknown');
  });

  it('达上限 第5条expired → wait:human_review + route_unknown + callbackHop锚', () => {
    const { rows, lastHop } = commanderExpiryChain(5);
    const r = derive(baseObserved({ decisionLog: rows }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
    expect(r.callbackHop).toBe(lastHop);
  });

  it('超上限 第6条expired → 仍 wait:human_review + callbackHop（不回退放行）', () => {
    const { rows, lastHop } = commanderExpiryChain(6);
    const r = derive(baseObserved({ decisionLog: rows }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
    expect(r.callbackHop).toBe(lastHop);
  });

  it('负向 非commander角色（planner）infra过期语义不变 → 走既有重派不受commander上限影响', () => {
    const rows = [
      { hop: 101, action: 'spawn:planner', observed: {} },
      expiredRole(103, 'planner'),
      expiredRole(105, 'planner'),
      expiredRole(107, 'planner'),
      expiredRole(109, 'planner'),
      expiredRole(112, 'planner'),
    ];
    const r = derive(baseObserved({ run: { phase: 'planning' }, decisionLog: rows }));
    expect(r.action).toBe('spawn:planner');
    expect(r.reason).toBe('callback_infrastructure_blocked');
  });

  it('负向 commander非infra失败（account_exhausted）语义不变 → 仍 account_exhausted route_unknown', () => {
    const rows = [
      { hop: 100, action: 'spawn:commander', observed: {} },
      {
        hop: 103,
        action: 'verdict:attempt_callback',
        detail: { role: 'commander', status: 'failed', failure_class: 'account_exhausted', hop: 100 },
      },
    ];
    const r = derive(baseObserved({ decisionLog: rows }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_account_exhausted_route_unknown');
  });
});
