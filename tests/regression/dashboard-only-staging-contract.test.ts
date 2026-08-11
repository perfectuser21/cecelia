import { afterEach, describe, expect, it } from 'vitest';
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];

async function stagingContractFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-staging-contract-'));
  roots.push(root);
  const scripts = join(root, 'scripts');
  const dashboard = join(root, 'apps/dashboard');
  await cp(new URL('../../scripts', import.meta.url).pathname, scripts, { recursive: true });
  await writeFile(join(scripts, 'rebuild-dashboard.sh'), `#!/usr/bin/env bash
echo rebuild >> "$TRACE"
if [[ "\${1:-}" == '--staging' ]]; then
  bash "$(dirname "$0")/deploy-local.sh"
fi
`);
  await writeFile(join(scripts, 'deploy-local.sh'), `#!/usr/bin/env bash
mkdir -p "${dashboard}/.dist-staging"
printf 'staging_dist=%s\\ncommit=test-sha\\n' "${dashboard}/.dist-staging" > "${dashboard}/.staging-pending"
echo stage >> "$TRACE"
`);
  await writeFile(join(scripts, 'promote-dashboard.sh'), `#!/usr/bin/env bash
echo promote >> "$TRACE"
test -f "${dashboard}/.staging-pending" || {
  echo 'missing .staging-pending' >&2
  exit 42
}
`);
  await Promise.all([
    'rebuild-dashboard.sh',
    'deploy-local.sh',
    'promote-dashboard.sh',
  ].map((name) => chmod(join(scripts, name), 0o755)));
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

async function dashboardOnlyIsolationFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-only-isolation-'));
  roots.push(root);
  const scripts = join(root, 'scripts');
  await cp(new URL('../../scripts', import.meta.url).pathname, scripts, { recursive: true });
  return spawnSync('bash', [
    join(scripts, 'deploy-local.sh'),
    '--dry-run',
    '--dashboard-only',
    '--changed=packages/brain/src/server.js apps/dashboard/src/App.tsx',
  ], {
    cwd: root,
    env: { ...process.env, CECELIA_DEPLOY_ROOT: root },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Dashboard-only staging/promote 合同', () => {
  it('必须先生成 staging 放行标记再调用双节点 promote', async () => {
    const { result, calls } = await stagingContractFixture();
    expect(result.status).toBe(0);
    expect(calls.trim().split('\n')).toEqual(['rebuild', 'stage', 'promote']);
  });

  it('staging 构建不得连带部署 Brain', async () => {
    const result = await dashboardOnlyIsolationFixture();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Dashboard 改动');
    expect(result.stdout).not.toContain('brain-deploy.sh');
  });
});
