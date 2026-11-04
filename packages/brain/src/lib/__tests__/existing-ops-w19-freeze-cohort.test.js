import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'acorn';
import { collectBasicCiSources } from '../existing-ops-stage-source.js';
import { readFixedExistingOpsGitFixture } from './helpers/fixed-existing-ops-git-fixture.js';

const baseline = readFixedExistingOpsGitFixture('289ddd8d0690f154006c5586926277c48e10f716');
const root = new URL('../../../../../', import.meta.url);
const checker = 'scripts/ci/check-w19-frozen.mjs';
const regression = 'scripts/ci/__tests__/basic-w19-freeze.test.mjs';
const actual = path => readFileSync(new URL(path, root), 'utf8');
const members = ['packages/brain/vitest.config.js', 'scripts/ci/basic-scope.mjs',
  'scripts/ci/run-basic-check.mjs', 'scripts/ci/check-basic-results.mjs', 'scripts/ci/basic-runtime-smoke.mjs',
  'scripts/ci/ops-checks.mjs', 'scripts/ci/run-isolated-staging-smoke.mjs', 'scripts/ci/skill-source-tests.mjs',
  'apps/api/vitest.config.ts', 'apps/api/vitest.integration.config.ts',
  'scripts/ci/__tests__/basic-skill-source-coverage.test.mjs', '.github/workflows/skills-source-check.yml',
  'scripts/ci/check-brain-version-bump.sh', '.github/actions/skills-source/action.yml',
  'scripts/ci/check-skill-source-identity.py', 'scripts/ci/__tests__/basic-skill-identity.test.mjs', checker, regression,
  'playground/package.json', 'playground/package-lock.json', 'playground/server.js', 'playground/vitest.config.js',
  'playground/tests/echo.test.js', 'playground/tests/kernel-e.test.js', 'playground/tests/ping.test.js',
  'playground/tests/server.test.js'];
const paths = [...new Set([...execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean), checker, regression])];
const collect = async (overrides = {}, selected = paths) => {
  const read = async path => Object.hasOwn(overrides, path) ? overrides[path] : actual(path);
  const relations = [];
  await collectBasicCiSources({ read, ci: await read('.github/workflows/ci.yml'), revision: 'current', relations,
    parse: text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), paths: selected });
  return relations;
};

it('固定已合main完整旧组合仍可回放，不伪装为已执行新冻结门', async () => {
  const edges = [];
  await collectBasicCiSources({ read: async path => baseline.read(path),
    ci: baseline.read('.github/workflows/ci.yml'), revision: baseline.revision, relations: edges,
    parse: text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), paths: baseline.paths });
  expect(edges.some(edge => edge.input_path === checker)).toBe(false);
});
it('当前完整新组认领真实冻结门与历史输入，不声明旧算术回归', async () => {
  const edges = await collect();
  expect(edges).toContainEqual(expect.objectContaining({ input_path: checker, kind: 'historical_w19_freeze_guard' }));
  expect(edges).toContainEqual(expect.objectContaining({ consumer_path: checker,
    input_path: 'playground/server.js', kind: 'frozen_historical_w19_input' }));
});
for (const path of members) {
  it('完整新组单成员未知字节拒绝：' + path, async () => {
    await expect(collect({ [path]: actual(path) + '\n// unreviewed drift\n' }))
      .rejects.toThrow('basic_ci_source_unproven');
  });
}
for (const path of ['scripts/ci/basic-scope.mjs', 'scripts/ci/run-basic-check.mjs']) {
  it('新组不能混配单个旧执行成员：' + path, async () => {
    await expect(collect({ [path]: baseline.read(path) })).rejects.toThrow('basic_ci_source_unproven');
  });
}
it('缺真实冻结门路径不能只凭内存read获得当前资格', async () => {
  await expect(collect({}, paths.filter(path => path !== checker))).rejects.toThrow('basic_ci_source_unproven');
});
