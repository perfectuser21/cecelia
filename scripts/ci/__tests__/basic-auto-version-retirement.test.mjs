import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { buildExistingOpsSources } from '../../../packages/brain/src/lib/existing-ops-source.js';
import { collectBasicCiSources, basicCiWorkflowProven } from '../../../packages/brain/src/lib/existing-ops-stage-source.js';
import { ciEntrySelectorEnabled } from '../../../packages/brain/src/lib/existing-ops-runtime-source.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const schemaPath = 'packages/brain/src/lib/existing-ops-source.js';
const workflow = '.github/workflows/auto-version.yml';
const historicalRevision = 'ee851a5546bce56b00455e3efccf1a09fe526f0b';
const reader = 'packages/brain/src/__tests__/auto-version-decision.test.js';
const ast = text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

test('当前schema退役AutoVersion协议，停用workflow与依赖它的live YAML测试不再存在', () => {
  const schema = readFileSync(new URL(schemaPath, new URL('../../../', import.meta.url)), 'utf8');
  assert.equal(ciEntrySelectorEnabled(schema, ast, 'EXISTING_OPS_AUTO_VERSION_SELECTOR_SCHEMA'), false);
  assert.equal(existsSync(new URL(workflow, new URL('../../../', import.meta.url))), false);
  assert.equal(existsSync(new URL(reader, new URL('../../../', import.meta.url))), false);
});

function fixedCandidate(t) {
  const directory = mkdtempSync(join(tmpdir(), 'version-fixed-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index'),
    GIT_AUTHOR_NAME: 'Source fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Source fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const isolatedGit = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, env, encoding: 'utf8' }).trim();
  isolatedGit('read-tree', 'HEAD'); isolatedGit('add', '-u');
  const revision = isolatedGit('commit-tree', isolatedGit('write-tree'), '-p', 'HEAD', '-m', 'test: fixed candidate bytes');
  return { revision, paths: git('ls-tree', '-rz', '--name-only', revision).split('\0').filter(Boolean),
    readSource: async path => git('show', `${revision}:${path}`) };
}

test('实际生产来源采集器不认领已删AutoVersion，也不改写固定历史协议', async t => {
  const source = fixedCandidate(t);
  const { revision, paths } = source;
  const reads = [];
  const result = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths,
    readSource: async path => { reads.push(path); return source.readSource(path); },
  });
  assert.equal(result.consumers.length, 2);
  assert.ok(reads.includes(schemaPath));
  assert.ok(!reads.includes(workflow), '当前候选不得读取已停用的workflow');
  assert.ok(!reads.includes(reader), '当前候选不得认领已停用workflow的live测试');
  for (const consumer of result.consumers) {
    assert.ok(consumer.bindings.every(binding => binding.path !== workflow && binding.path !== reader));
  }
  const legacy = git('show', `${historicalRevision}:${workflow}`);
  const digest = createHash('sha256').update(legacy).digest('hex');
  const collector = readFileSync(new URL('packages/brain/src/lib/existing-ops-stage-source.js', new URL('../../../', import.meta.url)), 'utf8');
  assert.ok(collector.includes(digest), '历史冻结workflow hash不能随当前删除漂移');
  assert.ok(collector.includes('export async function collectAutoVersionTestSources'), '旧固定revision仍需支持');
});


test('新版主CI版本门具备固定整组来源闭包；历史组合保留且新旧混配拒绝', async t => {
  const source = fixedCandidate(t), relations = [];
  const ci = await source.readSource('.github/workflows/ci.yml');
  assert.equal(basicCiWorkflowProven(ci), true);
  const collect = (readSource = source.readSource) => collectBasicCiSources({ ...source, read: readSource, ci, relations, parse: ast });
  await collect();
  assert.ok(relations.some(edge => edge.consumer_path === '.github/workflows/ci.yml' && edge.input_path === 'scripts/ci/check-brain-version-bump.sh'));
  for (const path of ['scripts/ci/check-brain-version-bump.sh', 'scripts/ci/basic-scope.mjs', 'scripts/ci/run-basic-check.mjs', 'packages/brain/vitest.config.js']) {
    await assert.rejects(collect(async input => (await source.readSource(input)) + (input === path ? '\n// unreviewed drift\n' : '')), /basic_ci_source_unproven/);
  }
  await assert.rejects(collect(async path => path === 'scripts/ci/check-brain-version-bump.sh'
    ? git('show', 'fadbf32852:scripts/ci/check-brain-version-bump.sh') : source.readSource(path)), /basic_ci_source_unproven/);
  const altered = yaml.load(ci);
  altered.jobs.plan.steps.find(step => step.name === 'Require actual Brain version increment').run = 'true';
  assert.equal(basicCiWorkflowProven(yaml.dump(altered)), false);
});

test('历史协议回归锚点必须属于候选祖先，干净CI不依赖本机未合并对象', () => {
  assert.doesNotThrow(() => git('merge-base', '--is-ancestor', historicalRevision, 'HEAD'));
});
