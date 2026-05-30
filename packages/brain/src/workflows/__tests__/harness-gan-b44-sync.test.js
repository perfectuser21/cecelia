/**
 * B44 — harness-gan.graph.js 改回同步 executor（WS3 async 已回退）
 *
 * Regression test：
 * 1. proposer 节点使用阻塞 executor（不调 spawnDockerDetached）
 * 2. runGanContractGraph 返回包含 propose_branch 的完整结果（不是 {kickoff:true}）
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock 外部依赖
vi.mock('../../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn(async () => {}) }));
vi.mock('../../lib/contract-verify.js', () => ({ verifyProposerOutput: vi.fn(async () => {}) }));

import { createGanContractNodes } from '../harness-gan.graph.js';

describe('B44 — GAN proposer 使用阻塞 executor [BEHAVIOR]', () => {
  it('proposer 调 executor（不是 spawnDockerDetached），返回 proposeBranch', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'b44-gan-'));
    try {
      // mock executor 写 .brain-result.json
      const mockExecutor = vi.fn(async ({ env }) => {
        writeFileSync(join(tmp, '.brain-result.json'), JSON.stringify({
          propose_branch: env.PROPOSE_BRANCH,
        }));
        writeFileSync(join(tmp, 'sprints', 'contract-draft.md'), '# Contract', { flag: 'w' });
        return { exit_code: 0, stdout: '', cost_usd: 0.01 };
      });

      // 确保 sprints 目录存在
      require('fs').mkdirSync(join(tmp, 'sprints'), { recursive: true });

      const { proposer } = createGanContractNodes(mockExecutor, {
        taskId: 'test-task-b44',
        initiativeId: 'init-b44',
        sprintDir: 'sprints',
        worktreePath: tmp,
        githubToken: 'ghp_test',
        readContractFile: async () => '# fake contract',
        verifyProposer: async () => {},
      });

      const result = await proposer({ round: 0, prdContent: '# PRD', feedback: null, costUsd: 0 });

      // 关键断言：executor 被调用（阻塞模式）
      expect(mockExecutor).toHaveBeenCalledTimes(1);
      // 关键断言：返回了 proposeBranch
      expect(result.proposeBranch).toBeTruthy();
      expect(result.proposeBranch).toMatch(/^cp-harness-propose-r1-/);
      expect(result.round).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('B44 — runGanContractGraph 返回形状包含 propose_branch [BEHAVIOR]', () => {
  it('harness-gan.graph.js 源码不含 kickoff:true 返回', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = resolve(fileURLToPath(import.meta.url), '..');
    const src = readFileSync(resolve(__dirname, '..', 'harness-gan.graph.js'), 'utf8');

    // B44 fix: 不再返回 {kickoff: true}
    expect(src).not.toMatch(/kickoff:\s*true/);
    // B44 fix: 返回完整 finalState 含 propose_branch
    expect(src).toMatch(/propose_branch:\s*finalState\.proposeBranch/);
  });
});
