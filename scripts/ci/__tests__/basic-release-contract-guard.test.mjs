import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = new URL('../../../', import.meta.url).pathname;
const yaml = createRequire(import.meta.url)('js-yaml');
const workflow = yaml.load(readFileSync(join(root, '.github/workflows/brain-ci-deploy.yml'), 'utf8'));
const guard = workflow.jobs['skill-contract-guard'];
test('合同存在性真实步骤在git差异读取失败时必须失败', () => {
  const directory = mkdtempSync(join(tmpdir(), 'contract-step-'));
  try {
    writeFileSync(join(directory, 'git'), '#!/bin/sh\nexit 77\n'); chmodSync(join(directory, 'git'), 0o755);
    const step = guard.steps.find(step => step.run?.includes('contract-exists.mjs'));
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run.replaceAll('${{ github.base_ref }}', 'main')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, RUNNER_TEMP: directory },
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('未消费的旧选测router不得冒充已执行保障', () => {
  assert.doesNotMatch(JSON.stringify(guard), /changed-test-router/);
  assert.ok(!guard.steps.some(step => step.run?.includes('skill-contract.test.mjs')), '旧root命令已被现行配置排除，不能继续冒充回归');
  const current = yaml.load(readFileSync(join(root, '.github/workflows/skills-source-check.yml'), 'utf8'));
  assert.ok(current.jobs.contracts.steps.some(step => step.run?.includes('run-skill-source-check.mjs')), '固定正文合同由现役专项执行');
});
test('合同CLI的缺失参数和未知参数必须失败，不能按空stdin当非harness成功', () => {
  for (const args of [['--fixture'], ['--unknown']]) {
    const result = spawnSync(process.execPath, ['packages/brain/scripts/ci/contract-exists.mjs', ...args], { cwd: root, encoding: 'utf8', input: '' });
    assert.notEqual(result.status, 0, args.join(' '));
  }
});
test('合同CLI真实读取有合同、缺合同与普通编码差异', () => {
  for (const [input, success] of [['sprints/legacy/contract-draft.md\nsprints/legacy/build.js', true], ['sprints/legacy/build.js', false], ['apps/dashboard/a.tsx', true], ['sprints/20261103-cw-abcdef12/05-review.md', true]]) {
    const result = spawnSync(process.execPath, ['packages/brain/scripts/ci/contract-exists.mjs'], { cwd: root, encoding: 'utf8', input });
    assert.equal(result.status === 0, success, result.stderr);
  }
});
