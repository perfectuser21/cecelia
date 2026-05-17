// SPDX-License-Identifier: MIT
// Test for H16: ensureHarnessWorktree clone 后 origin set-url 到 GitHub。
//
// 根因：clone --local 让新 worktree 的 origin 指向主仓库本地路径，
// 但 proposer push 是 push 到主仓库的 GitHub origin —— 所以 cp-harness-propose-* 分支
// 只在 GitHub 上有，新 worktree 的 origin 里没有，sub-graph 里 git fetch 必然失败。
//
// 修法：clone 后立刻 git remote set-url origin <baseRepo 的 GitHub URL>。

import { describe, test, expect, vi } from 'vitest';
import { ensureHarnessWorktree } from '../../packages/brain/src/harness-worktree.js';

describe('H16 — ensureHarnessWorktree clone 后 origin URL 改 GitHub', () => {
  test('clone 后调 git -C wtPath remote set-url origin <GitHub URL>', async () => {
    const calls = [];
    const execFn = vi.fn(async (cmd, args, _opts) => {
      calls.push({ cmd, args: [...args] });
      // mock baseRepo origin URL = GitHub URL
      if (args.includes('get-url') && args.includes('origin')) {
        return { stdout: 'https://github.com/perfectuser21/cecelia.git\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const statFn = vi.fn(async () => false); // dir 不存在 → 走 clone 路径

    await ensureHarnessWorktree({
      taskId: 'feddcf5e11111111',
      wtKey: 'feddcf5e-ws1',
      branch: 'cp-12345678-ws-feddcf5e-ws1',
      baseRepo: '/mock-base',
      execFn,
      statFn,
      logFn: () => {},
    });

    // 必须有 set-url 调用 + URL 是 GitHub URL（已 trim）
    const setUrlCall = calls.find(
      (c) => c.args.includes('set-url') && c.args.includes('origin')
    );
    expect(setUrlCall).toBeDefined();
    expect(setUrlCall.args).toContain('https://github.com/perfectuser21/cecelia.git');

    // get-url 必须是从 baseRepo 拿（不是从 wtPath 拿）
    const getUrlCall = calls.find(
      (c) => c.args.includes('get-url') && c.args.includes('origin') && c.args.includes('/mock-base')
    );
    expect(getUrlCall).toBeDefined();
  });

  test('git get-url 失败时 set-url 跳过 + logFn 警告但不抛', async () => {
    let logged = '';
    const execFn = vi.fn(async (cmd, args, _opts) => {
      // get-url 抛错模拟 baseRepo origin remote 缺失
      if (args.includes('get-url') && args.includes('origin')) {
        throw new Error('cannot read remote origin');
      }
      return { stdout: '', stderr: '' };
    });
    const statFn = vi.fn(async () => false);
    const logFn = vi.fn((msg) => {
      logged += msg + '\n';
    });

    await expect(
      ensureHarnessWorktree({
        taskId: 'feddcf5e11111111',
        wtKey: 'feddcf5e-ws1',
        branch: 'cp-12345678-ws-feddcf5e-ws1',
        baseRepo: '/mock-base',
        execFn,
        statFn,
        logFn,
      })
    ).resolves.toBeDefined();

    // 警告消息要含 origin/get-url/GitHub 关键词其一
    expect(logged).toMatch(/origin URL|get-url|GitHub/);
  });
});
