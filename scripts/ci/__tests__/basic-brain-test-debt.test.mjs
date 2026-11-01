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
import {planChecks} from '../basic-scope.mjs';
import {isDeepStrictEqual} from 'node:util';

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

// 维护归属是独立契约，不随被测include收窄或负模式一起消失。
const maintainedPatterns = [
  'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  'scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  'tests/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../../tests/packages/brain/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../../tests/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../../tests/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../../tests/brain/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../../tests/alertness/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../../tests/regression/**/*.{test,spec}.?(c|m)[jt]s?(x)',
  '../../tests/gp/**/*.{test,spec}.?(c|m)[jt]s?(x)',
];
function configurationInventory(config, cwd = brainRoot) {
  return {maintained: select({test: {include: maintainedPatterns}}, cwd), selected: select(config, cwd)};
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

for (const [name, include] of [
  ['include收窄', ['src/__tests__/active.test.js']],
  ['include负模式', ['src/**/*.test.js', '!src/__tests__/quota-exhausted.test.js']],
]) {
  test(`维护分母独立于${name}，额度保护测试消失必须登记`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'brain-debt-include-'));
    const cwd = join(directory, 'packages/brain');
    try {
      mkdirSync(join(cwd, 'src/__tests__'), {recursive: true});
      for (const file of ['active', 'quota-exhausted']) writeFileSync(join(cwd, `src/__tests__/${file}.test.js`), '');
      const config = {...brain, test: {...brain.test, include, exclude: []}};
      assert.throws(() => assertDebtMatches({...configurationInventory(config, cwd), manualRoot: [], entries: []}), /未登记/);
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });
}

function loadWorkflows() {
  return Object.fromEntries([['basic', 'ci.yml'], ['nightly', 'nightly-regression.yml'], ['pinned', 'skills-source-check.yml']]
    .map(([name, file]) => [name, yaml.load(readFileSync(join(root, '.github/workflows', file), 'utf8'))]));
}

function mainEvents(workflow) {
  const main = {branches: ['main']};
  return isDeepStrictEqual(workflow.on?.pull_request, main) && isDeepStrictEqual(workflow.on?.push, main);
}

// 只接受当前已审核的完整shell形状；不是通用shell解释器，也不扫描注释、heredoc或死分支。
function knownStep(workflow, jobId, expected) {
  const job = workflow.jobs?.[jobId];
  if (!job || Object.hasOwn(job, 'if') || job['runs-on'] !== 'ubuntu-latest') return false;
  return job.steps?.some(step => {
    if (Object.hasOwn(step, 'if') || step.uses || typeof step.run !== 'string') return false;
    const cwd = step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? workflow.defaults?.run?.['working-directory'] ?? '.';
    const shell = step.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell;
    const env = {...workflow.env, ...job.env, ...step.env};
    return cwd === '.' && (shell === undefined || shell === 'bash') && step.run.trim() === expected.run
      && (expected.id === undefined || step.id === expected.id)
      && Object.entries(expected.env || {}).every(([key, value]) => env[key] === value);
  });
}

const scopeRun = [
  'if [ "$EVENT_NAME" = pull_request ]; then',
  '  node scripts/ci/basic-scope.mjs --base "$BASE_SHA" --head "$HEAD_SHA"',
  'elif [ "$EVENT_NAME" = push ]; then',
  '  node scripts/ci/basic-scope.mjs --full --base "$BASE_SHA" --head "$HEAD_SHA"',
  'else',
  '  node scripts/ci/basic-scope.mjs --full --head "$HEAD_SHA"',
  'fi',
].join('\n');

