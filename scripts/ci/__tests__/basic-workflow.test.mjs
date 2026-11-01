import assert from 'node:assert/strict';
import { readFileSync, readdirSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { planChecks } from '../basic-scope.mjs';
import { commandsFor } from '../run-basic-check.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));

test('所有启用工作流都能解析，新增文件也自动检查', () => {
  const directory = new URL('../../../.github/workflows/', import.meta.url);
  const files = readdirSync(directory).filter(name => /\.ya?ml$/.test(name));
  assert.ok(files.length > 0);
  for (const file of files) {
    const config = yaml.load(readFileSync(new URL(file, directory), 'utf8'));
    assert.ok(config?.on && config?.jobs && Object.keys(config.jobs).length, `${file}缺少触发器或实际任务`);
  }
});

test('每个声明的源码检查都必须抵达同一个最终结果，没有孤儿任务', () => {
  const reached = new Set();
  function visit(name) {
    assert.ok(workflow.jobs[name], `缺少任务：${name}`);
    if (reached.has(name)) return;
    reached.add(name);
    const needs = workflow.jobs[name].needs || [];
    for (const parent of Array.isArray(needs) ? needs : [needs]) visit(parent);
  }
  visit('ci-passed');
  assert.deepEqual([...reached].sort(), Object.keys(workflow.jobs).sort());
  assert.equal(workflow.jobs['ci-passed'].if, 'always()');
  assert.equal(workflow.jobs['ci-passed'].name, '源码保底通过');
  assert.equal(workflow.jobs.checks.strategy['fail-fast'], false);
});

test('实际workflow的最终命令严格传播失败、跳过和取消', () => {
  const step = workflow.jobs['ci-passed'].steps.find(step => step.env?.NEEDS_JSON);
  assert.equal(step.env.NEEDS_JSON, '${{ toJSON(needs) }}');
  for (const status of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, NEEDS_JSON: JSON.stringify({ plan: { result: 'success' }, security: { result: 'success' }, checks: { result: status } }) },
    });
    assert.equal(result.status === 0, status === 'success', result.stderr);
  }
});

test('每个现役矩阵项都能解析到非空真实命令', () => {
  for (const row of planChecks([], { full: true })) {
    const commands = commandsFor(row.component, row.shard);
    assert.ok(commands.length > 0, row.component);
    for (const command of commands) {
      assert.ok(command.command && command.args.length > 0);
      assert.ok(!command.args.includes('--passWithNoTests'));
    }
  }
});

test('最小源码CI只使用只读自动令牌，不依赖生产账号或私有Skills', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.doesNotMatch(JSON.stringify(workflow.jobs), /secrets\.|skills-source|GH_PAT_BOT|CECELIA_INTERNAL_TOKEN/);
});

test('只给实际PG跑道设置数据库URI，不能意外启用单测文件里的真实PG describe', () => {
  assert.equal(workflow.jobs.checks.env.DATABASE_URL,
    "${{ matrix.component == 'brain-integration' && 'postgresql://ci:isolated-ci@127.0.0.1:5432/cecelia_scratch' || '' }}");
});

test('来源准入接收全部main PR，中央live来源导出只保留显式调用', () => {
  const impact = yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml', import.meta.url), 'utf8'));
  assert.deepEqual(impact.on.pull_request.branches, ['main']);
  assert.equal(impact.on.push, undefined, 'main源码CI不得自动等待生产收集器或刷新中央定义');
  assert.deepEqual(Object.keys(impact.on).sort(), ['pull_request', 'workflow_call', 'workflow_dispatch']);
  assert.ok(impact.on.workflow_dispatch.inputs.source_baseline_recovery);
  assert.ok(impact.on.workflow_call.inputs.tooling_revision);
  for (const key of ['paths', 'paths-ignore', 'branches-ignore']) {
    assert.equal(impact.on.pull_request[key], undefined, `${key} 会令必需检查没有结果`);
  }
  assert.equal(impact.jobs.gate.name, 'Implementation impact gate');
  assert.ok(impact.jobs.gate.steps.length > 0, '保留实际来源准入执行');
});

test('来源准入先执行发布、跨仓、技能与巡查机制回归，不能仅保留脚本调用', () => {
  const impact = yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml', import.meta.url), 'utf8'));
  const steps = impact.jobs.gate.steps;
  const command = 'node --test scripts/ci/__tests__/implementation-main-snapshot.test.mjs scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs scripts/ci/__tests__/implementation-skill-source.test.mjs scripts/ci/__tests__/device-patrol-governance.test.mjs';
  const checks = steps.filter(step => step.run === command);
  assert.equal(checks.length, 1, '原有四份来源机制入口必须接入必需来源检查');
  const [step] = checks;
  assert.equal(step['working-directory'], 'source');
  assert.equal(step.if, "github.repository == 'perfectuser21/cecelia' && (!inputs.source_repo || inputs.source_repo == github.repository)");
  for (const key of ['continue-on-error', 'env', 'shell']) assert.equal(step[key], undefined, `${key}不能掩盖工具单测结果`);
  const dependencies = steps.findIndex(step => step.run === 'npm ci --ignore-scripts' && step['working-directory'] === 'source');
  const regression = steps.findIndex(step => step.run === 'node --test scripts/ci/__tests__/implementation-infra-joint.pg.test.mjs');
  assert.ok(dependencies >= 0 && dependencies < steps.indexOf(step));
  assert.ok(regression > steps.indexOf(step), '来源工具单测失败必须先阻止后续真实准入');
});


