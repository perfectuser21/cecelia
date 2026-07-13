// SPDX-License-Identifier: MIT
// Test for H11: sub-task worktree key 用 <init8>-<logical_id> 复合，修 PR #2851 P0。

import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import {
  harnessSubTaskWorktreePath,
  harnessSubTaskBranchName,
  ensureHarnessWorktree,
  DEFAULT_BASE_REPO,
} from '../../packages/brain/src/harness-worktree.js';
// 刀4阶段3：harness-task.graph.js / harness-initiative.graph.js 已物理删除（LangGraph 图路径
// 废弃，orchestrator 硬校验后全走 skill-relay）。下方原先测 spawnNode/evaluateSubTaskNode
// （死图节点）的用例已删除，只保留测 harness-worktree.js 活代码 helper 的用例。

describe('H11 — harnessSubTaskWorktreePath helper', () => {
  test('返回 <baseRepo>/.claude/worktrees/harness-v2/task-<init8>-<logical>', () => {
    const init = 'feddcf5e-e054-4ee5-9a9d-c4a19418d30d';
    const logical = 'ws1';
    const expected = path.join(DEFAULT_BASE_REPO, '.claude/worktrees/harness-v2', 'task-feddcf5e-ws1');
    expect(harnessSubTaskWorktreePath(init, logical)).toBe(expected);
  });

  test('opts.baseRepo 不影响 wtPath — 始终在 DEFAULT_BASE_REPO 下', () => {
    const got = harnessSubTaskWorktreePath('feddcf5e-uuid', 'ws2', { baseRepo: '/tmp/x' });
    expect(got.startsWith(DEFAULT_BASE_REPO)).toBe(true);
    expect(got.endsWith('task-feddcf5e-ws2')).toBe(true);
  });
});

describe('H11 — harnessSubTaskBranchName helper', () => {
  test('格式 cp-<MMDDHHMM>-ws-<init8>-<logical>，带 logical 区分度', () => {
    const init = 'feddcf5e-e054-4ee5-9a9d-c4a19418d30d';
    const now = new Date('2026-05-09T15:34:57+08:00');
    const b1 = harnessSubTaskBranchName(init, 'ws1', { now });
    const b2 = harnessSubTaskBranchName(init, 'ws2', { now });
    expect(b1).toMatch(/^cp-\d{8}-ws-feddcf5e-ws1$/);
    expect(b2).toMatch(/^cp-\d{8}-ws-feddcf5e-ws2$/);
    expect(b1).not.toBe(b2);  // 不同 logical 必须不同 branch
  });
});

describe('H11 — ensureHarnessWorktree wtKey override', () => {
  test('opts.wtKey 配上时优先于 shortTaskId(taskId) 计算 path', async () => {
    // mock execFn / statFn 让 ensureWt 不真去 git
    const calls = [];
    const execFn = vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      // mock git rev-parse / remote 返回 valid worktree
      if (args[args.length - 1] === '--is-inside-work-tree') return { stdout: 'true' };
      if (args.includes('get-url')) return { stdout: 'https://example/cecelia.git' };
      return { stdout: '' };
    });
    const statFn = vi.fn(async () => true);  // worktree dir exists
    const result = await ensureHarnessWorktree({
      taskId: 'abcd1234-uuid',
      wtKey: 'custom-key-xyz',
      baseRepo: '/tmp/test',
      execFn,
      statFn,
    });
    expect(result).toBe(path.join(DEFAULT_BASE_REPO, '.claude/worktrees/harness-v2', 'task-custom-key-xyz'));
  });

  test('opts.wtKey 配上时短 taskId 不 throw shortTaskId', async () => {
    const execFn = vi.fn(async (cmd, args) => {
      if (args[args.length - 1] === '--is-inside-work-tree') return { stdout: 'true' };
      if (args.includes('get-url')) return { stdout: 'https://example/cecelia.git' };
      return { stdout: '' };
    });
    const statFn = vi.fn(async () => true);
    // taskId='ws1' 短，但配 wtKey 应不 throw
    await expect(
      ensureHarnessWorktree({
        taskId: 'ws1',
        wtKey: 'feddcf5e-ws1',
        branch: 'cp-12345678-ws-feddcf5e-ws1',  // override branch 也避免 makeCpBranchName 短 taskId 挂
        baseRepo: '/tmp/test',
        execFn,
        statFn,
      })
    ).resolves.toBeDefined();
  });
});
