/**
 * no-progress-fence.test.js — B-03: no-progress 熔断
 *
 * TDD 骨架：全红状态。
 * 核心：generator-fix 后 PR SHA 未变 → 立即 terminal（no_progress_same_sha）
 *       evidence repair 后 digest 未变 → 立即 terminal（no_progress_same_evidence）
 *       fence 从 decision log 持久化读取，不依赖进程内变量
 *
 * FR-05/FR-06 要求：
 * - generator-fix: pr_head_sha_new === pr_head_sha_trigger → no_progress_same_sha
 * - evaluator-evidence-repair: evidence_digest_new === evidence_digest_trigger → no_progress_same_evidence
 * - 同 (run_id, failure_class, trigger_sha, role) 四元组最多一次
 * - no-progress fence 持久化（decision log），重启不绕过
 */
import { describe, it, expect } from 'vitest';

// TODO: 实现后取消注释
// import { checkNoProgressSameSha, checkNoProgressSameEvidence } from '../../../packages/brain/src/orchestrator/gates.js';
// import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

// Placeholders — 全红骨架
function checkNoProgressSameSha(_triggerSha, _newSha) {
  return undefined; // 未实现
}

function checkNoProgressSameEvidence(_triggerDigest, _newDigest) {
  return undefined; // 未实现
}

function derive(_observed) {
  return { phase: 'unknown', action: 'unknown', reason: 'not_implemented' };
}

describe('B-03: generator-fix SHA 未变 → no_progress_same_sha', () => {
  it('新 SHA === 触发 SHA → 返回 true（触发熔断）', () => {
    expect(checkNoProgressSameSha('sha-abc', 'sha-abc')).toBe(true);
  });

  it('新 SHA !== 触发 SHA → 返回 false（进展有效）', () => {
    expect(checkNoProgressSameSha('sha-abc', 'sha-def')).toBe(false);
  });

  it('新 SHA 为空/null → 视为无进展，返回 true', () => {
    expect(checkNoProgressSameSha('sha-abc', null)).toBe(true);
    expect(checkNoProgressSameSha('sha-abc', '')).toBe(true);
  });
});

describe('B-03: evidence repair digest 未变 → no_progress_same_evidence', () => {
  it('新 digest === 触发 digest → 返回 true（触发熔断）', () => {
    expect(checkNoProgressSameEvidence('digest-xyz', 'digest-xyz')).toBe(true);
  });

  it('新 digest !== 触发 digest → 返回 false（进展有效）', () => {
    expect(checkNoProgressSameEvidence('digest-xyz', 'digest-uvw')).toBe(false);
  });

  it('新 digest 为空/null → 视为无进展，返回 true', () => {
    expect(checkNoProgressSameEvidence('digest-xyz', null)).toBe(true);
  });
});

describe('B-03: no-progress terminal via derive()', () => {
  /**
   * 场景：generator-fix attempt callback 写回后，
   * derive() 读取到 noProgressSameSha=true → mark_failed with reason=no_progress_same_sha
   */
  it('observed.noProgressSameSha=true → derive 输出 mark_failed reason=no_progress_same_sha', () => {
    const observed = {
      run: { phase: 'generate' },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-trigger' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: null,
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-trigger', failure_class: 'product_failure' },
      reviewRequired: false,
      reviewApproved: false,
      noProgressSameSha: true,          // 新字段：由 ground-truth 从 decision log 读取
      generatorFixTriggerSha: 'sha-trigger',
      generatorFixCompletedSha: 'sha-trigger', // 未变化
      counters: { hops: 15, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    };
    const r = derive(observed);
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toMatch(/no_progress_same_sha/);
  });

  /**
   * 场景：evidence repair 后 digest 未变
   * derive() 读取到 noProgressSameEvidence=true → mark_failed with reason=no_progress_same_evidence
   */
  it('observed.noProgressSameEvidence=true → derive 输出 mark_failed reason=no_progress_same_evidence', () => {
    const observed = {
      run: { phase: 'verify' },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-v1' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-v1' },
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-v1', failure_class: 'evidence_invalid' },
      reviewRequired: false,
      reviewApproved: false,
      noProgressSameEvidence: true,     // 新字段
      evidenceTriggerDigest: 'digest-x',
      evidenceRepairDigest: 'digest-x', // 未变化
      counters: { hops: 12, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    };
    const r = derive(observed);
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toMatch(/no_progress_same_evidence/);
  });
});

describe('B-03: 同四元组 (run_id, failure_class, trigger_sha, role) 最多一次', () => {
  /**
   * ground-truth 层：deduplication 检查
   * 此测试验证 ground-truth 或 loop 读取 decision log 后
   * 正确检测到同四元组已存在 attempt
   */
  it('decision log 已有相同 trigger_sha 的 generator-fix intent → noProgressSameSha=true', () => {
    // 模拟 decision log 已有 hop 10 的 spawn:generator-fix，trigger_sha=sha-abc
    const decisionLogRows = [
      {
        hop: 10,
        action: 'spawn:generator-fix',
        detail: { trigger_sha: 'sha-abc', failure_class: 'product_failure', role: 'generator' },
      },
      {
        hop: 12,
        action: 'verdict:generator-fix-callback',
        detail: { pr_head_sha: 'sha-abc', status: 'completed' }, // SHA 未变
      },
    ];

    // TODO: import { deriveNoProgress } from 'ground-truth.js' 或等价函数
    // const np = deriveNoProgress(decisionLogRows, { runId: 'run-1' });
    // expect(np.noProgressSameSha).toBe(true);

    // 骨架验证：decision log 数据结构符合预期（触发 SHA 可以读取）
    const fixIntent = decisionLogRows.find((r) => r.action === 'spawn:generator-fix');
    const callback = decisionLogRows.find((r) => r.action === 'verdict:generator-fix-callback');
    expect(fixIntent.detail.trigger_sha).toBe('sha-abc');
    expect(callback.detail.pr_head_sha).toBe('sha-abc'); // 相同 → no progress
  });
});
