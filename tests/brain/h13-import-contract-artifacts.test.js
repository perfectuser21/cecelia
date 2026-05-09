// SPDX-License-Identifier: MIT
// Test for H13: spawnNode 容器启动前 import proposer 合同物件到 generator worktree。
// 修 W8 v14 evaluator FAIL 真根因：generator 看不到 proposer 的 contract-dod / tests / task-plan。

import { describe, test, expect, vi } from 'vitest';
import { spawnNode } from '../../packages/brain/src/workflows/harness-task.graph.js';

function makeBaseState(overrides = {}) {
  return {
    task: { id: 'ws1', title: 'Sub task', payload: {} },
    initiativeId: 'feddcf5e-init',
    githubToken: undefined,
    worktreePath: undefined,
    fix_round: 0,
    contractBranch: 'cp-harness-propose-r3-feddcf5e',
    contractImported: false,
    ...overrides,
  };
}

function makeOpts({ execFileSpy, ...rest } = {}) {
  return {
    ensureWorktree: vi.fn(async () => '/mock-wt'),
    spawnDetached: vi.fn(async () => ({ exit_code: 0 })),
    resolveToken: vi.fn(async () => 'gh-token'),
    poolOverride: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    execFile: execFileSpy || vi.fn(async () => ({ stdout: '', stderr: '' })),
    ...rest,
  };
}

describe('H13 — spawnNode import contract artifacts', () => {
  test('contractBranch 存在 → 调用 git fetch + checkout sprints/ + add + commit', async () => {
    const execFileSpy = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const opts = makeOpts({ execFileSpy });
    await spawnNode(makeBaseState(), opts);

    // 至少 4 个 git 调用：fetch / checkout / add / commit
    const gitCalls = execFileSpy.mock.calls.filter((args) => args[0] === 'git');
    expect(gitCalls.length).toBeGreaterThanOrEqual(4);
    // fetch 含 contractBranch
    expect(gitCalls.some((c) => c[1].includes('fetch') && c[1].some((a) => a.includes('cp-harness-propose-r3-feddcf5e')))).toBe(true);
    // checkout origin/<contractBranch> -- sprints/
    expect(gitCalls.some((c) => c[1].includes('checkout') && c[1].some((a) => a.includes('sprints/')))).toBe(true);
    // add sprints/
    expect(gitCalls.some((c) => c[1][0] === 'add' && c[1].some((a) => a.includes('sprints/')))).toBe(true);
  });

  test('contractBranch null → 不调用 git fetch/checkout', async () => {
    const execFileSpy = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const opts = makeOpts({ execFileSpy });
    await spawnNode(makeBaseState({ contractBranch: null }), opts);
    const gitCalls = execFileSpy.mock.calls.filter((args) => args[0] === 'git');
    // 不应有 fetch/checkout
    expect(gitCalls.some((c) => c[1].includes('fetch'))).toBe(false);
    expect(gitCalls.some((c) => c[1].includes('checkout'))).toBe(false);
  });

  test('contractImported=true → 短路不重复 import', async () => {
    const execFileSpy = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const opts = makeOpts({ execFileSpy });
    await spawnNode(makeBaseState({ contractImported: true }), opts);
    const gitCalls = execFileSpy.mock.calls.filter((args) => args[0] === 'git');
    expect(gitCalls.some((c) => c[1].includes('fetch'))).toBe(false);
  });

  test('git fetch 失败 → return error 不推进', async () => {
    const execFileSpy = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && args.includes('fetch')) {
        throw new Error('git fetch failed: 503');
      }
      return { stdout: '', stderr: '' };
    });
    const opts = makeOpts({ execFileSpy });
    const result = await spawnNode(makeBaseState(), opts);
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('spawn');
    expect(result.error.message).toMatch(/import contract|fetch failed/);
  });
});
