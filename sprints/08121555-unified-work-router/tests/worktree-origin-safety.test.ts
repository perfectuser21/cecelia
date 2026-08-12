import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('恢复前置 [BEHAVIOR]', () => {
  it('含凭据 origin 等价且日志脱敏、活跃 Kernel cwd 不被删除', async () => {
    const module = await import('../../../packages/brain/src/harness-worktree.js');
    const root = await mkdtemp(join(tmpdir(), 'origin-safety-'));
    const secret = 'ghp_NEVER_LOG_THIS';
    const active = join(root, 'active-kernel-cwd');
    const log = join(root, 'reconcile.log');
    await module.__testOnlyCreateWorkspace?.(active, { detached: true, activeRunId: 'run-red' });
    expect(module.canonicalizeRemoteUrl(`https://user:${secret}@github.com/perfectuser21/cecelia.git`)).toBe(module.canonicalizeRemoteUrl('https://github.com/perfectuser21/cecelia.git'));
    expect(module.redactRemoteUrl(`https://user:${secret}@github.com/perfectuser21/cecelia.git`)).not.toContain(secret);
    await module.__testOnlyReconcile?.({ root, origin: `https://user:${secret}@github.com/perfectuser21/cecelia.git`, log });
    expect((await readFile(log, 'utf8'))).not.toContain(secret);
    expect((await stat(active)).isDirectory()).toBe(true);
  });
});
