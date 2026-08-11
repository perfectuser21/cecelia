import { describe, it, expect } from 'vitest';
import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const deployPath = new URL('../../../scripts/deploy.sh', import.meta.url);

describe('Dashboard HK/US 单一发布主链 [BEHAVIOR]', () => {
  it('dashboard-only 调用唯一发布主链并传播失败', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-deploy-success-'));
    await mkdir(join(root, 'scripts'));
    await cp(deployPath, join(root, 'scripts/deploy.sh'));
    await writeFile(join(root, 'scripts/rebuild-dashboard.sh'), '#!/bin/sh\necho rebuild >> "$TRACE"\n');
    await writeFile(join(root, 'scripts/promote-dashboard.sh'), '#!/bin/sh\necho promote >> "$TRACE"\n');
    await Promise.all(['deploy.sh', 'rebuild-dashboard.sh', 'promote-dashboard.sh'].map((name) => chmod(join(root, 'scripts', name), 0o755)));
    const trace = join(root, 'trace.log');
    const result = spawnSync('bash', [join(root, 'scripts/deploy.sh'), '--dashboard-only', '--skip-smoke'], { env: { ...process.env, TRACE: trace }, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(await readFile(trace, 'utf8')).toContain('promote');
  });

  it('HK 同步失败时顶层发布非零且不静默成功', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-deploy-fail-'));
    await mkdir(join(root, 'scripts'));
    await cp(deployPath, join(root, 'scripts/deploy.sh'));
    await writeFile(join(root, 'scripts/rebuild-dashboard.sh'), '#!/bin/sh\nexit 0\n');
    await writeFile(join(root, 'scripts/promote-dashboard.sh'), '#!/bin/sh\necho "FAIL: HK rsync" >&2\nexit 23\n');
    await Promise.all(['deploy.sh', 'rebuild-dashboard.sh', 'promote-dashboard.sh'].map((name) => chmod(join(root, 'scripts', name), 0o755)));
    const result = spawnSync('bash', [join(root, 'scripts/deploy.sh'), '--dashboard-only', '--skip-smoke'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('HK');
    expect(result.stdout).not.toContain('=== Cecelia deployed ===');
  });
});
