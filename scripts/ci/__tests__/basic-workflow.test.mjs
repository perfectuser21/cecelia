import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

test('来源准入的路径过滤必须覆盖当前真实定义文件', () => {
  const impact = yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml', import.meta.url), 'utf8'));
  const files = require('fast-glob').sync(impact.on.pull_request.paths, { cwd: root, dot: true });
  for (const path of ['.implementation-source-relations.json', 'packages/brain/config/company-kr-workflow.json', 'packages/brain/scripts/coding-workflow/repos.json']) {
    assert.ok(files.includes(path), `${path} 的来源定义变更不能漏掉准入`);
  }
});
