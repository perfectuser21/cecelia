import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {SKILL_SOURCE_ROOTS, SKILL_SOURCE_TESTS, skillSourceConfig} from '../skill-source-tests.mjs';

const require = createRequire(import.meta.url);
const glob = require('fast-glob');
const yaml = require('js-yaml');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = SKILL_SOURCE_ROOTS;

test('默认实际配置不选外置正文，原生混合测试仍在普通单测集合中', async () => {
  const configs = {
    brain: (await import('../../../packages/brain/vitest.config.js')).default,
    root: (await import('../../../vitest.config.js')).default,
  };
  const selected = {};
  for (const [component, config] of Object.entries(configs)) {
    const cwd = `${root}/${directory[component]}`;
    const projects = config.test.projects || [config];
    selected[component] = new Set(projects.flatMap(project => glob.sync(project.test.include || config.test.include || ['**/*.{test,spec}.{js,mjs,ts}'], {
      cwd, ignore:[...(config.test.exclude || []), ...(project.test.exclude || [])],
    })));
    const external = glob.sync(SKILL_SOURCE_TESTS[component], {cwd, ignore:['**/node_modules/**']});
    for (const path of external) assert.ok(!selected[component].has(path), `${component}/${path}仍误入普通单测`);
  }
  for (const path of ['src/orchestrator/__tests__/kernel-observation.test.js', 'src/__tests__/golden-path-contract-task.test.js', 'src/__tests__/executor-report-prompt.test.js']) {
    assert.ok(selected.brain.has(path), `${path}的原生机制丢失`);
  }

});

test('外置正文合同集合明确且非空，原生launcher不被整文件迁走', () => {
  for (const component of Object.keys(directory)) {
    const config = skillSourceConfig(component, {});
    const files = glob.sync(config.test.include, {cwd:`${root}/${directory[component]}`, ignore:config.test.exclude});
    assert.ok(files.length > 0, component);
    assert.ok(!files.some(file => /launcher\/claude-launch|dev-flow-e2e/.test(file)));
  }
  assert.throws(() => skillSourceConfig('unknown', {}));
});

test('专项明确覆盖每个组件，使用固定来源恢复后实际运行，缺文件不能成功', () => {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
  const job = workflow.jobs['skill-contracts'];
  assert.deepEqual(job.strategy.matrix.include, [
    {os:'ubuntu-latest', component:'brain'}, {os:'ubuntu-latest', component:'root'},
    {os:'windows-latest', component:'restore'}, {os:'macos-latest', component:'restore'},
  ]);
  assert.equal(job['runs-on'], '${{ matrix.os }}');
  assert.equal(job.strategy['fail-fast'], false);
  const restored = job.steps.findIndex(step => step.uses === './.github/actions/skills-source');
  const run = job.steps.findIndex(step => step.run?.includes('run-skill-source-check.mjs'));
  assert.ok(restored >= 0 && run > restored);
  assert.ok(job.steps.some(step => step.run?.includes('npm ci')));
  for (const step of job.steps.filter(step => step.run?.includes('npm ci') || step.run?.includes('run-skill-source-check.mjs') || step.uses === 'actions/setup-node@v4')) {
    assert.equal(step.if, "matrix.component != 'restore'");
  }
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  assert.equal(workflow.on.pull_request.paths, undefined);
  assert.deepEqual(workflow.on.push, {branches:['main']});
});

test('唯一最终门直接覆盖实际Skill矩阵，任一失败/跳过/取消/缺结果都不能通过', () => {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.jobs['skill-passed'], undefined);
  assert.equal(workflow.jobs['skill-restore'], undefined);
  const gate = workflow.jobs['ci-passed'];
  assert.equal(gate.if, "always() && github.event_name != 'schedule' && github.event.action != 'closed'");
  assert.ok(gate.needs.includes('skill-contracts'));
  const step = gate.steps.find(step => step.env?.NEEDS_JSON);
  assert.equal(step.env.NEEDS_JSON, '${{ toJSON(needs) }}');
  for (const contracts of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
      const needs = Object.fromEntries(gate.needs.map(id => [id,{result:'success', outputs:id === 'plan' ? {resource_plan:JSON.stringify({linux:true,app_server:true,legacy:true})} : {linux:'success',app_server:'success',app_server_rpc:'success',legacy:'success'}}]));
      if (contracts === undefined) delete needs['skill-contracts']; else needs['skill-contracts'].result = contracts;
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        cwd: root, encoding: 'utf8', env: {...process.env, NEEDS_JSON: JSON.stringify(needs)},
      });
      assert.equal(result.status === 0, contracts === 'success', result.stderr);
  }
});
