import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';

const root = new URL('../../../../../', import.meta.url);
const workflow = '.github/workflows/nightly-regression.yml';
const config = 'scripts/ci/deep-integration.config.mjs';
const current = path => readFileSync(new URL(path, root), 'utf8');
async function collect(overrides = {}, reader = current) {
  const relations = [];
  await collectDeepCiSources({read: async path => overrides[path] ?? reader(path), revision: 'owned-test', relations});
  return relations;
}

it('当前max串行队列workflow与固定Deep配置按完整来源认领', async () => {
  const relations = await collect();
  expect(relations).toContainEqual(expect.objectContaining({consumer_path: workflow,
    input_path: config, kind: 'scheduled_or_manual_full_postgres_entry'}));
});

it('已合main324的完整旧Deep来源仍可读取', async () => {
  const old = readFixedExistingOpsGitFixture('3240b4150ab729b5b6b21d295e893f0a336a4271');
  expect(await collect({}, path => old.read(path))).toHaveLength(2);
});

it.each(['single', 'per-ref', 'cancel-running', 'empty-command'])('未知Deep workflow不能仅凭max字段取得资格：%s', async kind => {
  const doc = yaml.load(current(workflow));
  if (kind === 'single') doc.concurrency.queue = 'single';
  if (kind === 'per-ref') doc.concurrency.group = 'deep-${{ github.ref }}';
  if (kind === 'cancel-running') doc.concurrency['cancel-in-progress'] = true;
  if (kind === 'empty-command') doc.jobs['brain-integration'].steps.find(s => s.name === 'Run full database regressions').run = 'true';
  await expect(collect({[workflow]: yaml.dump(doc)})).rejects.toThrow('basic_ci_source_unproven');
});

it('新workflow不能与未知Deep配置混配', async () => {
  await expect(collect({[config]: current(config) + '\n// unreviewed\n'})).rejects.toThrow('basic_ci_source_unproven');
});

it('新max来源不能与已合历史的旧Deep配置单成员混配', async () => {
  const old = readFixedExistingOpsGitFixture('75e6eb290659054e5cab8587e56003a58bc22e3a');
  expect(old.read(config)).not.toBe(current(config));
  await expect(collect({[config]: old.read(config)})).rejects.toThrow('basic_ci_source_unproven');
});