function automaticLanes({basic, nightly, pinned}) {
  const lanes = [], checks = basic.jobs?.checks;
  const shards = planChecks(['packages/brain/src/server.js']).filter(row => row.component === 'brain-unit').map(row => row.shard);
  const unitCommands = isDeepStrictEqual(shards, [1, 2, 3, 4, 5, 6]) && shards.every(shard => commandsFor('brain-unit', String(shard)).some(command =>
    command.cwd === brainRoot && command.command === 'npx' && isDeepStrictEqual(command.args,
      ['--no-install', 'vitest', 'run', `--shard=${shard}/6`, '--reporter=dot', '--silent'])));
  const plan = basic.jobs?.plan;
  const hasPlan = plan?.outputs?.matrix === '${{ steps.scope.outputs.matrix }}' && knownStep(basic, 'plan', {
    id: 'scope', run: scopeRun, env: {EVENT_NAME: '${{ github.event_name }}',
      BASE_SHA: '${{ github.event.pull_request.base.sha || github.event.before }}', HEAD_SHA: '${{ github.sha }}'},
  });
  if (mainEvents(basic) && hasPlan && unitCommands && checks?.needs === 'plan'
    && checks.strategy?.matrix === '${{ fromJSON(needs.plan.outputs.matrix) }}'
    && knownStep(basic, 'checks', {run: 'node scripts/ci/run-basic-check.mjs "$COMPONENT" "$SHARD"',
      env: {COMPONENT: '${{ matrix.component }}', SHARD: '${{ matrix.shard }}', CI: 'true'}})) lanes.push('default');

  const scheduled = isDeepStrictEqual(nightly.on?.schedule, [{cron: '0 19 * * *'}]);
  const pgEnv = {CI: 'true', POSTGRES_INTEGRATION: '1', DB_NAME: 'cecelia_test'};
  if (scheduled && knownStep(nightly, 'brain-integration', {
    run: 'cd packages/brain && npx --no-install vitest run --config ../../scripts/ci/deep-integration.config.mjs --reporter=dot',
    env: pgEnv,
  })) lanes.push('deep');
  if (scheduled && knownStep(nightly, 'real-env-smoke', {
    run: 'cd packages/brain\nnpx vitest run --config vitest.real-env-smoke.config.js',
    env: {...pgEnv, SMOKE_ALLOW_WRITE: '1', BRAIN_URL: 'http://localhost:5221', BRAIN_CONTAINER: 'cecelia-brain-smoke'},
  })) lanes.push('real-env');

  const contracts = pinned.jobs?.contracts;
  if (mainEvents(pinned) && isDeepStrictEqual(contracts?.strategy?.matrix, {component: ['brain', 'engine', 'quality', 'root']})
    && knownStep(pinned, 'contracts', {run: 'node scripts/ci/run-skill-source-check.mjs "$COMPONENT"',
      env: {COMPONENT: '${{ matrix.component }}', CI: 'true', POSTGRES_INTEGRATION: '0'}})) lanes.push('pinned-brain', 'pinned-root');
  return lanes;
}

for (const [name, change] of [
  ['manual-only加--list', workflow => {
    workflow.on = {workflow_dispatch: {}};
    workflow.jobs.checks.steps.find(step => step.run?.includes('run-basic-check.mjs')).run += ' --list';
  }],
  ['if false包裹命令', workflow => {
    const step = workflow.jobs.checks.steps.find(step => step.run?.includes('run-basic-check.mjs'));
    step.run = `if false; then\n${step.run}\nfi`;
  }],
  ['heredoc只打印命令', workflow => {
    const step = workflow.jobs.checks.steps.find(step => step.run?.includes('run-basic-check.mjs'));
    step.run = `cat <<'PRINTED'\n${step.run}\nPRINTED`;
  }],
  ['正常命令但仅workflow_dispatch', workflow => { workflow.on = {workflow_dispatch: {}}; }],
]) {
  test(`default自动接入拒绝${name}`, () => {
    const workflows = loadWorkflows();
    change(workflows.basic);
    assert.ok(!automaticLanes(workflows).includes('default'));
  });
}

