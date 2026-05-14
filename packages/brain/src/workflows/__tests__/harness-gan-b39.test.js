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

describe('reviewer 节点 — 读 .brain-result.json', () => {
  it('容器写 APPROVED + rubric_scores → Brain 判 APPROVED', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b39-reviewer-'));
    try {
      const mockExecutor = vi.fn(async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
          verdict: 'APPROVED',
          rubric_scores: {
            dod_machineability: 8,
            scope_match_prd: 8,
            test_is_red: 8,
            internal_consistency: 8,
            risk_registered: 8,
          },
          feedback: '',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1 };
      });

      const { reviewer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const patch = await reviewer({
        round: 1,
        prdContent: '# PRD',
        contractContent: '# contract',
        costUsd: 0,
        rubricHistory: [],
        proposeBranch: 'cp-harness-propose-r1-f5a1db9c',
      });

      expect(patch.verdict).toBe('APPROVED');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('容器写 REVISION + 低分 → Brain 判 REVISION + feedback 存入 patch', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gan-b39-reviewer-'));
    try {
      const mockExecutor = vi.fn(async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, '.brain-result.json'), JSON.stringify({
          verdict: 'REVISION',
          rubric_scores: {
            dod_machineability: 5,
            scope_match_prd: 5,
            test_is_red: 5,
            internal_consistency: 5,
            risk_registered: 5,
          },
          feedback: 'DoD 命令无法 exit non-zero，请修复',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1 };
      });

      const { reviewer } = createGanContractNodes(mockExecutor, {
        taskId: TASK_ID,
        initiativeId: 'init-test',
        sprintDir: SPRINT_DIR,
        worktreePath: tmpDir,
        githubToken: 'mock-token',
        readContractFile: async () => '# contract',
        verifyProposer: async () => {},
      });

      const patch = await reviewer({
        round: 1,
        prdContent: '# PRD',
        contractContent: '# contract',
        costUsd: 0,
        rubricHistory: [],
        proposeBranch: 'cp-harness-propose-r1-f5a1db9c',
      });

      expect(patch.verdict).toBe('REVISION');
      expect(patch.feedback).toContain('DoD 命令');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