test('API PG跑道拥有临时Postgres服务和独立开关，普通unit不能启用它', () => {
  const job = workflow.jobs.checks;
  assert.equal(job.env.API_PG_INTEGRATION, "${{ matrix.component == 'api-integration' && '1' || '0' }}");
  assert.equal(job.services.postgres.image,
    "${{ (matrix.component == 'brain-integration' || matrix.component == 'api-integration') && 'mirror.gcr.io/pgvector/pgvector:pg15' || '' }}");
  assert.ok(planChecks(['apps/api/src/system/routes.ts']).some(row => row.component === 'api-integration'));
});

const versionEntry = '实际PR必须通过现仓库Brain版本策略';
const versionTestPath = 'scripts/ci/__tests__/basic-workflow.test.mjs';
function versionFixture(t, { version = '1.0.0', fragment = false } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'brain-version-entry-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'CI test', GIT_AUTHOR_EMAIL: 'ci@example.invalid',
    GIT_COMMITTER_NAME: 'CI test', GIT_COMMITTER_EMAIL: 'ci@example.invalid' };
  delete env.NODE_TEST_CONTEXT;
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'].includes(key)) delete env[key];
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args],
      { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const put = (path, bytes) => { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), bytes); };
  for (const path of [versionTestPath, 'scripts/ci/basic-scope.mjs', 'scripts/ci/run-basic-check.mjs',
    'scripts/ci/ops-checks.mjs', 'scripts/ci/check-brain-version-bump.sh', '.github/workflows/ci.yml']) {
    mkdirSync(dirname(join(directory, path)), { recursive: true }); copyFileSync(join(root, path), join(directory, path));
  }
  put('package.json', '{"type":"module"}');
  put('packages/brain/package.json', '{"version":"1.0.0"}');
  put('packages/brain/src/probe.js', '// base\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'cp-version-fixture');
  put('packages/brain/package.json', JSON.stringify({ version }));
  put('packages/brain/src/probe.js', '// actual source change\n');
  if (fragment) put('changes/fixture.md', '## Brain {VERSION} — fixture\n');
  git('add', '.'); git('commit', '-qm', 'source change');
  const head = git('rev-parse', 'HEAD');
  symlinkSync(require.resolve('js-yaml/package.json').replace(/\/js-yaml\/package\.json$/, ''), join(directory, 'node_modules'));
  const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
  const run = (body = event, overrides = {}) => {
    const eventPath = join(directory, 'event.json');
    writeFileSync(eventPath, typeof body === 'string' ? body : JSON.stringify(body));
    return spawnSync(process.execPath, ['--test', `--test-name-pattern=^${versionEntry}$`, versionTestPath], {
      cwd: directory, encoding: 'utf8', timeout: 20000,
      env: { ...env, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, ...overrides },
    });
  };
  return { directory, git, event, run };
}

for (const [version, fragment, accepted] of [['1.0.0', false, false], ['0.9.9', false, false],
  ['1.0.1', false, true], ['1.0.0', true, true]]) {
  test(`真实自动入口检查实际PR：version=${version},fragment=${fragment}`, t => {
    const result = versionFixture(t, { version, fragment }).run();
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(result.status === 0, accepted, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(versionEntry));
    assert.match(result.stdout, accepted ? /# pass 1\b/ : /版本未 bump/);
  });
}

test('真实PR入口拒绝坏event、缺失base对象与不属于checkout的head', t => {
  const f = versionFixture(t, { version: '1.0.1' });
  for (const body of ['{', {}, { pull_request: { base: { sha: '--help' }, head: f.event.pull_request.head } },
    { pull_request: { base: { sha: '0'.repeat(40) }, head: f.event.pull_request.head } },
    { pull_request: { base: f.event.pull_request.base, head: f.event.pull_request.base } }]) {
    const result = f.run(body);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /PR_VERSION_EVENT|PR_VERSION_GIT/);
  }
});

test('真实PR入口支持实际合并checkout，非PR明确不适用且不注册skip', t => {
  const f = versionFixture(t, { version: '1.0.1' });
  f.git('checkout', '-qb', 'merge-checkout', f.event.pull_request.base.sha);
  f.git('merge', '--no-ff', '-qm', 'test merge', f.event.pull_request.head.sha);
  const merged = f.run();
  assert.equal(merged.status, 0, merged.stdout + merged.stderr); assert.match(merged.stdout, /# pass 1\b/);
  for (const eventName of ['push', 'workflow_dispatch']) {
    const result = f.run({}, { GITHUB_EVENT_NAME: eventName });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /not_applicable: PR-only Brain version policy/);
    assert.match(result.stdout, /# pass 1\b/);
  }
});