for (const [name, change] of [
  ['只有scripts的矩阵', workflow => { workflow.jobs.checks.strategy.matrix = {include: [{component: 'scripts'}]}; }],
  ['只有一片的矩阵', workflow => { workflow.jobs.checks.strategy.matrix = {include: [{component: 'brain-unit', shard: 1}]}; }],
  ['脱离plan的矩阵输出', workflow => { workflow.jobs.plan.outputs.matrix = '{"include":[{"component":"scripts"}]}'; }],
  ['plan不可达分支', workflow => {
    const step = workflow.jobs.plan.steps.find(value => value.id === 'scope');
    step.run = `if false; then\n${step.run}\nfi`;
  }],
  ['错误component', workflow => { workflow.jobs.checks.steps.find(step => step.run?.includes('run-basic-check.mjs')).env.COMPONENT = 'scripts'; }],
  ['错误shard', workflow => { workflow.jobs.checks.steps.find(step => step.run?.includes('run-basic-check.mjs')).env.SHARD = '1'; }],
  ['错误工作目录', workflow => { workflow.jobs.checks.defaults = {run: {'working-directory': 'packages/brain'}}; }],
  ['条件false', workflow => { workflow.jobs.checks.if = false; }],
]) {
  test(`default自动接入拒绝${name}`, () => {
    const workflows = loadWorkflows();
    change(workflows.basic);
    assert.ok(!automaticLanes(workflows).includes('default'));
  });
}

for (const [lane, workflowName, jobName, marker] of [
  ['deep', 'nightly', 'brain-integration', 'deep-integration.config.mjs'],
  ['real-env', 'nightly', 'real-env-smoke', 'vitest.real-env-smoke.config.js'],
  ['pinned', 'pinned', 'contracts', 'run-skill-source-check.mjs'],
]) {
  for (const mutation of ['--list', 'if false', 'heredoc', '错误cwd', '错误env', 'job-if-false', 'step-if-false', '打印shell', '仅手动']) {
    test(`${lane}自动接入拒绝${mutation}`, () => {
      const workflows = loadWorkflows(), workflow = workflows[workflowName], job = workflow.jobs[jobName];
      const step = job.steps.find(value => value.run?.includes(marker));
      if (mutation === '--list') step.run += ' --list';
      if (mutation === 'if false') step.run = `if false; then\n${step.run}\nfi`;
      if (mutation === 'heredoc') step.run = `cat <<'PRINTED'\n${step.run}\nPRINTED`;
      if (mutation === '错误cwd') workflow.defaults = {run: {'working-directory': '/tmp'}};
      if (mutation === '错误env') {
        if (lane === 'pinned') step.env.COMPONENT = 'brain';
        else job.env.POSTGRES_INTEGRATION = '0';
      }
      if (mutation === 'job-if-false') job.if = false;
      if (mutation === 'step-if-false') step.if = false;
      if (mutation === '打印shell') step.shell = 'cat {0}';
      if (mutation === '仅手动') workflow.on = {workflow_dispatch: {}};
      assert.ok(!automaticLanes(workflows).some(value => value === lane || (lane === 'pinned' && value.startsWith('pinned-'))));
    });
  }
}

test('当前无人自动接收的Brain测试与精确债务清单一致', () => {
  const configurations = {default: [brain, brainRoot], deep: [deep, brainRoot], 'real-env': [realEnv, brainRoot],
    'pinned-brain': [skillSourceConfig('brain'), brainRoot], 'pinned-root': [skillSourceConfig('root'), root]};
  const lanes = automaticLanes(loadWorkflows());
  assert.deepEqual(lanes, ['default', 'deep', 'real-env', 'pinned-brain', 'pinned-root']);
  const selected = lanes.flatMap(lane => select(...configurations[lane]));
  const manifest = require('../brain-test-debt.json');
  assert.equal(manifest.version, 1);
  assertDebtMatches({maintained: configurationInventory(brain).maintained, selected,
    manualRoot: select(rootConfig, root), entries: manifest.tests});
});
