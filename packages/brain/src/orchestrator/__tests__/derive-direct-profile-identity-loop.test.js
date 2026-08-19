import { describe, expect, it } from 'vitest';
import { derive } from '../derive.js';

// 2026-08-16 生产实证（run e64c335a，task 3a812432，profile capability-change-v1）：
// Proposer 首轮合同硬编码了 validation identity → loop 的 force_approve_contract 分支
// 走 validation-identity-policy 硬门驳回，写一条 verdict:reviewer(REVISION,
// source=validation_identity_policy) 决策行后 continue；当时 derive 的 capability-change-v1
// 直出分支只看 proposeBranchRn>=1 就再次返回 force_approve_contract → 再撞硬门 →
// 17 分钟 936 跳热循环（≈1 跳/秒），直到 hop_cap 才会被打断。
//
// 2026-08-19 决策 b14dc8e4：capability-change-v1 撤销「免对抗直出」，合同尺度改走通用
// deriveGan（与 new-capability-v1 同路）。热循环防护不再靠专属分支，而由 deriveGan 自带的
// F1 守卫承担：硬门驳回当前 SHA 会落一条 verdict:reviewer(REVISION) 行 → ground-truth 按
// rn+sha 推出 ganLatestRoundVerdict='REVISION' → 趋势闸让路 → spawn:proposer。
// 本文件四条用例按新语义重写，仍守同一件事：硬门驳回后绝不能原地重复 force_approve。
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

describe('capability-change-v1 合同走 GAN × validation-identity-policy 硬门（防热循环）', () => {
  it('对照：rn>=1 且本轮无 verdict → spawn:reviewer（不再 force_approve 直出）', () => {
    expect(derive(observed())).toMatchObject({
      phase: 'gan',
      action: 'spawn:reviewer',
      reason: 'contract_r1_awaiting_review',
    });
  });

  it('硬门刚驳回了当前 propose SHA → 让路回 spawn:proposer，不得再 force_approve', () => {
    const sha = 'a'.repeat(40);
    // 生产里 ground-truth 会把这条 verdict:reviewer(REVISION, rn=1, sha 匹配) 推成
    // ganLatestRoundVerdict='REVISION'；fixture 与之对齐，不能留 null（那是另一条用例）。
    const r = derive(observed({ ganLatestRoundVerdict: 'REVISION', decisionLog: [identityDeny(sha)] }));
    expect(r.phase).toBe('gan');
    expect(r.action).toBe('spawn:proposer');
    expect(r.action).not.toBe('force_approve_contract');
  });

  it('硬门驳回的是旧 SHA（proposer 已出新 SHA）→ 新 SHA 待审，spawn:reviewer', () => {
    // 新 SHA 尚无 verdict：ground-truth 因 sha 不匹配推出 ganLatestRoundVerdict=null。
    const r = derive(observed({
      proposeBranchSha: 'b'.repeat(40),
      ganLatestRoundVerdict: null,
      decisionLog: [identityDeny('a'.repeat(40))],
    }));
    expect(r.action).toBe('spawn:reviewer');
  });

  it('最近一条 verdict:reviewer 是普通 REVISION（非 identity-policy）→ 回 proposer 出下一轮', () => {
    const sha = 'a'.repeat(40);
    const r = derive(observed({
      ganLatestRoundVerdict: 'REVISION',
      decisionLog: [{ hop: 13, action: 'verdict:reviewer', detail: { rn: 1, contract_sha: sha, verdict: 'REVISION' } }],
    }));
    expect(r.action).toBe('spawn:proposer');
    expect(r.reason).toBe('revision_requested');
  });
});
