import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { buildExistingOpsSources } from '../existing-ops-source.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const revision = 'b5800c2d297cb121e90ff74987ebc410679371a2';
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const cache = new Map();
const read = path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(path);
};
const schema = 'packages/brain/src/lib/existing-ops-source.js';
const workflow = '.github/workflows/nightly-regression.yml';
const config = 'apps/api/vitest.config.ts';
const selected = 'apps/api/features/planning/pages/capability-system/InvocationPanel.test.tsx';
async function collect(overrides = {}, enabled = true) {
  return (await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths,
    readSource: async path => overrides[path] ?? (path === schema && enabled
      ? read(path) + '\nexport const EXISTING_OPS_WORKSPACE_SELECTOR_SCHEMA = 1;' : read(path)) })).consumers[1];
}
describe('真实nightly workspace消费者来源', () => {
  it('固定Git现有直接命令及字面量选择器证明前端测试输入，不把全部apps路径直接认领', async () => {
    const proof = await collect();
    expect(proof.status, JSON.stringify(proof.gaps)).toBe('verified');
    expect(proof.bindings.map(b => b.path)).toContain(selected);
    expect(proof.input_relations).toContainEqual(expect.objectContaining({ consumer_path: workflow, input_path: config, kind: 'nightly_workspace_vitest_config', revision }));
    expect(proof.input_relations).toContainEqual(expect.objectContaining({ consumer_path: config, input_path: selected, kind: 'literal_workspace_vitest_selector', revision }));
    expect(proof.bindings.map(b => b.path)).not.toContain(selected.replace('.test.tsx', '.tsx'));
  });
  it('无marker固定旧来源不增加workspace绑定', async () => {
    const proof = await collect({}, false);
    expect(proof.status).toBe('verified');
    expect(proof.bindings.some(b => b.path.startsWith('apps/'))).toBe(false);
  });
  it('注释、未执行分支、条件步骤及改变cwd不能证明workspace命令', async () => {
    for (const change of [step => { step.run = '# ' + step.run; }, step => { step.run = 'if false; then ' + step.run + '; fi'; },
      step => { step.if = 'false'; }, step => { step['working-directory'] = 'packages/brain'; }]) {
      const doc = yaml.load(read(workflow));
      change(doc.jobs['workspace-test-nightly'].steps.find(s => s.name === 'Test apps/api'));
      const proof = await collect({ [workflow]: yaml.dump(doc) });
      expect(proof.status).toBe('unknown');
      expect(proof.bindings).toEqual([]);
    }
  });
  it('真实exclude不选择文件，动态选择器及缺字节失败关闭', async () => {
    const excluded = await collect({ [config]: read(config).replace("exclude: ['node_modules'", "exclude: ['features/**', 'node_modules'") });
    expect(excluded.status).toBe('verified');
    expect(excluded.bindings.map(b => b.path)).not.toContain(selected);
    for (const source of [read(config).replace("include: [", 'include: [process.env.TESTS,'), read(config).replace('defineConfig({', 'defineConfig({...dynamic,')]) {
      const proof = await collect({ [config]: source });
      expect(proof.status).toBe('unknown');
      expect(proof.bindings).toEqual([]);
    }
    const missing = await collect({ [selected]: '' });
    expect(missing.status).toBe('unknown');
    expect(missing.bindings).toEqual([]);
  });
});
