import { describe, it, expect, vi } from 'vitest';
import { ensureHarnessWorktree, cleanupHarnessWorktree } from '../harness-worktree.js';

describe('ensureHarnessWorktree', () => {
  it('returns existing path when dir already a worktree (idempotent)', async () => {
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
    expect(calls.some(c => c.startsWith('git -C /tmp/cec/.claude/worktrees/harness-v2/task-abcdef12 rev-parse'))).toBe(true);
    expect(calls.some(c => c.includes('worktree add'))).toBe(false);
  });

  it('creates new worktree when dir does not exist', async () => {
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
    const addCall = calls.find(c => c.includes('worktree add'));
    expect(addCall).toBeTruthy();
    expect(addCall).toContain('harness-v2/task-beefcafe');
    expect(addCall).toContain('main');
  });

  it('throws when taskId too short', async () => {
    await expect(ensureHarnessWorktree({
      taskId: 'abc',
      baseRepo: '/tmp/cec',
      execFn: async () => ({ stdout: '' }),
      statFn: async () => false,
    })).rejects.toThrow(/taskId/);
  });
});

describe('cleanupHarnessWorktree', () => {
  it('calls git worktree remove --force', async () => {
    const calls = [];
    await cleanupHarnessWorktree('/tmp/wt/task-xxx', {
      execFn: async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { stdout: '' }; },
      baseRepo: '/tmp/cec',
    });
    expect(calls.some(c => c.includes('worktree remove --force'))).toBe(true);
    expect(calls.some(c => c.includes('/tmp/wt/task-xxx'))).toBe(true);
  });

  it('does not throw when path missing', async () => {
    await expect(cleanupHarnessWorktree('/tmp/wt/missing', {
      execFn: async () => { throw new Error('worktree not found'); },
      baseRepo: '/tmp/cec',
    })).resolves.toBeUndefined();
  });
});
