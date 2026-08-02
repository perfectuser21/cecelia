import { describe, it, expect, vi } from 'vitest';
import { ensureHarnessWorktree, cleanupHarnessWorktree } from '../harness-worktree.js';

describe('ensureHarnessWorktree', () => {
  it('returns existing path when dir is a git repo (idempotent)', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      const joined = [cmd, ...args].join(' ');
      calls.push(joined);
      if (joined.includes('rev-parse --is-inside-work-tree')) return { stdout: 'true\n' };
      if (joined.includes('rev-parse --abbrev-ref HEAD')) return { stdout: 'cp-04240814-ws-abcdef12\n' };
      if (joined.includes('remote get-url origin')) return { stdout: '/tmp/cec\n' };
      return { stdout: '' };
    };
    const statFn = async () => true;

    const p = await ensureHarnessWorktree({
      taskId: 'abcdef1234567890-xxx',
      baseRepo: '/tmp/cec',
      execFn, statFn,
      logFn: () => {},
    });
    expect(p).toBe('/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-abcdef12');
    expect(calls.some(c => c.includes('clone'))).toBe(false);
    expect(calls.some(c => c.includes('worktree add'))).toBe(false);
  });

  it('clones with --local when cloneSource is a local path', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    // wtPath doesn't exist (false), cloneSource is local (true)
    const wtPath = '/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-beefcafe';
    const statFn = async (p) => p === '/tmp/cec';

    const p = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: '/tmp/cec',
      execFn, statFn,
      logFn: () => {},
    });
    expect(p).toBe(wtPath);
    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toBeTruthy();
    expect(cloneCall).toContain('--local');
    expect(cloneCall).toContain('--no-hardlinks');
    expect(cloneCall).toContain('--branch main');
    expect(cloneCall).toContain('--single-branch');
    expect(cloneCall).toContain('/tmp/cec');
    expect(cloneCall).toContain(wtPath);
    const checkoutCall = calls.find(c => c.includes('checkout -b'));
    expect(checkoutCall).toBeTruthy();
    // 分支名改为 cp-* 规约（符合 branch-protect.sh 正则 + CI branch-naming）
    const branchArg = checkoutCall.split('checkout -b ')[1]?.trim();
    expect(branchArg).toMatch(/^cp-\d{8}-ws-beefcafe$/);
    expect(branchArg?.startsWith('harness-v2/')).toBe(false);
  });

  it('clones without --local when cloneSource is a remote URL', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    // cloneSource is a remote URL (statFn always false)
    const statFn = async () => false;
    const remoteUrl = 'https://github.com/perfectuser21/zenithjoy-workspace';

    const p = await ensureHarnessWorktree({
      taskId: 'beefcafe11111111',
      baseRepo: remoteUrl,
      execFn, statFn,
      tokenFn: async () => '', // 显式无 token → clone 用裸 URL（隔离环境 GITHUB_TOKEN）
      logFn: () => {},
    });
    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toBeTruthy();
    expect(cloneCall).not.toContain('--local');
    expect(cloneCall).not.toContain('--no-hardlinks');
    expect(cloneCall).toContain('--branch main');
    expect(cloneCall).toContain('--single-branch');
    expect(cloneCall).toContain(remoteUrl);
  });

  it('normalizes an owner/repo slug before cloning a remote repository', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;

    await ensureHarnessWorktree({
      taskId: 'feedface11111111',
      baseRepo: 'perfectuser21/zenithjoy-workspace',
      execFn,
      statFn,
      tokenFn: async () => 'ghp_fixture',
      logFn: () => {},
    });

    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toBeTruthy();
    expect(cloneCall).toContain(
      'https://x-access-token:ghp_fixture@github.com/perfectuser21/zenithjoy-workspace.git',
    );
    expect(cloneCall).not.toContain(' --single-branch perfectuser21/zenithjoy-workspace ');
    const setUrlCall = calls.find(c => c.includes('remote set-url origin'));
    expect(setUrlCall).toContain('https://github.com/perfectuser21/zenithjoy-workspace.git');
    expect(setUrlCall).not.toContain('ghp_fixture');
  });

  it('远端 URL clone 注入 GITHUB_TOKEN（x-access-token），clone 后改回干净 origin', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;
    const remoteUrl = 'https://github.com/perfectuser21/infrastructure.git';

    await ensureHarnessWorktree({
      taskId: 'beefcafe22222222',
      baseRepo: remoteUrl,
      execFn, statFn,
      tokenFn: async () => 'ghp_secret_token',
      logFn: () => {},
    });

    // clone 用注入 token 的 URL（不是裸 URL）
    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toContain('https://x-access-token:ghp_secret_token@github.com/perfectuser21/infrastructure.git');
    // clone 后把 origin 改回干净 URL（不落盘 token）
    const setUrlCall = calls.find(c => c.includes('remote set-url origin'));
    expect(setUrlCall).toBeTruthy();
    expect(setUrlCall).toContain(remoteUrl);
    expect(setUrlCall).not.toContain('x-access-token');
  });

  it('远端 URL 但 tokenFn 返回空时，clone 退回裸 URL（best-effort，不阻塞）', async () => {
    const calls = [];
    const execFn = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { stdout: '' };
    };
    const statFn = async () => false;
    const remoteUrl = 'https://github.com/perfectuser21/infrastructure.git';

    await ensureHarnessWorktree({
      taskId: 'beefcafe33333333',
      baseRepo: remoteUrl,
      execFn, statFn,
      tokenFn: async () => '',
      logFn: () => {},
    });

    const cloneCall = calls.find(c => c.startsWith('git clone'));
    expect(cloneCall).toContain(remoteUrl);
    expect(cloneCall).not.toContain('x-access-token');
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
      logFn: () => {},
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
      logFn: () => {},
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
