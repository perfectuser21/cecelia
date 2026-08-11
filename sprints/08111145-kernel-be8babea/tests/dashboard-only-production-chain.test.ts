import { afterEach, describe, expect, it } from 'vitest';
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const sourceDeploy = new URL('../../../scripts/deploy.sh', import.meta.url).pathname;
const roots: string[] = [];

async function fixture(promoteExit: number) {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-mainline-'));
  roots.push(root);
  const scripts = join(root, 'scripts');
  await cp(new URL('../../../scripts', import.meta.url).pathname, scripts, { recursive: true });
  await writeFile(join(scripts, 'rebuild-dashboard.sh'), '#!/usr/bin/env bash\necho rebuild >> "$TRACE"\n');
  await writeFile(join(scripts, 'promote-dashboard.sh'), `#!/usr/bin/env bash\necho promote >> "$TRACE"\necho "fixture promote exit ${promoteExit}"\nexit ${promoteExit}\n`);
  await chmod(join(scripts, 'rebuild-dashboard.sh'), 0o755);
  await chmod(join(scripts, 'promote-dashboard.sh'), 0o755);
  const trace = join(root, 'trace.log');
  const result = spawnSync('bash', [join(scripts, 'deploy.sh'), '--dashboard-only', '--skip-smoke'], {
    cwd: root,
    env: { ...process.env, TRACE: trace },
    encoding: 'utf8',
    timeout: 10_000,
  });
  const calls = await readFile(trace, 'utf8').catch(() => '');
  return { result, calls };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Dashboard-only 官方生产发布主链', () => {
  it('Dashboard-only 成功路径必须调用既有双节点 promote 主链', async () => {
    expect(sourceDeploy).toContain('/scripts/deploy.sh');
    const { result, calls } = await fixture(0);
    expect(result.status).toBe(0);
    expect(calls.trim().split('\n')).toEqual(['rebuild', 'promote']);
  });

  it('HK 同步或终验失败必须让 Dashboard-only 发布非零退出', async () => {
    const { result, calls } = await fixture(23);
    expect(calls).toContain('promote');
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('fixture promote exit 23');
  });
});

