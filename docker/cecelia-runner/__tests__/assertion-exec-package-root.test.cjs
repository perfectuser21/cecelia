'use strict';
// 回归（第 14 类死法，2026-08-16 生产 run dc5c19b7 / 0eb9ac63）：
// runner 的 trusted assertion 执行器把 vitest 的 cwd 固定在仓库根，monorepo 根 vitest 配置的
// include 不含 packages/brain/src/**，于是 `npx vitest run packages/brain/src/.../x.test.js`
// 报 "No test files found, exiting with code 1" → required assertion 必败 → Judge 必 FAIL →
// fix 轮无限循环。执行器必须像 Brain 侧 gp-assertion-command.js 一样，以断言文件所在最近的
// package.json 目录为 cwd（该包自己的 vitest 配置生效）。
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, chmodSync, rmSync } = require('node:fs');
const { join, dirname } = require('node:path');
const os = require('node:os');
const assert = require('node:assert');

const here = __dirname;
const executor = join(here, '..', 'assertion-exec.mjs');
const repoNodeModules = realpathSync(join(here, '..', '..', '..', 'node_modules'));
const root = realpathSync(mkdtempSync(join(os.tmpdir(), 'assertion-exec-pkgroot-')));
try {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'mono-root', private: true }));
  writeFileSync(join(root, 'vitest.config.mjs'),
    "export default { test: { include: ['tests/**/*.test.js'] } };\n");
  const pkg = join(root, 'packages', 'app');
  mkdirSync(join(pkg, 'src'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'app', private: true }));
  writeFileSync(join(pkg, 'vitest.config.mjs'),
    "export default { test: { include: ['src/**/*.test.js'] } };\n");
  const testRel = 'packages/app/src/pkg-scoped.test.js';
  writeFileSync(join(root, testRel),
    "import { it, expect } from 'vitest';\nit('runs under the package vitest config', () => { expect(1).toBe(1); });\n");
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(join(repoNodeModules, 'vitest'), join(root, 'node_modules', 'vitest'));
  const tracked = join(root, '.tracked-paths');
  writeFileSync(tracked, `${testRel}\0`);
  chmodSync(tracked, 0o644);
  const assertion = {
    assertion_id: testRel,
    command: `npx vitest run ${testRel}`,
    journey_step_link_id: '00000000-0000-0000-0000-000000000000',
    assertion_revision: 1,
    assertion_digest: 'x',
  };
  const env = {
    HOME: root, PATH: process.env.PATH, LANG: 'C.UTF-8',
    CECELIA_TRUSTED_ASSERTION: '1',
    CECELIA_ASSERTION_TRACKED_PATHS_FILE: tracked,
  };
  const describe = spawnSync(process.execPath, [executor, '--describe', JSON.stringify(assertion)],
    { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(describe.status, 0, `describe failed: ${describe.stderr}`);
  assert.deepStrictEqual(JSON.parse(describe.stdout.trim()), ['npx', 'vitest', 'run', testRel]);

  const run = spawnSync(process.execPath, [executor, '--run', JSON.stringify(assertion)],
    { cwd: root, env, encoding: 'utf8', timeout: 180000 });
  const out = `${run.stdout}\n${run.stderr}`;
  assert.ok(!/No test files found/.test(out),
    `executor ran vitest from the monorepo root instead of the assertion's package root:\n${out.slice(-1500)}`);
  assert.strictEqual(run.status, 0, `package-scoped assertion should pass:\n${out.slice(-1500)}`);
  console.log('assertion-exec-package-root: PASS');
} finally {
  rmSync(root, { recursive: true, force: true });
}
