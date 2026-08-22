// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：封印拒绝 ↔ GAN 重开（合同可重写性）
//
// 2026-08-22 生产实证（r47 run 6abf8fba）：seal 校验新码
// FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE 不匹配 loop.js
// frozenArtifactErrorCode 的 /FROZEN_CONTRACT_ARTIFACT[A-Z_]*/ 前缀 → throw 逃出
// → kernel_process_fatal 杀 run。且合同不合格（proposer 措辞/表登记问题）本应
// 打回 proposer 重写（reopen GAN，合同还能改的时点），而非 run 终态。
// 附因：proposer 用分号分隔多 BEHAVIOR，parseTestContract 分隔符集 /[/,、]/ 不含
// 分号 → 整串当一个 behavior 匹配必败。
// 修法①：loop 捕 FROZEN_CONTRACT_TEST_CONTRACT_* → 写 verdict:contract_seal_rejected
// 行（不 failRun）；derive 在 persist_contract_approval 前观察该行 → REOPEN_GAN_CONTRACT
// （priorReopens 限额沿用，超限 wait:human_review）。
// 修法②：parseTestContract 分隔符加分号（CI 与 seal 同一把尺）。
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { __test__ as loopTest } from '../../../packages/brain/src/orchestrator/loop.js';

const require = createRequire(import.meta.url);
const { parseTestContract } = require('../../../scripts/lib/test-contract-paths.cjs');

const SHA = 'a'.repeat(40);

// 与 packages/brain/src/orchestrator/__tests__/derive.test.js 的 baseObserved/gan
// 同形（REQUIRED_FIELDS 全给），聚焦 seal_rejected 分支。
function ganObserved(extra = {}) {
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: false },
    pr: null,
    candidate: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranch: 'cp-harness-propose-r1-x',
    proposeBranchSha: SHA,
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    ganLatestRoundContractSha: SHA,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog: [],
    ...extra,
  };
}

describe('F1 step3：封印拒绝走 reopen GAN 不杀 run（r47 案卷）', () => {
  it('loop.frozenArtifactErrorCode 识别 FROZEN_CONTRACT_TEST_CONTRACT_* 码（不再逃出成 fatal）', () => {
    const code = loopTest.frozenArtifactErrorCode(
      new Error('FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE:sprints/x/tests/y.test.js#behavior:B-01'),
    );
    expect(code).toMatch(/^FROZEN_CONTRACT_TEST_CONTRACT_/);
  });

  it('derive：本轮 SHA 有 contract_seal_rejected 行 → spawn:proposer 重写（r48 案卷：reviewer 重审同文本必死循环）', () => {
    const decision = derive(ganObserved({
      decisionLog: [{
        hop: 20,
        action: 'verdict:contract_seal_rejected',
        detail: { code: 'FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE:x', propose_branch_sha: SHA },
      }],
    }));
    expect(decision.action).toBe('spawn:proposer');
    expect(decision.reason).toBe('contract_seal_rejected_rewrite');
  });

  it('derive：第 2 次 seal 拒绝 → mark_failed 诚实终态（r48 案卷：GAN 阶段人审无 PR 不可行）', () => {
    const decision = derive(ganObserved({
      decisionLog: [
        {
          hop: 10,
          action: 'verdict:contract_seal_rejected',
          detail: { code: 'FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED:x', propose_branch_sha: 'c'.repeat(40) },
        },
        {
          hop: 30,
          action: 'verdict:contract_seal_rejected',
          detail: { code: 'FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED:y', propose_branch_sha: SHA },
        },
      ],
    }));
    expect(decision.action).toBe('mark_failed');
    expect(decision.reason).toBe('seal_rejected_exhausted');
  });

  it('derive：seal_rejected 行属于旧 SHA → 不影响本轮 approve 落库（负向）', () => {
    const decision = derive(ganObserved({
      decisionLog: [{
        hop: 5,
        action: 'verdict:contract_seal_rejected',
        detail: { code: 'FROZEN_CONTRACT_TEST_CONTRACT_UNREGISTERED:z', propose_branch_sha: 'b'.repeat(40) },
      }],
    }));
    expect(decision.action).toBe('persist_contract_approval');
  });

  it('parseTestContract：分号分隔的多 BEHAVIOR 拆成多条（r47 proposer 写法）', () => {
    const rows = parseTestContract(`## Test Contract
| Workstream | Test File | BEHAVIOR | 红证据 |
|---|---|---|---|
| w | \`sprints/x/tests/y.test.js\` | \`B-01 批准被消费\`; \`B-02 无对应\` | FAIL |
`);
    expect(rows).toHaveLength(1);
    expect(rows[0].behaviors).toEqual(['B-01 批准被消费', 'B-02 无对应']);
  });
});
