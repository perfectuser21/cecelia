import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import { planChecks } from '../../../scripts/ci/basic-scope.mjs';
import { checkResults } from '../../../scripts/ci/check-basic-results.mjs';
import { runSteps } from '../../../scripts/ci/run-basic-check.mjs';
const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('核心CI回归不依赖workspace路径，main全量并严格汇总所选检查', () => {
  expect(planChecks(['README.md'])).toContainEqual({component: 'scripts'});
  expect(planChecks([], {full: true})).toContainEqual({component: 'brain-integration'});
  const results = Object.fromEntries(['plan', 'security', 'checks'].map(name => [name, {result: 'success'}]));
  expect(() => checkResults(results)).not.toThrow();
  for (const name of Object.keys(results)) for (const result of ['failure', 'cancelled', 'skipped', ''])
    expect(() => checkResults({...results, [name]: {result}})).toThrow();
});

test('假绿灯空smoke不能替代真实检查，passed日志不能掩盖子进程失败', () => {
  expect(ci).not.toMatch(/golden-smoke\.test\.ts/);
  expect(() => runSteps([])).toThrow();
  expect(runSteps([{command: process.execPath, args: ['-e', 'console.log("Tests 1 passed"); process.exit(17)']}], {stdio: 'pipe'})).toBe(17);
});
