import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import test from 'node:test';
import brain from '../../../packages/brain/vitest.config.js';
import deep from '../deep-integration.config.mjs';
import realEnv from '../../../packages/brain/vitest.real-env-smoke.config.js';
import rootConfig from '../../../vitest.config.js';
import {skillSourceConfig} from '../skill-source-tests.mjs';
import {commandsFor} from '../run-basic-check.mjs';

const require = createRequire(import.meta.url);
const glob = require('fast-glob');
const yaml = require('js-yaml');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const brainRoot = join(root, 'packages/brain');
const categories = new Set(['isolated_fixture', 'external_resource', 'legacy_spec', 'unknown']);
const select = (config, cwd) => glob.sync(config.test.include, {
  cwd, absolute: true, ignore: ['**/node_modules/**', ...(config.test.exclude || [])],
}).map(file => relative(root, file));

function assertDebtMatches({maintained, selected, manualRoot, entries}) {
  assert.ok(maintained.length > 0, '维护测试集合不能为空');
  assert.ok(Array.isArray(entries));
  const existing = new Set(maintained), automatic = new Set(selected), manual = new Set(manualRoot), seen = new Set();
  for (const entry of entries) {
    assert.ok(entry && typeof entry.file === 'string', '债务记录缺少文件');
    assert.ok(!seen.has(entry.file), `重复债务：${entry.file}`);
    seen.add(entry.file);
    assert.ok(existing.has(entry.file), `文件不存在或不在维护集合：${entry.file}`);
    assert.ok(!automatic.has(entry.file), `已恢复自动接收：${entry.file}`);
    assert.ok(categories.has(entry.category), `未知分类：${entry.file}`);
    assert.ok(typeof entry.reason === 'string' && entry.reason.trim(), `缺少具体理由：${entry.file}`);
    assert.equal(entry.manualRoot, manual.has(entry.file), `root手动配置记录漂移：${entry.file}`);
  }
  const missing = maintained.filter(file => !automatic.has(file) && !seen.has(file));
  assert.deepEqual(missing.sort(), [], `未登记的测试债务：${missing.join(', ')}`);
}

function fixtureSelection(directory) {
  const maintained = glob.sync('src/**/*.test.js', {cwd: directory});
  return {maintained, selected: ['src/active.test.js'], manualRoot: []};
}

test('新遗漏测试必须失败；有root手动配置也不能冒充自动覆盖', () => {
  const directory = mkdtempSync(join(tmpdir(), 'brain-debt-guard-'));
  try {
    mkdirSync(join(directory, 'src'));
    for (const file of ['active', 'debt']) writeFileSync(join(directory, `src/${file}.test.js`), '');
    const entries = [{file: 'src/debt.test.js', category: 'isolated_fixture', reason: '查询假件待更新', manualRoot: false}];
    assertDebtMatches({...fixtureSelection(directory), entries});
    writeFileSync(join(directory, 'src/new-excluded.test.js'), '');
    assert.throws(() => assertDebtMatches({...fixtureSelection(directory), manualRoot: ['src/new-excluded.test.js'], entries}), /未登记/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('重复、不存在、已恢复和空理由均不得留在债务清单', () => {
  const entry = {file: 'src/debt.test.js', category: 'isolated_fixture', reason: '查询假件待更新', manualRoot: false};
  const fixture = {maintained: ['src/active.test.js', 'src/debt.test.js'], selected: ['src/active.test.js'], manualRoot: []};
  assert.throws(() => assertDebtMatches({...fixture, entries: [entry, entry]}), /重复/);
  assert.throws(() => assertDebtMatches({...fixture, entries: [{...entry, file: 'src/deleted.test.js'}]}), /不存在/);
  assert.throws(() => assertDebtMatches({...fixture, selected: fixture.maintained, entries: [entry]}), /已恢复/);
  assert.throws(() => assertDebtMatches({...fixture, entries: [{...entry, reason: ''}]}), /理由/);
  assert.throws(() => assertDebtMatches({...fixture, entries: [{...entry, manualRoot: true}]}), /手动配置/);
  assert.throws(() => assertDebtMatches({...fixture, entries: [{...entry, category: 'discard'}]}), /分类/);
});

function workflowRuns(workflow, expression) {
  return Object.values(workflow.jobs).some(job => !job.if && job.steps?.some(step =>
    !step.if && step.run?.split('\n').map(line => line.trim()).filter(line => !line.startsWith('#')).some(line => expression.test(line))));
}

test('当前无人自动接收的Brain测试与精确债务清单一致', () => {
  const basic = yaml.load(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'));
  const nightly = yaml.load(readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8'));
  const pinned = yaml.load(readFileSync(join(root, '.github/workflows/skills-source-check.yml'), 'utf8'));
  const selected = [];
  // 只把真实CI入口接入的配置算作自动接收，独立但无人调用的config不算。
  if (workflowRuns(basic, /^node scripts\/ci\/run-basic-check\.mjs/) && commandsFor('brain-unit', '1').some(command =>
    command.command === 'npx' && command.args.includes('vitest') && command.args.includes('run'))) {
    selected.push(...select(brain, brainRoot));
  }
  if (nightly.on?.schedule?.length && workflowRuns(nightly, /^(?:cd packages\/brain && )?npx(?: --no-install)? vitest run .*--config \.\.\/\.\.\/scripts\/ci\/deep-integration\.config\.mjs/)) {
    selected.push(...select(deep, brainRoot));
  }
  if (nightly.on?.schedule?.length && workflowRuns(nightly, /^npx(?: --no-install)? vitest run .*--config vitest\.real-env-smoke\.config\.js/)) {
    selected.push(...select(realEnv, brainRoot));
  }
  const contracts = pinned.jobs.contracts;
  if (pinned.on?.pull_request && !contracts.if && contracts.steps.some(step => !step.if && /^node scripts\/ci\/run-skill-source-check\.mjs/m.test(step.run || ''))) {
    for (const [component, cwd] of [['brain', brainRoot], ['root', root]]) {
      if (contracts.strategy.matrix.component.includes(component)) selected.push(...select(skillSourceConfig(component), cwd));
    }
  }
  const manifest = require('../brain-test-debt.json');
  assert.equal(manifest.version, 1);
  assertDebtMatches({maintained: select({...brain, test: {...brain.test, exclude: []}}, brainRoot), selected,
    manualRoot: select(rootConfig, root), entries: manifest.tests});
});
