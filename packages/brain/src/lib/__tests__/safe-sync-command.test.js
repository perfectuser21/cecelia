import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'child_process';
import { runSyncCommand } from '../safe-sync-command.js';

describe('runSyncCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('以 argv 且 shell=false 执行，并 trim stdout', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'cp-safe-branch\n', stderr: '' });

    expect(runSyncCommand('gh', ['pr', 'view', 'https://github.com/o/r/pull/1'], {
      timeout: 1000,
      shell: true,
    })).toBe('cp-safe-branch');
    expect(spawnSync).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', 'https://github.com/o/r/pull/1'],
      expect.objectContaining({ encoding: 'utf-8', timeout: 1000, shell: false }),
    );
  });

  it('非零退出时抛出 stderr', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: 'merge conflict' });

    expect(() => runSyncCommand('gh', ['pr', 'merge'])).toThrow('merge conflict');
  });

  it('spawn 错误或超时时原样抛出 error', () => {
    const timeoutError = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' });
    vi.mocked(spawnSync).mockReturnValue({ status: null, stdout: '', stderr: '', error: timeoutError });

    expect(() => runSyncCommand('gh', ['pr', 'view'])).toThrow(timeoutError);
  });
});
