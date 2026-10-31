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
    engine: (await import('../../../packages/engine/vitest.config.ts')).default,
    quality: (await import('../../../packages/quality/vitest.config.ts')).default,
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
  for (const path of ['src/orchestrator/__tests__/kernel-callback-flow.integration.test.js', 'src/__tests__/golden-path-contract-task.test.js', 'src/__tests__/executor-report-prompt.test.js']) {
    assert.ok(selected.brain.has(path), `${path}的原生机制丢失`);
  }
  for (const path of ['tests/launcher/claude-launch.test.ts','tests/integration/dev-flow-e2e.test.ts','tests/skills/worktree-path-migration.test.ts']) {
    assert.ok(selected.engine.has(path), `${path}的原生机制丢失`);
  }
});

test('外置正文合同集合明确且非空，原生launcher不被整文件迁走', () => {
  assert.ok(SKILL_SOURCE_TESTS.brain.includes('scripts/ci/__tests__/skill-contract.test.mjs'));
  assert.ok(SKILL_SOURCE_TESTS.engine.includes('tests/proxy/phase81-13-points.test.ts'));
  assert.ok(SKILL_SOURCE_TESTS.quality.includes('tests/regression/harness-android-target-environment.test.ts'));
  for (const component of Object.keys(directory)) {
    const config = skillSourceConfig(component, {});
    const files = glob.sync(config.test.include, {cwd:`${root}/${directory[component]}`, ignore:config.test.exclude});
    assert.ok(files.length > 0, component);
    assert.ok(!files.some(file => /launcher\/claude-launch|dev-flow-e2e/.test(file)));
  }
  assert.throws(() => skillSourceConfig('unknown', {}));
});

test('专项明确覆盖每个组件，使用固定来源恢复后实际运行，缺文件不能成功', () => {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/skills-source-check.yml',import.meta.url),'utf8'));
  const job = workflow.jobs.contracts;
  assert.deepEqual(job.strategy.matrix.component, Object.keys(directory));
  const restored = job.steps.findIndex(step => step.uses === './.github/actions/skills-source');
  const run = job.steps.findIndex(step => step.run?.includes('run-skill-source-check.mjs'));
  assert.ok(restored >= 0 && run > restored);
  assert.ok(job.steps.some(step => step.run?.includes('npm ci')));
  assert.deepEqual(workflow.on.pull_request, {branches:['main']});
  assert.deepEqual(workflow.on.push, {branches:['main']});
});

test('固定Skill最终结果覆盖所有专项，任一失败/跳过/取消/缺结果都不能通过', () => {
  const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/skills-source-check.yml', import.meta.url), 'utf8'));
  const gate = workflow.jobs.passed;
  assert.equal(gate?.name, '固定Skill合同通过');
  assert.equal(gate.if, 'always()');
  assert.deepEqual([...gate.needs].sort(), ['contracts', 'restore']);
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['contracts', 'passed', 'restore']);
  const step = gate.steps.find(step => step.env?.NEEDS_JSON);
  assert.equal(step.env.NEEDS_JSON, '${{ toJSON(needs) }}');
  for (const contracts of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
    for (const restore of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        cwd: root, encoding: 'utf8', env: {...process.env, NEEDS_JSON: JSON.stringify({contracts:{result:contracts}, restore:{result:restore}})},
      });
      assert.equal(result.status === 0, contracts === 'success' && restore === 'success', result.stderr);
    }
  }
});
