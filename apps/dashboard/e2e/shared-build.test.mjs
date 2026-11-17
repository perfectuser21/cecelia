import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 若消费方忽略共享目录或SHA，旧构建可悄悄通过验收；读取真实产物身份防止该回归。
test('两类浏览器验收消费指定的同一产物，并拒绝错误提交的构建', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-shared-build-'));
  try {
    writeFileSync(join(directory, 'build-info.json'), JSON.stringify({ git_sha: 'actual-ci-sha' }));
    writeFileSync(join(directory, 'index.html'), '<html>真实共享产物</html>');
    const helper = await import('./shared-build.mjs').catch(() => null);
    assert.ok(helper, '浏览器验收需要可执行的共享产物身份校验');
    const env = { DASHBOARD_E2E_DIST: directory, EXPECTED_BUILD_VERSION: 'actual-ci-sha' };
    for (const [outDir, version] of [['.dist-pwa-e2e', 'pwa-upgrade-e2e'], ['.dist-task-desk-e2e', 'task-desk-e2e']]) {
      assert.deepEqual(helper.dashboardBuild(outDir, version, env), { root: directory, version: 'actual-ci-sha' });
      assert.throws(() => helper.dashboardBuild(outDir, version, { ...env, EXPECTED_BUILD_VERSION: 'different-sha' }), /different-sha.*actual-ci-sha/);
    }
    rmSync(join(directory, 'index.html'));
    assert.throws(() => helper.dashboardBuild('.dist-pwa-e2e', 'pwa-upgrade-e2e', env), /index.html/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
