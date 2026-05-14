import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGanContractNodes } from '../harness-gan.graph.js';

const TASK_ID = 'f5a1db9c-1111-2222-3333-444455556666';
const SPRINT_DIR = 'sprints/w50-test';

describe('proposer 节点 — Brain 注入 PROPOSE_BRANCH', () => {
  it('proposer env 含 PROPOSE_BRANCH，容器写文件后 Brain 读取', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b39-'));
    try {
      let capturedEnv;
      const mockExecutor = vi.fn(async ({ worktreePath, env }) => {
        capturedEnv = env;
        // 容器写 .brain-result.json（模拟 SKILL 行为）
        writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
          propose_branch: env.PROPOSE_BRANCH,
          workstream_count: 2,
          task_plan_path: `${SPRINT_DIR}/task-plan.json`,
        }));
        // mock verifyProposer 需要的 contract 文件
        mkdirSync(join(worktreePath, SPRINT_DIR), { recursive: true });
        writeFileSync(join(worktreePath, SPRINT_DIR, 'contract-draft.md'), '# contract');
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1 };
      });

      const { proposer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const result = await proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] });

      // Brain 注入的分支名 = cp-harness-propose-r1-f5a1db9c（TASK_ID 前 8 位）
      expect(capturedEnv.PROPOSE_BRANCH).toBe('cp-harness-propose-r1-f5a1db9c');
      expect(result.proposeBranch).toBe('cp-harness-propose-r1-f5a1db9c');
      expect(result.round).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('proposer 容器未写文件 → 抛 ContractViolation missing_result_file', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b39-'));
    try {
      const mockExecutor = vi.fn(async () => ({
        exit_code: 0, stdout: '', stderr: '', cost_usd: 0,
      }));

      const { proposer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      await expect(proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0, rubricHistory: [] }))
        .rejects.toThrow('missing_result_file');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
