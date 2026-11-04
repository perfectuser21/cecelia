import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {collectBasicCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';

// 旧完整输入来自已经合并的main；本轮只替换真实scope正文，不执行候选配置。
const baseline = readFixedExistingOpsGitFixture('2f4c9cbb9fbed1d36e4f3407bdf0ab1b72ece968');
const scope = 'scripts/ci/basic-scope.mjs';
const current = readFileSync(new URL('../../../../../' + scope, import.meta.url), 'utf8');
const regression = 'scripts/ci/__tests__/basic-runtime-consumer-scope.test.mjs';
const collect = async (overrides = {}) => {
  const read = async path => Object.hasOwn(overrides, path) ? overrides[path]
    : path === regression ? readFileSync(new URL('../../../../../' + path, import.meta.url), 'utf8') : baseline.read(path);
  const relations = [];
  await collectBasicCiSources({read, ci: await read('.github/workflows/ci.yml'),
    revision: baseline.revision, relations, parse: text => parse(text, {ecmaVersion: 'latest', sourceType: 'module'}),
    paths: [...baseline.paths, regression]});
  return relations;
};

it('已合main旧完整cohort保持可读', async () => {
  expect(await collect()).toContainEqual(expect.objectContaining({input_path: scope, kind: 'required_basic_ci_plan'}));
});

it('当前完整cohort保留真实选路及默认scripts回归来源边', async () => {
  expect(current).not.toBe(baseline.read(scope));
  const edges = await collect({[scope]: current});
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
  it('完整cohort成员漂移拒绝：' + path, async () => {
    const original = path === scope ? current : baseline.read(path);
    await expect(collect({[scope]: current, [path]: original + '\n// 未审字节\n'}))
      .rejects.toThrow('basic_ci_source_unproven');
  });
}

it('新scope不能与旧身份workflow混配', async () => {
  const old = readFixedExistingOpsGitFixture('53714060cd53adb9b1247c05bde23e7667cd8fb4');
  const path = '.github/workflows/skills-source-check.yml';
  expect(old.read(path)).not.toBe(baseline.read(path));
  await expect(collect({[scope]: current, [path]: old.read(path)}))
    .rejects.toThrow('basic_ci_source_unproven');
});
