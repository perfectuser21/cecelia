import { describe, it, expect } from 'vitest';
import { ensureHarnessWorktree } from '../harness-worktree.js';
import { makeCpBranchName, shanghaiMMDDHHMM } from '../harness-utils.js';

describe('makeCpBranchName', () => {
  it('returns cp-MMDDHHMM-ws-<shortid> format', () => {
    // 2026-04-24 00:14 UTC → Shanghai 08:14 → MMDDHHMM=04240814
    const now = new Date(Date.UTC(2026, 3, 24, 0, 14, 0));
    const branch = makeCpBranchName('abcdef1234567890-xxxx', { now });
    expect(branch).toBe('cp-04240814-ws-abcdef12');
    expect(branch).toMatch(/^cp-\d{8}-ws-[a-f0-9]{8}$/);
  });

  it('matches branch-protect.sh regex ^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$', () => {
    const now = new Date(Date.UTC(2026, 11, 31, 15, 59, 0));
    const branch = makeCpBranchName('deadbeefcafe0000', { now });
    expect(branch).toMatch(/^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$/);
  });

  it('applies Shanghai timezone (UTC+8) even on UTC host', () => {
    // UTC 23:30 on 04-23 → Shanghai 07:30 on 04-24 → MMDDHHMM=04240730
    const now = new Date(Date.UTC(2026, 3, 23, 23, 30, 0));
    expect(shanghaiMMDDHHMM(now)).toBe('04240730');
    expect(makeCpBranchName('abcdef1200000000', { now })).toBe('cp-04240730-ws-abcdef12');
  });

  it('does not contain harness-v2/ prefix', () => {
    const now = new Date(Date.UTC(2026, 3, 24, 0, 14, 0));
    const branch = makeCpBranchName('abcdef1234567890', { now });
    expect(branch).not.toContain('harness-v2/');
    expect(branch.startsWith('cp-')).toBe(true);
  });

  it('throws when taskId too short', () => {
    expect(() => makeCpBranchName('abc', { now: new Date() })).toThrow(/taskId/);
  });
});

describe('ensureHarnessWorktree branch naming', () => {
  it('invokes git checkout -b with cp-* branch (never harness-v2/)', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;
    const now = new Date(Date.UTC(2026, 3, 24, 0, 14, 0)); // Shanghai 08:14

    await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: '/tmp/cec',
      execFn, statFn, now,
      logFn: () => {},
    });

    const checkoutCall = calls.find(c => c.includes('checkout -b'));
    expect(checkoutCall).toBeTruthy();
    expect(checkoutCall).toContain('cp-04240814-ws-beefcafe');
    // 不允许任何 git 命令把 harness-v2/task- 当作分支名（目录路径里的 harness-v2/task- 除外）
    const branchArg = checkoutCall.split('checkout -b ')[1]?.trim();
    expect(branchArg?.startsWith('harness-v2/')).toBe(false);
    expect(branchArg).toMatch(/^cp-\d{8}-ws-[a-f0-9]{8}$/);
  });

  it('attempts fetch origin main + rebase origin/main after clone', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;

    await ensureHarnessWorktree({
      taskId: 'abcdef1200000000',
      baseRepo: '/tmp/cec',
      execFn, statFn,
      logFn: () => {},
    });

    const fetchCall = calls.find(c => c.includes('fetch origin main'));
    const rebaseCall = calls.find(c => c.includes('rebase origin/main'));
    expect(fetchCall).toBeTruthy();
    expect(rebaseCall).toBeTruthy();
  });

  it('swallows rebase failure (does not throw) + aborts rebase', async () => {
    const calls = [];
    const logs = [];
    const execFn = async (cmd, args) => {
      const joined = [cmd, ...args].join(' ');
      calls.push(joined);
      if (joined.includes('rebase origin/main')) {
        throw new Error('CONFLICT (content): Merge conflict in foo.js');
      }
      return { stdout: '' };
    };
    const statFn = async () => false;
    const logFn = (msg) => logs.push(msg);

    // 不应抛出
    const p = await ensureHarnessWorktree({
      taskId: 'abcdef1200000000',
      baseRepo: '/tmp/cec',
      execFn, statFn, logFn,
    });
    expect(p).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12');
    expect(logs.some(l => l.includes('rebase origin/main skipped'))).toBe(true);
    expect(calls.some(c => c.includes('rebase --abort'))).toBe(true);
  });

  it('rewrites legacy harness-v2/ branch to cp-* when reusing existing worktree', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      const joined = [cmd, ...args].join(' ');
      calls.push(joined);
      if (joined.includes('rev-parse --is-inside-work-tree')) return { stdout: 'true\n' };
      if (joined.includes('rev-parse --abbrev-ref HEAD')) return { stdout: 'harness-v2/task-abcdef12\n' };
      return { stdout: '' };
    };
    const statFn = async () => true;
    const now = new Date(Date.UTC(2026, 3, 24, 0, 14, 0));

    await ensureHarnessWorktree({
      taskId: 'abcdef1200000000',
      baseRepo: '/tmp/cec',
      execFn, statFn, now,
      logFn: () => {},
    });

    const checkoutCall = calls.find(c => c.includes('checkout -B'));
    expect(checkoutCall).toBeTruthy();
    expect(checkoutCall).toContain('cp-04240814-ws-abcdef12');
  });

  it('keeps existing cp-* branch untouched on reuse', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      const joined = [cmd, ...args].join(' ');
      calls.push(joined);
      if (joined.includes('rev-parse --is-inside-work-tree')) return { stdout: 'true\n' };
      if (joined.includes('rev-parse --abbrev-ref HEAD')) return { stdout: 'cp-04240800-ws-abcdef12\n' };
      return { stdout: '' };
    };
    const statFn = async () => true;

    await ensureHarnessWorktree({
      taskId: 'abcdef1200000000',
      baseRepo: '/tmp/cec',
      execFn, statFn,
      logFn: () => {},
    });

    // 不应 checkout -B（当前分支已符合规范）
    expect(calls.some(c => c.includes('checkout -B'))).toBe(false);
    expect(calls.some(c => c.includes('checkout -b'))).toBe(false);
  });
});
