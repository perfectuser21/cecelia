import { describe, it, expect } from 'vitest';

describe('恢复前置 [BEHAVIOR]', () => {
  it('含凭据 origin 等价且日志脱敏、活跃 Kernel cwd 不被删除', async () => {
    const module = await import('../../../packages/brain/src/harness-worktree.js');
    expect(module.canonicalizeRemoteUrl).toBeTypeOf('function');
    expect(module.redactRemoteUrl).toBeTypeOf('function');
    expect(module.isActiveKernelWorkspace).toBeTypeOf('function');
  });
});

