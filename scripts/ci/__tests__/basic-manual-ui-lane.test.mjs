import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const root = fileURLToPath(new URL('../../../', import.meta.url));
test('休眠页面退出默认跑道，浏览器合同仍保留显式Playwright入口', () => {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.jobs['pwa-upgrade'], undefined);
  const config=readFileSync(new URL('../../../tests/regression/manual-ui/playwright.config.ts',import.meta.url),'utf8');
  for(const name of ['cockpit-route-wire/e2e-verify.spec.ts','relay-07b2fd3b/inbox-e2e.spec.ts','capture-destination-link/capture-destination-link.spec.ts'])assert.ok(config.includes(name));
});
test('真实Playwright收集三文件四条页面回归，不以源码断言替代浏览器用例', () => {
  const result = spawnSync(process.execPath, ['apps/dashboard/e2e/playwright-cli.mjs', 'test', '--config', 'tests/regression/manual-ui/playwright.config.ts', '--list'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Total: 4 tests in 3 files/);
});
