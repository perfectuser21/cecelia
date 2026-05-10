// SPDX-License-Identifier: MIT
// Test for H10: proposer 节点末尾 verify origin push。
// 容器 exit=0 不等于节点 success — brain 必须主动验证 propose_branch + task-plan.json 真在 origin。

import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createGanContractNodes } from '../../packages/brain/src/workflows/harness-gan.graph.js';

function makeCtx(overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'h10-test-'));
  const sprintDir = 'sprints/test';
  mkdirSync(path.join(dir, sprintDir), { recursive: true });
  writeFileSync(path.join(dir, sprintDir, 'contract-draft.md'), '# fake contract');
  return {
    taskId: 'task-h10',
    initiativeId: 'init-h10',
    sprintDir,
    worktreePath: dir,
    githubToken: 'gh-token',
    budgetCapUsd: 10,
    readContractFile: async () => '# fake contract',
    ...overrides,
  };
}

const PROPOSER_STDOUT_OK = 'log\n{"verdict":"PROPOSED","propose_branch":"cp-harness-propose-r1-task-h10"}\n';

describe('H10 — proposer 节点 verify origin push', () => {
  test('origin verify 通过 → 正常 return propose_branch', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: PROPOSER_STDOUT_OK,
      stderr: '',
      cost_usd: 0,
    });
    // H15: 改用 verifyProposer 注入（替换 H10 fetchOriginFile）
    const verifyProposer = vi.fn().mockResolvedValue(undefined);
    const { proposer } = createGanContractNodes(executor, makeCtx({ verifyProposer }));
    const result = await proposer({ round: 0, prdContent: '#prd' });
    expect(result.proposeBranch).toBe('cp-harness-propose-r1-task-h10');
    expect(verifyProposer).toHaveBeenCalledOnce();
    expect(verifyProposer.mock.calls[0][0].branch).toBe('cp-harness-propose-r1-task-h10');
    expect(verifyProposer.mock.calls[0][0].sprintDir).toBe('sprints/test');
  });

  test('origin verify 失败 → throw 含 branch 名 + 原 err（H15: ContractViolation 直接 propagate）', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: PROPOSER_STDOUT_OK,
      stderr: '',
      cost_usd: 0,
    });
    // H15: verifyProposer throw ContractViolation，直接 propagate（不再包一层 Error）
    const verifyProposer = vi.fn().mockRejectedValue(
      new Error('proposer_didnt_push: branch cp-harness-propose-r1-task-h10 not found on origin'),
    );
    const { proposer } = createGanContractNodes(executor, makeCtx({ verifyProposer }));

    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/proposer_didnt_push/);
    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/cp-harness-propose-r1-task-h10/);
  });

  test('原有 exit_code≠0 仍 throw proposer_failed（不被新逻辑破坏）', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 1,
      stdout: '',
      stderr: 'docker died',
      cost_usd: 0,
    });
    const verifyProposer = vi.fn();
    const { proposer } = createGanContractNodes(executor, makeCtx({ verifyProposer }));

    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/proposer_failed/);
    expect(verifyProposer).not.toHaveBeenCalled();
  });
});
