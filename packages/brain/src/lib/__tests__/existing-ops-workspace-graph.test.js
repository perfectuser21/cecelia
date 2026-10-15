import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parse } from 'acorn';
import { cruise } from 'dependency-cruiser';
import { collectWorkspaceInputEdges } from '../existing-ops-workspace-source.js';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const revision = 'b5800c2d297cb121e90ff74987ebc410679371a2';
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const cache = new Map();
const read = path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(path);
};
const workflow = '.github/workflows/nightly-regression.yml', config = 'apps/api/vitest.config.ts';
const selected = 'apps/api/features/planning/pages/capability-system/InvocationPanel.test.tsx';
const collect = overrides => collectWorkspaceInputEdges({ revision, paths,
  parse: text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }), readSource: async path => overrides?.[path] ?? read(path) });
describe('旧冻结定义的真实workspace图输入', () => {
  it('无新marker的固定Git仍有真实消费边；不修改任何旧definition binding', async () => {
    expect(read('packages/brain/src/lib/existing-ops-source.js')).not.toContain('EXISTING_OPS_WORKSPACE_SELECTOR_SCHEMA');
    const edges = await collect();
    for (const [src_path, dst_path] of [[workflow, config], [config, selected]]) expect(edges)
      .toContainEqual(expect.objectContaining({ src_path, dst_path, edge_type: 'import', detail: expect.objectContaining({
        source_revision: revision, consumer_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), input_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }) }));
    expect(edges.some(e => e.dst_path === selected.replace('.test.tsx', '.tsx'))).toBe(false);
  });
  it('条件、工作目录、动态include、缺字节不输出部分成功边', async () => {
    for (const change of [step => { step.if = 'false'; }, step => { step['working-directory'] = 'other'; }]) {
      const doc = yaml.load(read(workflow));
      change(doc.jobs['workspace-test-nightly'].steps.find(s => s.name === 'Test apps/api'));
      await expect(collect({ [workflow]: yaml.dump(doc) })).rejects.toThrow(/workspace/i);
    }
    for (const overrides of [{ [config]: read(config).replace('include: [', 'include: [process.env.TESTS,') }, { [selected]: '' }])
      await expect(collect(overrides)).rejects.toThrow(/workspace/i);
  });
  it('exclude生效，文件存在不等于被选择', async () => {
    const edges = await collect({ [config]: read(config).replace("exclude: ['node_modules'", "exclude: ['features/**', 'node_modules'") });
    expect(edges.some(e => e.dst_path === selected)).toBe(false);
  });
});

// scan-graph.mjs 使用同一原生 cruise 入口。partial workspace 安装也必须具备 TSX 解析器，
// 否则 selector 边虽在，真实 test→component import 边仍会静默消失。
it.each(['BusinessInputs','CapabilitySystem','InvocationPanel'])('实际安装的原生扫描器解析 %s TSX测试到组件',async name=>{
 const prefix='apps/api/features/planning/pages/capability-system/';
 const input=`${prefix}${name}.test.tsx`,owner=`${prefix}${name}.tsx`;
 const result=await cruise([input],{baseDir:root,doNotFollow:{path:'node_modules'},exclude:{path:'node_modules'}});
 const output=typeof result.output==='string'?JSON.parse(result.output):result.output;
 const dependencies=output.modules.find(module=>module.source===input)?.dependencies||[];
 expect(dependencies.some(dependency=>dependency.resolved===owner&&!dependency.couldNotResolve),JSON.stringify({input,owner,modules:output.modules.map(module=>module.source)})).toBe(true);
},30000);
