import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {relative, join} from 'node:path';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import config from '../../../packages/brain/vitest.config.js';
const require = createRequire(import.meta.url), glob = require('fast-glob');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const restored = [
  "packages/brain/src/__tests__/resolve-repo-path.test.js",
  "packages/brain/src/__tests__/task-generator-scheduler.test.js",
  "packages/brain/src/__tests__/daily-review-scheduler.test.js",
  "tests/capability-probe-rumination.test.js",
  "packages/brain/src/__tests__/tasks-feedback.test.js",
  "packages/brain/src/__tests__/tick-codex-immune.test.js",
  "packages/brain/src/__tests__/startup-sync.test.js",
  "packages/brain/src/__tests__/model-registry.test.js",
  "packages/brain/src/__tests__/dept-heartbeat.test.js",
  "packages/brain/src/__tests__/services/memory-service.test.js",
  "packages/brain/src/__tests__/code-review-trigger.test.js",
  "packages/brain/src/__tests__/executor-retry-strategy.test.js",
  "packages/brain/src/__tests__/content-type-registry.test.js",
  "packages/brain/src/__tests__/debt-04-planner-score.test.js",
  "packages/brain/src/__tests__/debt-04-scratch-guard.test.js"
];
test('修复后的默认单测与新评分/隔离守卫必须进入默认Brain集合且解除债务', () => {
  const selected = glob.sync(config.test.include, {cwd: join(root, 'packages/brain'), absolute: true,
    ignore: ['**/node_modules/**', ...config.test.exclude]}).map(file => relative(root, file));
  const debt = JSON.parse(readFileSync(join(root, 'scripts/ci/brain-test-debt.json'))).tests;
  for (const file of restored) {
    assert.equal(selected.filter(path => path === file).length, 1, `默认单测必须恰好收集一次：${file}`);
    assert.ok(!debt.some(entry => entry.file === file), `已恢复单测不得留作未解决债务：${file}`);
  }
});
