import { describe, it, expect, vi } from 'vitest';
import { ensureHarnessWorktree, cleanupHarnessWorktree } from '../harness-worktree.js';

describe('ensureHarnessWorktree', () => {
  it('returns existing path when dir is a git repo (idempotent)', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (args[0] === '-C' && args[2] === 'rev-parse') return { stdout: 'true\n' };
      return { stdout: '' };
    };
    const statFn = async () => true;

    const p = await ensureHarnessWorktree({
      taskId: 'abcdef1234567890-xxx',
      baseRepo: '/tmp/cec',
      execFn, statFn,
    });
    expect(p).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12');
    expect(calls.some(c => c.includes('clone'))).toBe(false);
    expect(calls.some(c => c.includes('worktree add'))).toBe(false);
  });

  it('clones independent repo when dir does not exist', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;

    const p = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: '/tmp/cec',
      execFn, statFn,
    });
    expect(p).toBe('/tmp/cec/.claude/worktrees/harness-v2/task-beefcafe');
    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toBeTruthy();
    expect(cloneCall).toContain('--local');
    expect(cloneCall).toContain('--no-hardlinks');
    expect(cloneCall).toContain('--branch main');
    expect(cloneCall).toContain('--single-branch');
    expect(cloneCall).toContain('/tmp/cec');
    expect(cloneCall).toContain('/tmp/cec/.claude/worktrees/harness-v2/task-beefcafe');
    const checkoutCall = calls.find(c => c.includes('checkout -b'));
    expect(checkoutCall).toBeTruthy();
    expect(checkoutCall).toContain('harness-v2/task-beefcafe');
  });

  it('does not call git worktree add anywhere', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;

    await ensureHarnessWorktree({
      taskId: 'abcdef1234567890',
      baseRepo: '/tmp/cec',
      execFn, statFn,
    });
    expect(calls.some(c => c.includes('worktree add'))).toBe(false);
  });

  it('throws when taskId too short', async () => {
    await expect(ensureHarnessWorktree({
      taskId: 'abc',
      baseRepo: '/tmp/cec',
      execFn: async () => ({ stdout: '' }),
      statFn: async () => false,
    })).rejects.toThrow(/taskId/);
  });

  it('cleans dir and re-clones when dir exists but is not a git repo', async () => {
    const calls = [];
    let rmCalled = false;
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (args[0] === '-C' && args[2] === 'rev-parse') {
        throw new Error('not a git repo');
      }
      return { stdout: '' };
    };
    const statFn = async () => true;
    const rmFn = async () => { rmCalled = true; };

    await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: '/tmp/cec',
      execFn, statFn, rmFn,
    });
    expect(rmCalled).toBe(true);
    expect(calls.some(c => c.startsWith('git clone'))).toBe(true);
  });
});

describe('cleanupHarnessWorktree', () => {
  it('calls rmFn with the path', async () => {
    const removed = [];
    await cleanupHarnessWorktree('/tmp/wt/task-xxx', {
      rmFn: async (p) => { removed.push(p); },
    });
    expect(removed).toEqual(['/tmp/wt/task-xxx']);
  });

  it('does not throw when rmFn fails', async () => {
    await expect(cleanupHarnessWorktree('/tmp/wt/missing', {
      rmFn: async () => { throw new Error('nope'); },
    })).resolves.toBeUndefined();
  });
});
