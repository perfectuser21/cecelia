import { describe, expect, it } from 'vitest';
import { derive } from '../derive.js';

// 2026-08-16 生产实证（run e64c335a，task 3a812432，profile capability-change-v1）：
// Proposer 首轮合同硬编码了 validation identity → loop 的 force_approve_contract 分支
// 走 validation-identity-policy 硬门驳回，写一条 verdict:reviewer(REVISION,
// source=validation_identity_policy) 决策行后 continue；derive 的 capability-change-v1
// 直出分支只看 proposeBranchRn>=1 就再次返回 force_approve_contract → 再撞硬门 →
// 17 分钟 936 跳热循环（≈1 跳/秒），直到 hop_cap 才会被打断。
// 修法与通用 GAN 路径的 F1 修复对齐：硬门驳回了当前 propose SHA 时，直出分支必须
// 让路回 spawn:proposer，让 proposer 按 REVISION 反馈产出新 SHA。
function observed(overrides = {}) {
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    routingReceipt: {
      default_execution_profile: 'capability-change-v1',
      execution_profile_override: null,
    },
    prdExists: true,
    contract: { approved: false },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    proposeBranchSha: 'a'.repeat(40),
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    counters: {
      hops: 20, fixRound: 0, pollCount: 0,
      noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
    },
    ...overrides,
  };
}

const identityDeny = (sha, hop = 13) => ({
  hop,
  action: 'verdict:reviewer',
  detail: {
    rn: 1,
    contract_sha: sha,
    verdict: 'REVISION',
    source: 'validation_identity_policy',
    summary: '合同在执行角色产生前硬编码了可变 validation identity。',
    reason: '删除 GAN authoring attempt/capability snapshot 字面值。',
  },
});

describe('capability-change-v1 直出合同 × validation-identity-policy 硬门（防热循环）', () => {
  it('对照：无硬门驳回记录时，rn>=1 仍 force_approve_contract（直出收敛语义不变）', () => {
    expect(derive(observed())).toMatchObject({
      phase: 'gan',
      action: 'force_approve_contract',
      reason: 'profile_direct_contract_convergence',
    });
  });

  it('硬门刚驳回了当前 propose SHA → 必须让路回 spawn:proposer，不得再 force_approve', () => {
    const sha = 'a'.repeat(40);
    const r = derive(observed({ decisionLog: [identityDeny(sha)] }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('spawn:proposer');
    expect(r.reason).toBe('profile_direct_contract_identity_revision');
  });

  it('硬门驳回的是旧 SHA（proposer 已出新 SHA）→ 恢复 force_approve_contract', () => {
    const r = derive(observed({
      proposeBranchSha: 'b'.repeat(40),
      decisionLog: [identityDeny('a'.repeat(40))],
    }));
    expect(r.action).toBe('force_approve_contract');
  });

  it('最近一条 verdict:reviewer 是普通 REVISION（非 identity-policy）→ 直出分支不受影响', () => {
    const sha = 'a'.repeat(40);
    const r = derive(observed({
      decisionLog: [{ hop: 13, action: 'verdict:reviewer', detail: { rn: 1, contract_sha: sha, verdict: 'REVISION' } }],
    }));
    expect(r.action).toBe('force_approve_contract');
  });
});
