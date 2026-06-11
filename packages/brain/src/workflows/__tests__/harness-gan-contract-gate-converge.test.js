/**
 * harness-gan-contract-gate-converge.test.js — GAN 收敛时前置跑确定性 Contract Gate（治本）。
 *
 * P1 根因（run ea622a94）：弱合同（contract-draft.md 含 file-existence-only / MOCK_* 等红线）
 * 被 reviewer LLM 主观 APPROVED 后退出 GAN → 流到 evaluator 的确定性 gate 才命中 → 但此时只能
 * 打回 generator，而 generator 无权改合同 → 空转。
 *
 * 治本：reviewer APPROVED 之后、GAN 退出之前，对合同产物跑同一 gate 库（#3348 共享实现）。
 * 命中 → 不退出 GAN（verdict 改 REVISION），把命中清单作为 feedback 拼进下一轮 proposer 输入
 * → proposer 修合同。弱合同根本到不了 generator。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

import { createGanContractNodes } from '../harness-gan.graph.js';

// reviewer executor：写一个【7 维度全过 → APPROVED】的 .brain-result.json
function makeApprovedExecutor(worktreePath) {
  return vi.fn(async () => {
    writeFileSync(
      path.join(worktreePath, '.brain-result.json'),
      JSON.stringify({
        verdict: 'APPROVED',
        rubric_scores: {
          dod_machineability: 9,
          scope_match_prd: 9,
          test_is_red: 9,
          internal_consistency: 9,
          risk_registered: 9,
          verification_oracle_completeness: 9,
          ci_workflow_alignment: 9,
        },
        feedback: '',
      }),
    );
    return { exit_code: 0, stdout: '', cost_usd: 0.01 };
  });
}

// 含确定性 gate 红线的弱合同（file-existence-only + MOCK_* 注入）
const WEAK_CONTRACT = [
  '# Sprint Contract',
  '',
  '## E2E 验收',
  '```bash',
  'MOCK_WECHAT_VERSION=4.2.0.0',
  'test -f out.mp4',
  '```',
].join('\n');

// 干净合同（无 gate 红线，有真实断言）
const CLEAN_CONTRACT = [
  '# Sprint Contract',
  '',
  '## E2E 验收',
  '```bash',
  "curl -s localhost:5221/health | jq -e '.status == \"ok\"'",
  '```',
].join('\n');

describe('GAN reviewer — 收敛时前置 Contract Gate（弱合同打回 proposer，不退出 GAN）', () => {
  it('reviewer 判 APPROVED 但合同命中 gate 红线 → verdict 改 REVISION，feedback 含命中清单', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-cg-'));
    try {
      const { reviewer } = createGanContractNodes(makeApprovedExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
      });
      const r = await reviewer({
        round: 2, prdContent: 'x', contractContent: WEAK_CONTRACT,
        costUsd: 0, reviewerNoVerdictStreak: 0,
      });
      // 关键：gate 命中 → 不退出 GAN（不能是 APPROVED）
      expect(r.verdict).toBe('REVISION');
      // feedback 必须带确定性命中清单（含 ruleId），供下一轮 proposer 修合同
      expect(r.feedback).toMatch(/cheat\/mock-env|weak-oracle\/file-existence-only/);
      expect(r.error).toBeFalsy();
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  it('reviewer 判 APPROVED 且合同干净 → 维持 APPROVED（GAN 正常退出）', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-cg2-'));
    try {
      const { reviewer } = createGanContractNodes(makeApprovedExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
      });
      const r = await reviewer({
        round: 2, prdContent: 'x', contractContent: CLEAN_CONTRACT,
        costUsd: 0, reviewerNoVerdictStreak: 0,
      });
      expect(r.verdict).toBe('APPROVED');
      expect(r.error).toBeFalsy();
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});
