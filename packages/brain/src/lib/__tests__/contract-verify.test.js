// SPDX-License-Identifier: MIT
// Test for H15: contract-verify.js — 治本第一步。
// Spec: docs/superpowers/specs/2026-05-10-h15-contract-verify-design.md §4
// 12 cases across 4 named exports. 全部 mock execFn / statFn 注入，不真跑 git/gh/fs。

import { describe, test, expect, vi } from 'vitest';
import {
  ContractViolation,
  verifyProposerOutput,
  verifyGeneratorOutput,
  verifyEvaluatorWorktree,
} from '../contract-verify.js';

// -------- A. ContractViolation class --------
describe('H15 — ContractViolation class', () => {
  test('extends Error + name + details', () => {
    const err = new ContractViolation('boom', { x: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ContractViolation);
    expect(err.name).toBe('ContractViolation');
    expect(err.message).toBe('boom');
    expect(err.details).toEqual({ x: 1 });
  });
});

// -------- B. verifyProposerOutput (5 cases) --------
describe('H15 — verifyProposerOutput', () => {
  const baseOpts = {
    worktreePath: '/tmp/wt',
    branch: 'cp-harness-propose-r1-task',
    sprintDir: 'sprints/test',
    baseRepo: '/tmp/baserepo',
  };

  function makeExecFn(scenario) {
    // scenario keys: getUrl, lsRemote, fetch, show
    return vi.fn().mockImplementation(async (cmd, args) => {
      if (cmd === 'git' && args.includes('remote') && args.includes('get-url')) {
        if (scenario.getUrl?.throw) throw new Error(scenario.getUrl.throw);
        return { stdout: scenario.getUrl?.stdout ?? 'https://github.com/perfectuser21/cecelia\n', stderr: '' };
      }
      if (cmd === 'git' && args[0] === 'ls-remote') {
        if (scenario.lsRemote?.throw) throw new Error(scenario.lsRemote.throw);
        return { stdout: scenario.lsRemote?.stdout ?? '', stderr: '' };
      }
      if (cmd === 'git' && args[0] === 'fetch') {
        if (scenario.fetch?.throw) throw new Error(scenario.fetch.throw);
        return { stdout: '', stderr: '' };
      }
      if (cmd === 'git' && args[0] === 'show') {
        if (scenario.show?.throw) throw new Error(scenario.show.throw);
        return { stdout: scenario.show?.stdout ?? '', stderr: '' };
      }
      throw new Error(`unexpected cmd: ${cmd} ${args.join(' ')}`);
    });
  }

  test('happy: ls-remote 返 sha + git show 返 valid task-plan JSON → 不 throw', async () => {
    const execFn = makeExecFn({
      lsRemote: { stdout: 'abc123\trefs/heads/cp-harness-propose-r1-task\n' },
      show: { stdout: JSON.stringify({ tasks: [{ id: 'ws1' }] }) },
    });
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).resolves.toBeUndefined();
  });

  test('branch missing: ls-remote 返 "" → throw ContractViolation(proposer_didnt_push, branch 名)', async () => {
    const execFn = makeExecFn({
      lsRemote: { stdout: '' },
    });
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(ContractViolation);
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(/proposer_didnt_push/);
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(/cp-harness-propose-r1-task/);
  });

  test('task-plan 不存在: git show throw → throw ContractViolation 含 taskPlanPath', async () => {
    const execFn = makeExecFn({
      lsRemote: { stdout: 'abc123\n' },
      show: { throw: 'fatal: pathspec did not match' },
    });
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(ContractViolation);
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(/task-plan\.json/);
  });

  test('task-plan invalid JSON: parse throw → throw ContractViolation 含 invalid_task_plan', async () => {
    const execFn = makeExecFn({
      lsRemote: { stdout: 'abc123\n' },
      show: { stdout: 'NOT_JSON{{{' },
    });
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(ContractViolation);
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(/invalid_task_plan/);
  });

  test('task-plan empty tasks: parsed.tasks=[] → throw ContractViolation 含 empty_task_plan', async () => {
    const execFn = makeExecFn({
      lsRemote: { stdout: 'abc123\n' },
      show: { stdout: JSON.stringify({ tasks: [] }) },
    });
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(ContractViolation);
    await expect(verifyProposerOutput({ ...baseOpts, execFn })).rejects.toThrow(/empty_task_plan/);
  });
});

