import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const paths = ['tests/regression/manual-ui/**', 'tests/regression/cockpit-route-wire/**', 'tests/regression/relay-07b2fd3b/**', 'tests/regression/capture-destination-link/**'];
test('三份现役页面合同在PR及main变更时进入既有PWA job', () => {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci-dashboard-pwa-e2e.yml', import.meta.url), 'utf8'));
  for (const event of ['pull_request', 'push']) for (const path of paths) assert.ok(workflow.on[event].paths.includes(path), `${event}: ${path}`);
  assert.deepEqual(Object.keys(workflow.jobs), ['pwa-upgrade']);
  const step = workflow.jobs['pwa-upgrade'].steps.find(step => step.name === 'Verify current cockpit inbox and destination routes');
  assert.ok(step?.run.includes('vite build --outDir .dist-pwa-e2e'));
  assert.ok(step.run.includes('node e2e/playwright-cli.mjs test --config ../../tests/regression/manual-ui/playwright.config.ts'));
});
test('真实Playwright收集三文件五条页面回归，不以源码断言替代浏览器用例', () => {
  const result = spawnSync(process.execPath, ['apps/dashboard/e2e/playwright-cli.mjs', 'test', '--config', 'tests/regression/manual-ui/playwright.config.ts', '--list'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Total: 5 tests in 3 files/);
});
