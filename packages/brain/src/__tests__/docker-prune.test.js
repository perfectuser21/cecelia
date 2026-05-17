import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

describe('docker-prune job', () => {
  beforeEach(() => vi.clearAllMocks());

  it('run() 调用 docker image prune -f', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('Total reclaimed space: 1.2GB');
    const { run } = await import('../janitor-jobs/docker-prune.js');
    const result = await run();
    expect(execSync).toHaveBeenCalledWith(
      'docker image prune -f',
      expect.objectContaining({ encoding: 'utf8' })
    );
    expect(result.status).toBe('success');
  });

  it('run() 解析释放空间字节数', async () => {
    const { execSync } = await import('child_process');
    execSync.mockReturnValue('Total reclaimed space: 500MB');
    const { run } = await import('../janitor-jobs/docker-prune.js');
    const result = await run();
    expect(result.freed_bytes).toBeGreaterThan(0);
  });

  it('run() docker 不可用时返回 skipped', async () => {
    const { execSync } = await import('child_process');
    execSync.mockImplementation(() => { throw new Error('docker: command not found'); });
    const { run } = await import('../janitor-jobs/docker-prune.js');
    const result = await run();
    expect(result.status).toBe('skipped');
  });
});
