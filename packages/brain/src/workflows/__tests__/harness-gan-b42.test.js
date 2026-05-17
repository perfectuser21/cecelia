import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGanContractNodes, buildProposerPrompt } from '../harness-gan.graph.js';

const TASK_ID = 'aabbccdd-0000-1111-2222-333344445555';
const SPRINT_DIR = 'sprints/w99-b42-test';

function makeExecutor(proposeBranchOverride) {
  return vi.fn(async ({ worktreePath, env }) => {
    const actualBranch = proposeBranchOverride ?? env.PROPOSE_BRANCH;
    writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
      propose_branch: actualBranch,
      workstream_count: 1,
      task_plan_path: `${SPRINT_DIR}/task-plan.json`,
    }));
    mkdirSync(join(worktreePath, SPRINT_DIR), { recursive: true });
    writeFileSync(join(worktreePath, SPRINT_DIR, 'contract-draft.md'), '# contract');
    return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.05 };
  });
}

describe('B42 — propose_branch mismatch tolerance', () => {
  it('match 场景: propose_branch = computedBranch → 正常返回，proposeBranch = 注入值', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b42-'));
    try {
      const { proposer } = createGanContractNodes(makeExecutor(undefined), {
        taskId: TASK_ID,
        initiativeId: 'init-b42',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const result = await proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] });

      // computedBranch = cp-harness-propose-r1-aabbccdd（TASK_ID 前8位）
      expect(result.proposeBranch).toBe('cp-harness-propose-r1-aabbccdd');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('mismatch 场景: propose_branch ≠ computedBranch → console.warn，proposeBranch = 实际写入值', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b42-'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { proposer } = createGanContractNodes(makeExecutor('cp-harness-propose-r1-05152044'), {
        taskId: TASK_ID,
        initiativeId: 'init-b42',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const result = await proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] });

      // 不 throw，但 warn 了
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('propose_branch mismatch'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cp-harness-propose-r1-05152044'));
      // proposeBranch 用实际写入值
      expect(result.proposeBranch).toBe('cp-harness-propose-r1-05152044');
    } finally {
      warnSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('buildProposerPrompt 注入字面量 PROPOSE_BRANCH', () => {
    const proposeBranch = 'cp-harness-propose-r1-aabbccdd';
    const prompt = buildProposerPrompt('# PRD content', null, 1, proposeBranch);
    expect(prompt).toContain(`PROPOSE_BRANCH="${proposeBranch}"`);
  });
});
