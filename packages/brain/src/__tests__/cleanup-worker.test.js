/**
 * cleanup-worker.test.js —— R4 孤儿 worktree 清理 worker 单元测试
 *
 * 这里 mock child_process.exec，验证 worker 的 JS 壳层逻辑：
 *   - 成功路径
 *   - DRY_RUN 选项正确传入 env
 *   - GRACE_SECONDS 选项正确传入 env
 *   - 脚本报错时返回 success=false
 *
 * shell 脚本本身（安全守卫 A~E）通过 DRY_RUN=1 跑一次做冒烟验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'child_process';

const { runCleanupWorker } = await import('../cleanup-worker.js');

describe('cleanup-worker', () => {
  beforeEach(() => {
    exec.mockReset();
  });

  it('成功执行脚本时返回 success=true 并带 stdout', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      cb(null, '[cleanup-worker] starting\n[cleanup] removed /tmp/wt (branch=cp-x)\n', '');
    });
    const r = await runCleanupWorker();
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('[cleanup]');
    expect(exec).toHaveBeenCalledTimes(1);
    // 不带 dryRun 时 env 不应有 DRY_RUN=1
    const [, opts] = exec.mock.calls[0];
    expect(opts.env.DRY_RUN).toBeUndefined();
  });

  it('dryRun=true 将 DRY_RUN=1 传入 env', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      expect(opts.env.DRY_RUN).toBe('1');
      cb(null, '[cleanup-worker] done', '');
    });
    const r = await runCleanupWorker({ dryRun: true });
    expect(r.success).toBe(true);
  });

  it('graceSeconds 选项传入 env', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      expect(opts.env.GRACE_SECONDS).toBe('7200');
      cb(null, '', '');
    });
    await runCleanupWorker({ graceSeconds: 7200 });
  });

  it('脚本报错时返回 success=false 并保留 error', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      const err = new Error('bash: cleanup-merged-worktrees.sh: not executable');
      cb(err, '', 'perm denied');
    });
    const r = await runCleanupWorker();
    expect(r.success).toBe(false);
    expect(r.error).toContain('not executable');
    expect(r.stderr).toContain('perm denied');
  });

  it('timeoutMs 透传到 exec options', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      expect(opts.timeout).toBe(5000);
      expect(opts.maxBuffer).toBe(10 * 1024 * 1024);
      cb(null, '', '');
    });
    await runCleanupWorker({ timeoutMs: 5000 });
  });
});
