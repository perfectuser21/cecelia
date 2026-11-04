import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {collectBasicCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';

const baseline = readFixedExistingOpsGitFixture('2f4c9cbb9fbed1d36e4f3407bdf0ab1b72ece968');
const ciPath = '.github/workflows/ci.yml';
const scope = 'scripts/ci/basic-scope.mjs';
const regression = 'scripts/ci/__tests__/basic-concurrency.test.mjs';
const actual = path => readFileSync(new URL('../../../../../' + path, import.meta.url), 'utf8');
const currentCi = actual(ciPath);
const currentScope = readFixedExistingOpsGitFixture('289ddd8d0690f154006c5586926277c48e10f716').read(scope);
const collect = async (overrides = {}) => {
  const read = async path => Object.hasOwn(overrides, path) ? overrides[path]
    : path === ciPath ? currentCi : path === scope ? currentScope
      : path === regression ? actual(path) : baseline.read(path);
  const relations = [];
  await collectBasicCiSources({read, ci: await read(ciPath), revision: baseline.revision, relations,
    parse: text => parse(text, {ecmaVersion: 'latest', sourceType: 'module'}), paths: [...baseline.paths, regression]});
  return relations;
};

it('原已合main完整CI和scope来源仍可回放', async () => {
  expect(await collect({[ciPath]: baseline.read(ciPath), [scope]: baseline.read(scope)}))
    .toContainEqual(expect.objectContaining({input_path: scope, kind: 'required_basic_ci_plan'}));
});
it('新并发workflow必须绑定完整runtime scope，并记录官方引擎回归真实来源边', async () => {
  const edges = await collect();
  expect(edges).toContainEqual(expect.objectContaining({input_path: scope, kind: 'required_basic_ci_plan'}));
  expect(edges).toContainEqual(expect.objectContaining({consumer_path: 'scripts/ci/run-basic-check.mjs',
    input_path: regression, kind: 'reviewed_scripts_node_test_selector'}));
});
for (const path of [scope, 'packages/brain/vitest.config.js', 'scripts/ci/run-basic-check.mjs',
  'scripts/ci/check-basic-results.mjs', 'scripts/ci/basic-runtime-smoke.mjs', 'scripts/ci/ops-checks.mjs',
  'scripts/ci/run-isolated-staging-smoke.mjs', 'scripts/ci/skill-source-tests.mjs', 'apps/api/vitest.config.ts',
  'apps/api/vitest.integration.config.ts', 'scripts/ci/__tests__/basic-skill-source-coverage.test.mjs',
  '.github/workflows/skills-source-check.yml', 'scripts/ci/check-brain-version-bump.sh',
  '.github/actions/skills-source/action.yml', 'scripts/ci/check-skill-source-identity.py',
  'scripts/ci/__tests__/basic-skill-identity.test.mjs']) {
  it('并发workflow完整cohort任一成员漂移拒绝：' + path, async () => {
    const text = path === scope ? currentScope : baseline.read(path);
    await expect(collect({[path]: text + '\n// 未审字节\n'})).rejects.toThrow('basic_ci_source_unproven');
  });
}
it('新workflow不能与旧scope单成员混配', async () => {
  expect(currentScope).not.toBe(baseline.read(scope));
  await expect(collect({[scope]: baseline.read(scope)})).rejects.toThrow('basic_ci_source_unproven');
});
