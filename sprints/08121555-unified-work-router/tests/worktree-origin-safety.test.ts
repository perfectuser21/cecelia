import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('恢复前置 [BEHAVIOR]', () => {
  it('含凭据 origin 等价且日志脱敏、活跃 Kernel cwd 不被删除', async () => {
    const root = await mkdtemp(join(tmpdir(), 'origin-safety-'));
    const source = join(root, 'source');
    const workspaceRoot = join(root, 'managed');
    const secret = 'ghp_NEVER_LOG_THIS';
    const log = join(root, 'reconcile.log');
    execFileSync('git', ['init', '--bare', source]);
    const seed = join(root, 'seed');
    execFileSync('git', ['clone', source, seed]);
    git(seed, 'config', 'user.email', 'harness@example.invalid');
    git(seed, 'config', 'user.name', 'Harness');
    await writeFile(join(seed, 'README'), 'seed\n');
    git(seed, 'add', 'README'); git(seed, 'commit', '-m', 'seed'); git(seed, 'branch', '-M', 'main'); git(seed, '-c', 'core.hooksPath=/dev/null', 'push', 'origin', 'main');

    const module = await import('../../../packages/brain/src/harness-worktree.js');
    const active = await module.ensureHarnessWorktree({ taskId: '12345678-red', baseRepo: source, workspaceRoot, logFile: log });
    git(active, 'remote', 'set-url', 'origin', `https://user:${secret}@github.com/perfectuser21/cecelia.git`);
    git(active, 'checkout', '--detach');
    await module.registerActiveKernelWorkspace({ runId: 'run-red', cwd: active });
    const reused = await module.ensureHarnessWorktree({ taskId: '12345678-red', baseRepo: 'https://github.com/perfectuser21/cecelia.git', workspaceRoot, logFile: log });
    expect(reused).toBe(active);
    expect((await readFile(log, 'utf8'))).not.toContain(secret);
    expect((await stat(active)).isDirectory()).toBe(true);
    expect(git(active, 'rev-parse', '--is-inside-work-tree')).toBe('true');
  });
});
