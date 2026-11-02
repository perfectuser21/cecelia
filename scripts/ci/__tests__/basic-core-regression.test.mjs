import { readFileSync } from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import { planChecks } from '../basic-scope.mjs';
import { checkResults } from '../check-basic-results.mjs';
import { runSteps } from '../run-basic-check.mjs';
const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('核心CI回归不依赖workspace路径，main全量并严格汇总所选检查', () => {
  assert.ok(planChecks(['README.md']).some(row => row.component === 'scripts'));
  assert.ok(planChecks([], {full: true}).some(row => row.component === 'brain-integration'));
  const results = Object.fromEntries(['plan', 'security', 'checks'].map(name => [name, {result: 'success'}]));
  assert.doesNotThrow(() => checkResults(results));
  for (const name of Object.keys(results)) for (const result of ['failure', 'cancelled', 'skipped', ''])
    assert.throws(() => checkResults({...results, [name]: {result}}));
});

test('假绿灯空smoke不能替代真实检查，passed日志不能掩盖子进程失败', () => {
  assert.doesNotMatch(ci, /golden-smoke\.test\.ts/);
  assert.throws(() => runSteps([]));
  assert.equal(runSteps([{command: process.execPath, args: ['-e', 'console.log("Tests 1 passed"); process.exit(17)']}], {stdio: 'pipe'}),17);
});
