import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cruise } from 'dependency-cruiser';
import yaml from 'js-yaml';
import { buildExistingOpsSources } from '../existing-ops-source.js';
import { collectWorkspaceInputEdges } from '../existing-ops-workspace-source.js';
import { parse } from 'acorn';

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
async function collectDefinition(overrides = {}, enabled = true) {
  return (await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths,
    readSource: async path => overrides[path] ?? (path === schema && enabled
      ? read(path) + '\nexport const EXISTING_OPS_WORKSPACE_SELECTOR_SCHEMA = 1;' : read(path)) })).consumers[1];
}
const collect = overrides => collectWorkspaceInputEdges({ revision, paths,
  parse: text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }),
  readSource: async path => overrides?.[path] ?? read(path) });
describe('真实nightly workspace消费者来源', () => {
  it('独立图解析不能激活中央冻结合同之外的workspace绑定', async () => {
    const legacy = await collectDefinition({}, false);
    const marked = await collectDefinition();
    expect(marked.status).toBe('verified');
    expect(marked.bindings).toEqual(legacy.bindings);
    expect(marked.input_relations).toEqual(legacy.input_relations);
  });
  it('固定Git现有直接命令及字面量选择器证明前端测试输入，不把全部apps路径直接认领', async () => {
    const proof = await collect();
    expect(proof.length).toBeGreaterThan(0);
    expect(proof.map(b => b.dst_path)).toContain(selected);
    expect(proof).toContainEqual(expect.objectContaining({ src_path: workflow, dst_path: config }));
    expect(proof).toContainEqual(expect.objectContaining({ src_path: config, dst_path: selected }));
    expect(proof.map(b => b.dst_path)).not.toContain(selected.replace('.test.tsx', '.tsx'));
  });
  it('无marker固定旧来源不增加workspace绑定', async () => {
    const proof = await collectDefinition({}, false);
    expect(proof.status).toBe('verified');
    expect(proof.bindings.some(b => b.path.startsWith('apps/'))).toBe(false);
  });
  it('原生依赖扫描从真实被选择测试解析三个UI owner，不伪造辅助来源或import边', async () => {
    const proof = await collect();
    const owners = ['BusinessInputs', 'CapabilitySystem', 'InvocationPanel'];
    const tests = owners.map(name => `apps/api/features/planning/pages/capability-system/${name}.test.tsx`);
    expect(tests.every(path => proof.some(b => b.dst_path === path))).toBe(true);
    const temporary = mkdtempSync(join(tmpdir(), 'nightly-workspace-source-')), checkout = join(temporary, 'source');
    try {
      execFileSync('git', ['worktree', 'add', '--quiet', '--detach', checkout, revision], { cwd: root });
      const scanned = await cruise(tests, { baseDir: realpathSync(checkout), doNotFollow: { path: 'node_modules' }, exclude: { path: 'node_modules' } });
      const graph = typeof scanned.output === 'string' ? JSON.parse(scanned.output) : scanned.output;
      for (const path of tests) expect(graph.modules.find(m => m.source === path)?.dependencies)
        .toContainEqual(expect.objectContaining({ resolved: path.replace('.test.tsx', '.tsx'), couldNotResolve: false }));
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root });
      rmSync(temporary, { recursive: true, force: true });
    }
  });
  it('脚本替换不能扩大真实图消费者来源', async () => {
    const manifest = 'apps/api/package.json', pkg = JSON.parse(read(manifest));
    pkg.scripts.test = 'echo vitest run';
    await expect(collect({ [manifest]: JSON.stringify(pkg) })).rejects.toThrow(/workspace/i);
  });
  it('注释、未执行分支、条件步骤及改变cwd不能证明workspace命令', async () => {
    for (const change of [step => { step.run = '# ' + step.run; }, step => { step.run = 'if false; then ' + step.run + '; fi'; },
      step => { step.if = 'false'; }, step => { step['working-directory'] = 'packages/brain'; }]) {
      const doc = yaml.load(read(workflow));
      change(doc.jobs['workspace-test-nightly'].steps.find(s => s.name === 'Test apps/api'));
      await expect(collect({ [workflow]: yaml.dump(doc) })).rejects.toThrow(/workspace/i);
    }
  });
  it('真实exclude不选择文件，动态选择器及缺字节失败关闭', async () => {
    const excluded = await collect({ [config]: read(config).replace("exclude: ['node_modules'", "exclude: ['features/**', 'node_modules'") });
    expect(excluded.map(b => b.dst_path)).not.toContain(selected);
    for (const source of [read(config).replace("include: [", 'include: [process.env.TESTS,'), read(config).replace('defineConfig({', 'defineConfig({...dynamic,')]) {
      await expect(collect({ [config]: source })).rejects.toThrow(/workspace/i);
    }
    await expect(collect({ [selected]: '' })).rejects.toThrow(/workspace/i);
  });
});
