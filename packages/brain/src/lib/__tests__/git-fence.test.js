import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSyncCalls = [];
let execSyncImpl;
vi.mock('node:child_process', () => ({
  execSync: (cmd, opts) => {
    execSyncCalls.push({ cmd, cwd: opts?.cwd });
    if (execSyncImpl) return execSyncImpl(cmd, opts);
    throw new Error('execSyncImpl not set');
  },
}));

import { fetchAndShowOriginFile } from '../git-fence.js';

describe('fetchAndShowOriginFile [BEHAVIOR]', () => {
  beforeEach(() => {
    execSyncCalls.length = 0;
    execSyncImpl = null;
  });

  it('fetch + show 都成功 → 返回内容', async () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('git fetch')) return '';
      if (cmd.includes('git show')) return 'file-content';
      throw new Error('unexpected: ' + cmd);
    };
    const result = await fetchAndShowOriginFile('/wt', 'cp-test', 'sprints/x.json');
    expect(execSyncCalls.length).toBe(2);
    // 关键：fetch 必须用 refspec 格式 origin/branch:refs/remotes/origin/branch
    expect(execSyncCalls[0].cmd).toMatch(/git fetch origin cp-test:refs\/remotes\/origin\/cp-test/);
    expect(execSyncCalls[1].cmd).toContain('git show origin/cp-test');
    expect(result).toBe('file-content');
  });

  it('fetch 失败 graceful warn → 继续 git show', async () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('git fetch')) throw new Error('fatal: could not read');
      if (cmd.includes('git show')) return 'content';
      throw new Error('unexpected: ' + cmd);
    };
    const result = await fetchAndShowOriginFile('/wt', 'cp-test', 'x.json');
    expect(execSyncCalls.length).toBe(2);
    expect(result).toBe('content');
  });

  it('fetch 成功 + show 失败 → throw 原 show 错误', async () => {
    execSyncImpl = (cmd) => {
      if (cmd.includes('git fetch')) return '';
      if (cmd.includes('git show')) throw new Error('fatal: invalid object name');
      throw new Error('unexpected: ' + cmd);
    };
    await expect(fetchAndShowOriginFile('/wt', 'cp-test', 'x.json')).rejects.toThrow('invalid object name');
  });

  it('cwd 必须是 worktreePath', async () => {
    execSyncImpl = () => 'content';
    await fetchAndShowOriginFile('/some/worktree', 'cp-test', 'x.json');
    for (const call of execSyncCalls) {
      expect(call.cwd).toBe('/some/worktree');
    }
  });
});
