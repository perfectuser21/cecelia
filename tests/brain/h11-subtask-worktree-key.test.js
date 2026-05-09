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
import { spawnNode } from '../../packages/brain/src/workflows/harness-task.graph.js';
import { evaluateSubTaskNode } from '../../packages/brain/src/workflows/harness-initiative.graph.js';

describe('H11 — harnessSubTaskWorktreePath helper', () => {
  test('返回 <baseRepo>/.claude/worktrees/harness-v2/task-<init8>-<logical>', () => {
    const init = 'feddcf5e-e054-4ee5-9a9d-c4a19418d30d';
    const logical = 'ws1';
    const expected = path.join(DEFAULT_BASE_REPO, '.claude/worktrees/harness-v2', 'task-feddcf5e-ws1');
    expect(harnessSubTaskWorktreePath(init, logical)).toBe(expected);
  });

  test('opts.baseRepo override 生效', () => {
    const got = harnessSubTaskWorktreePath('feddcf5e-uuid', 'ws2', { baseRepo: '/tmp/x' });
    expect(got.startsWith('/tmp/x')).toBe(true);
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
    expect(result).toBe(path.join('/tmp/test', '.claude/worktrees/harness-v2', 'task-custom-key-xyz'));
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

describe('H11 — sub-graph spawnNode 用复合 wtKey 调 ensureWt', () => {
  test('ensureWt 收到的 opts.wtKey = <init8>-<logical>', async () => {
    const ensureWt = vi.fn(async (opts) => '/mock-wt');
    const spawnDetached = vi.fn(async () => ({ exit_code: 0 }));
    const resolveToken = vi.fn(async () => 'gh-token');
    const poolOverride = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const state = {
      task: { id: 'ws1', title: 'Sub Task ws1', payload: {} },
      initiativeId: 'feddcf5e-e054-4ee5-9a9d-c4a19418d30d',
      githubToken: undefined,
      worktreePath: undefined,
      fix_round: 0,
    };
    const result = await spawnNode(state, { ensureWorktree: ensureWt, spawnDetached, resolveToken, poolOverride });

    expect(ensureWt).toHaveBeenCalledOnce();
    const wtKey = ensureWt.mock.calls[0][0].wtKey;
    expect(wtKey).toBe('feddcf5e-ws1');
    // 不应该直接传 'ws1' 作 wtKey（会被 shortTaskId 拒）
    expect(wtKey).not.toBe('ws1');
  });
});

describe('H11 — evaluateSubTaskNode worktreePath 用 harnessSubTaskWorktreePath', () => {
  test('worktreePath = harnessSubTaskWorktreePath(initiativeId, sub_task.id)', async () => {
    const calls = [];
    const spy = async (opts) => {
      calls.push(opts);
      return { exit_code: 0, stdout: '{"verdict":"PASS","feedback":null}', stderr: '', timed_out: false };
    };
    const state = {
      task: { id: 'feddcf5e-e054-4ee5-9a9d-c4a19418d30d', payload: { sprint_dir: 'sprints/test' } },
      sub_task: { id: 'ws1', title: 'sub' },
      initiativeId: 'feddcf5e-e054-4ee5-9a9d-c4a19418d30d',
      worktreePath: '/wrong/main/wt',  // 不该用这个
      task_loop_index: 0,
      taskPlan: { journey_type: 'autonomous' },
      githubToken: 'gh',
      evaluate_verdict: null,
    };
    await evaluateSubTaskNode(state, { executor: spy });
    expect(calls.length).toBe(1);
    const got = calls[0].worktreePath;
    expect(got).toBe(harnessSubTaskWorktreePath(state.initiativeId, 'ws1'));
    expect(got).not.toBe('/wrong/main/wt');
  });
});