// -------- C. verifyGeneratorOutput (6 cases) --------
describe('H15 — verifyGeneratorOutput', () => {
  test('happy: pr_url 非空 + gh pr view 不 throw + 无 requiredArtifacts → 不 throw（不调 gh pr diff）', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '{"number":1,"state":"OPEN"}', stderr: '' });
    await expect(
      verifyGeneratorOutput({ pr_url: 'https://github.com/x/y/pull/1', execFn }),
    ).resolves.toBeUndefined();
    expect(execFn).toHaveBeenCalledOnce();
    expect(execFn.mock.calls[0][1][0]).toBe('pr');
    expect(execFn.mock.calls[0][1][1]).toBe('view');
  });

  test('pr_url null → throw ContractViolation 含 no_pr_url', async () => {
    const execFn = vi.fn();
    await expect(verifyGeneratorOutput({ pr_url: null, execFn })).rejects.toThrow(ContractViolation);
    await expect(verifyGeneratorOutput({ pr_url: null, execFn })).rejects.toThrow(/no_pr_url/);
    expect(execFn).not.toHaveBeenCalled();
  });

  test('gh pr view throw → throw ContractViolation 含 pr_not_found', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('gh: not found'));
    await expect(
      verifyGeneratorOutput({ pr_url: 'https://github.com/x/y/pull/999', execFn }),
    ).rejects.toThrow(ContractViolation);
    await expect(
      verifyGeneratorOutput({ pr_url: 'https://github.com/x/y/pull/999', execFn }),
    ).rejects.toThrow(/pr_not_found/);
  });

  test('happy: requiredArtifacts 全部出现在 gh pr diff 输出 → 不 throw', async () => {
    const diffOut = `diff --git a/packages/brain/src/foo.js b/packages/brain/src/foo.js
index 0..1 100644
--- a/packages/brain/src/foo.js
+++ b/packages/brain/src/foo.js
@@ -1 +1 @@
-old
+new
diff --git a/packages/brain/src/bar.js b/packages/brain/src/bar.js
@@ ...
`;
    const execFn = vi.fn().mockImplementation(async (cmd, args) => {
      if (args[1] === 'view') return { stdout: '{"number":1,"state":"OPEN"}', stderr: '' };
      if (args[1] === 'diff') return { stdout: diffOut, stderr: '' };
      throw new Error(`unexpected: ${args.join(' ')}`);
    });
    await expect(
      verifyGeneratorOutput({
        pr_url: 'https://github.com/x/y/pull/1',
        requiredArtifacts: ['packages/brain/src/foo.js', 'packages/brain/src/bar.js'],
        execFn,
      }),
    ).resolves.toBeUndefined();
    expect(execFn).toHaveBeenCalledTimes(2);
  });

  test('requiredArtifacts 1 个缺失 → throw ContractViolation 含 missing 路径', async () => {
    const diffOut = `diff --git a/packages/brain/src/foo.js b/packages/brain/src/foo.js
@@ ...
`;
    const execFn = vi.fn().mockImplementation(async (cmd, args) => {
      if (args[1] === 'view') return { stdout: '{}', stderr: '' };
      if (args[1] === 'diff') return { stdout: diffOut, stderr: '' };
      throw new Error('unexpected');
    });
    await expect(
      verifyGeneratorOutput({
        pr_url: 'https://github.com/x/y/pull/1',
        requiredArtifacts: ['packages/brain/src/foo.js', 'packages/brain/src/missing.js'],
        execFn,
      }),
    ).rejects.toThrow(ContractViolation);
    await expect(
      verifyGeneratorOutput({
        pr_url: 'https://github.com/x/y/pull/1',
        requiredArtifacts: ['packages/brain/src/foo.js', 'packages/brain/src/missing.js'],
        execFn,
      }),
    ).rejects.toThrow(/missing\.js/);
  });

  test('gh pr diff exec 失败 → throw ContractViolation 含 pr_diff_failed', async () => {
    const execFn = vi.fn().mockImplementation(async (cmd, args) => {
      if (args[1] === 'view') return { stdout: '{}', stderr: '' };
      if (args[1] === 'diff') throw new Error('gh: server error');
      throw new Error('unexpected');
    });
    await expect(
      verifyGeneratorOutput({
        pr_url: 'https://github.com/x/y/pull/1',
        requiredArtifacts: ['packages/brain/src/foo.js'],
        execFn,
      }),
    ).rejects.toThrow(ContractViolation);
    await expect(
      verifyGeneratorOutput({
        pr_url: 'https://github.com/x/y/pull/1',
        requiredArtifacts: ['packages/brain/src/foo.js'],
        execFn,
      }),
    ).rejects.toThrow(/pr_diff_failed/);
  });
});

// -------- D. verifyEvaluatorWorktree (3 cases) --------
describe('H15 — verifyEvaluatorWorktree', () => {
  test('happy: 所有 expectedFiles 都 stat true → 不 throw', async () => {
    const statFn = vi.fn().mockResolvedValue(true);
    await expect(
      verifyEvaluatorWorktree({
        worktreePath: '/tmp/wt',
        expectedFiles: ['a.md', 'b.md', 'c.md'],
        statFn,
      }),
    ).resolves.toBeUndefined();
    expect(statFn).toHaveBeenCalledTimes(3);
  });

  test('1 个 missing → throw ContractViolation 含 missing 文件名', async () => {
    const statFn = vi.fn().mockImplementation(async (p) => !p.endsWith('b.md'));
    await expect(
      verifyEvaluatorWorktree({
        worktreePath: '/tmp/wt',
        expectedFiles: ['a.md', 'b.md', 'c.md'],
        statFn,
      }),
    ).rejects.toThrow(ContractViolation);
    await expect(
      verifyEvaluatorWorktree({
        worktreePath: '/tmp/wt',
        expectedFiles: ['a.md', 'b.md', 'c.md'],
        statFn,
      }),
    ).rejects.toThrow(/b\.md/);
  });

  test('多个 missing → throw 含全部 missing 列表', async () => {
    const statFn = vi.fn().mockImplementation(async (p) => p.endsWith('a.md'));
    let caught;
    try {
      await verifyEvaluatorWorktree({
        worktreePath: '/tmp/wt',
        expectedFiles: ['a.md', 'b.md', 'c.md'],
        statFn,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ContractViolation);
    expect(caught.message).toMatch(/b\.md/);
    expect(caught.message).toMatch(/c\.md/);
    expect(caught.details.missing).toEqual(['b.md', 'c.md']);
  });
});
