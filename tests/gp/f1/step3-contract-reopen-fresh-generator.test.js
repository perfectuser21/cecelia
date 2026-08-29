/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * r73 案卷（run da3aa553）永久回归副本（硬规则 #20）：generator 报
 * CONTRACT_SELF_CONTRADICTION 触发合同重开 GAN（设计内自愈）；第二版合同批准后 derive 见
 * proposeBranchRn>0 且无 PR/候选（no_pr），主链把 no_pr 路由到 spawn:generator-fix。但 fix 的
 * 源 workspace 属**第一版已作废合同** → worker /prepare 报 workspace_source_attempt_unavailable
 * → assembly_fault:WORKSPACE_RESOLUTION_FAILED 终局。合同重开路径 100% 必死。
 *
 * 根治：合同重开纪元（decisionLog 含 REOPEN_GAN_CONTRACT 行）内、尚未派过全新 generator 的
 * no_pr → 从冻结基线**重写**（spawn:generator，reason=contract_reopened_fresh_generator），
 * 不派 generator-fix（修一个不存在的旧候选）。
 *
 * 纯函数真验：真 import packages/brain/src/orchestrator/derive.js，喂确定性 observed 快照。
 * 禁 mock 被改的边（derive 路由 ↔ decisionLog 纪元识别，纯函数无 I/O，无替身）。
 */
import { describe, expect, it } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const IDENTITY = { contract_id: 'c-reopen-2', manifest_sha256: 'm2', source_revision: 'r2' };

// no_pr 判定点快照：contract approved + generatorSpawned + 无 PR/候选。
// 落 deriveTask 3a no_pr 分支（derive.js 约 L1338–1368）。
function observed(decisionLog) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    pr: null,
    candidate: null,
    contract: { approved: true, identity: IDENTITY },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:generator' },
    proposeBranchRn: 2,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 30, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
  };
}

const genSpawn = (hop, reason) => ({ hop, action: 'spawn:generator', detail: { reason } });
const genCallback = (hop) => ({ hop, action: 'verdict:attempt_callback', detail: { role: 'generator', status: 'completed' } });
const reopen = (hop, callbackHop) => ({ hop, action: 'reopen_gan_contract', detail: { reason: 'contract_fault_reopen_gan', callback_hop: callbackHop } });
const proposerSpawn = (hop) => ({ hop, action: 'spawn:proposer', detail: { reason: 'revision_requested' } });
const reviewerApproved = (hop) => ({ hop, action: 'verdict:reviewer', detail: { approved: true } });
const fixSpawn = (hop) => ({ hop, action: 'spawn:generator-fix', detail: { reason: 'no_pr' } });

describe('derive no_pr：合同重开纪元派全新 generator，根除 WORKSPACE_RESOLUTION_FAILED（r73 永久回归）', () => {
  it('B-01 重开后新合同批准 + no_pr（重开纪元内未派全新 generator）→ spawn:generator（contract_reopened_fresh_generator）', () => {
    const log = [
      genSpawn(10, 'contract_approved'),
      genCallback(11),
      reopen(12, 11),
      proposerSpawn(13),
      reviewerApproved(14),
    ];
    const r = derive(observed(log));
    expect(r.action).toBe('spawn:generator');
    expect(r.reason).toBe('contract_reopened_fresh_generator');
    expect(r.phase).toBe('generate');
  });

  it('B-02 有界：重开后已派过全新 generator，再 no_pr → 回落既有 fix 语义（不无限重发 generator）', () => {
    const log = [
      genSpawn(10, 'contract_approved'),
      genCallback(11),
      reopen(12, 11),
      proposerSpawn(13),
      reviewerApproved(14),
      genSpawn(15, 'contract_reopened_fresh_generator'),
      genCallback(16),
      fixSpawn(17),
    ];
    const r = derive(observed(log));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('no_pr');
  });

  it('B-03 负向：无 REOPEN_GAN_CONTRACT 历史的 no_pr → 语义不变，仍 fix 路由', () => {
    const log = [
      genSpawn(10, 'contract_approved'),
      genCallback(11),
      fixSpawn(12),
    ];
    const r = derive(observed(log));
    expect(r.action).toBe('spawn:generator-fix');
    expect(r.reason).toBe('no_pr');
  });

  it('B-04 纪元隔离：重开纪元起点之前的 spawn:generator 不算「重开后已派」（仍派全新 generator）', () => {
    const log = [
      genSpawn(10, 'contract_approved'),
      genCallback(11),
      reopen(12, 11),
      proposerSpawn(13),
      reviewerApproved(14),
    ];
    const r = derive(observed(log));
    expect(r.action).toBe('spawn:generator');
    expect(r.reason).toBe('contract_reopened_fresh_generator');
  });
});
