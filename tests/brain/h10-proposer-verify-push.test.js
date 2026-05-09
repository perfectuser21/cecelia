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
    const fetchOriginFile = vi.fn().mockResolvedValue('{"tasks":[]}');
    const { proposer } = createGanContractNodes(executor, makeCtx({ fetchOriginFile }));
    const result = await proposer({ round: 0, prdContent: '#prd' });
    expect(result.proposeBranch).toBe('cp-harness-propose-r1-task-h10');
    expect(fetchOriginFile).toHaveBeenCalledOnce();
    expect(fetchOriginFile.mock.calls[0][1]).toBe('cp-harness-propose-r1-task-h10');
    expect(fetchOriginFile.mock.calls[0][2]).toContain('task-plan.json');
  });

  test('origin verify 失败 → throw proposer_didnt_push 含 branch 名 + 原 err', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: PROPOSER_STDOUT_OK,
      stderr: '',
      cost_usd: 0,
    });
    const fetchOriginFile = vi.fn().mockRejectedValue(new Error('git show failed: ENOENT'));
    const { proposer } = createGanContractNodes(executor, makeCtx({ fetchOriginFile }));

    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/proposer_didnt_push/);
    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/cp-harness-propose-r1-task-h10/);
    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/git show failed: ENOENT/);
  });

  test('原有 exit_code≠0 仍 throw proposer_failed（不被新逻辑破坏）', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 1,
      stdout: '',
      stderr: 'docker died',
      cost_usd: 0,
    });
    const fetchOriginFile = vi.fn();
    const { proposer } = createGanContractNodes(executor, makeCtx({ fetchOriginFile }));

    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/proposer_failed/);
    expect(fetchOriginFile).not.toHaveBeenCalled();
  });
});
