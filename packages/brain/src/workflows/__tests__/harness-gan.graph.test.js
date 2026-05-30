import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

import { createGanContractNodes } from '../harness-gan.graph.js';

// B39: 新协议要求 executor mock 写 .brain-result.json（propose_branch 字段）
// computedBranch = cp-harness-propose-r{round}-{taskId.slice(0,8)}
// taskId='test-task' → slice(0,8)='test-tas' → r1 branch='cp-harness-propose-r1-test-tas'
function makeExecutorWithResultFile(worktreePath, overrides = {}) {
  return vi.fn(async ({ env }) => {
    const branch = env.PROPOSE_BRANCH;
    writeFileSync(
      path.join(worktreePath, '.brain-result.json'),
      JSON.stringify({ propose_branch: branch, workstream_count: 1, ...overrides }),
    );
    return { exit_code: 0, stdout: '', cost_usd: 0.01 };
  });
}

describe('GAN proposer node task-plan.json access 校验 [BEHAVIOR]', () => {
  it('proposer 跑完缺 sprints/task-plan.json 时应打 console.warn 不抛错', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-proposer-test-'));
    try {
      const fakeExecutor = makeExecutorWithResultFile(tmp);
      const fakeReadContract = vi.fn().mockResolvedValue('# fake contract');

      const { proposer } = createGanContractNodes(fakeExecutor, {
        taskId: 'test-task', initiativeId: 'test-init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake', readContractFile: fakeReadContract,
        // H10: mock fetchOriginFile 成功，避免默认 fetchAndShowOriginFile 真跑 git。
        fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
        // H15: mock verifyProposer 成功，避免默认 verifyProposerOutput 真跑 git ls-remote。
        verifyProposer: vi.fn(async () => undefined),
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0 });

      // B39: proposeBranch 由 Brain 计算，格式 cp-harness-propose-r1-{taskId.slice(0,8)}
      expect(result).toMatchObject({ proposeBranch: 'cp-harness-propose-r1-test-tas', round: 1 });
      const warnMsg = warnSpy.mock.calls.flat().join(' ');
      expect(warnMsg).toMatch(/missing.*task-plan\.json/i);
      warnSpy.mockRestore();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('proposer 跑完 sprints/task-plan.json 存在时不应 warn', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-proposer-test-'));
    try {
      await mkdir(path.join(tmp, 'sprints'), { recursive: true });
      await writeFile(path.join(tmp, 'sprints', 'task-plan.json'), '{"tasks":[]}');

      const fakeExecutor = makeExecutorWithResultFile(tmp);
      const fakeReadContract = vi.fn().mockResolvedValue('# fake');

      const { proposer } = createGanContractNodes(fakeExecutor, {
        taskId: 'test-task', initiativeId: 'test-init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake', readContractFile: fakeReadContract,
        // H10: mock fetchOriginFile 成功，避免默认 fetchAndShowOriginFile 真跑 git。
        fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
        // H15: mock verifyProposer 成功，避免默认 verifyProposerOutput 真跑 git ls-remote。
        verifyProposer: vi.fn(async () => undefined),
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0 });

      const warnMsg = warnSpy.mock.calls.flat().join(' ');
      expect(warnMsg).not.toMatch(/missing.*task-plan\.json/i);
      warnSpy.mockRestore();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
