import { describe, it, expect } from 'vitest';

describe('Recovery Addendum 永久回归', () => {
  it('真实 Git origin 含凭据时仍归一化、日志脱敏并保护活跃 Kernel cwd', async () => {
    const m = await import('../../../packages/brain/src/harness-worktree.js');
    expect(m.canonicalizeHarnessOrigin('https://user:p%40ss@example.com/perfectuser21/cecelia.git'))
      .toBe(m.canonicalizeHarnessOrigin('https://example.com/perfectuser21/cecelia.git'));
    expect(m.redactHarnessOrigin('https://user:p%40ss@example.com/perfectuser21/cecelia.git')).not.toMatch(/user|p%40ss/);
    expect(await m.shouldProtectActiveKernelWorkspace({ cwd: '/tmp/kernel-detached', detached: true })).toBe(true);
  });
});
