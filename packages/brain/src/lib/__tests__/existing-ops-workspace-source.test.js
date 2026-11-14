import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {parse} from 'acorn';
import {createHash} from 'node:crypto';
import { collectWorkspaceInputEdges } from '../existing-ops-workspace-source.js';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const revision = execFileSync('git', ['--no-replace-objects', 'rev-parse', '--verify', 'HEAD^{commit}'],
  {cwd: root, encoding: 'utf8'}).trim();
const paths = execFileSync('git', ['ls-tree', '-rz', '--name-only', revision], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const cache = new Map();
const read = path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(path);
};
const workflow = '.github/workflows/ci.yml';
const runner = 'scripts/ci/run-basic-check.mjs';
const config = 'apps/api/vitest.config.ts';
const selected = 'apps/api/features/planning/pages/capability-system/InvocationPanel.test.tsx';
const collect = overrides => collectWorkspaceInputEdges({ revision, paths,
  parse: text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' }),
  readSource: async path => overrides?.[path] ?? read(path) });
describe('当前Basic workspace子收集器来源', () => {
  it('当前子收集器只封存实际Git读边，revision和两端字节摘要均来自同一固定输入', async () => {
    const reads = new Map();
    const proof = await collectWorkspaceInputEdges({revision,paths,
      parse:text=>parse(text,{ecmaVersion:'latest',sourceType:'module'}),
      readSource:async(path,requestedRevision)=>{expect(requestedRevision).toBe(revision);reads.set(path,read(path));return read(path);}});
    expect(proof.length).toBeGreaterThan(0);
    const hash=text=>createHash('sha256').update(text).digest('hex');
    for(const edge of proof){
      expect(edge.detail.source_revision).toBe(revision);
      expect(edge.detail.consumer_sha256).toBe(hash(reads.get(edge.src_path)));
      expect(edge.detail.input_sha256).toBe(hash(reads.get(edge.dst_path)));
    }
  });
  it('固定Git现有直接命令及字面量选择器证明前端测试输入，不把全部apps路径直接认领', async () => {
    const proof = await collect();
    expect(proof.length).toBeGreaterThan(0);
    expect(proof.map(b => b.dst_path)).toContain(selected);
    expect(proof).toContainEqual(expect.objectContaining({ src_path: runner, dst_path: config }));
    expect(proof).toContainEqual(expect.objectContaining({ src_path: config, dst_path: selected }));
    expect(proof.map(b => b.dst_path)).not.toContain(selected.replace('.test.tsx', '.tsx'));
  });
  it('没有实际工作流入口不凭apps文件存在造边，浮动revision在读取前拒绝', async () => {
    let reads=0;
    const options={revision,paths:[config,selected],readSource:async()=>{reads++;throw Error('must not read');},
      parse:text=>parse(text,{ecmaVersion:'latest',sourceType:'module'})};
    expect(await collectWorkspaceInputEdges(options)).toEqual([]);
    await expect(collectWorkspaceInputEdges({...options,revision:'main'})).rejects.toMatchObject({code:'WORKSPACE_INPUT_SOURCE_UNPROVEN'});
    expect(reads).toBe(0);
  });
  it('实际Basic runner被echo替换不能扩大图消费者来源', async () => {
    const original=read(runner),changed=original.replace("vitest('apps/api')", "step('apps/api', 'echo', 'vitest run')");
    expect(changed).not.toBe(original);
    await expect(collect({ [runner]: changed })).rejects.toThrow(/workspace/i);
  });
  it('实际Basic入口的注释、未执行分支、条件步骤及改变cwd不能证明workspace命令', async () => {
    for (const change of [step => { step.run = '# ' + step.run; }, step => { step.run = 'if false; then ' + step.run + '; fi'; },
      step => { step.if = 'false'; }, step => { step['working-directory'] = 'packages/brain'; }]) {
      const doc = yaml.load(read(workflow));
      const step=Object.values(doc.jobs).flatMap(job=>job.steps||[]).find(s=>s.run?.startsWith('node scripts/ci/run-basic-check.mjs'));
      expect(step).toBeTruthy();change(step);
      await expect(collect({ [workflow]: yaml.dump(doc) })).rejects.toThrow(/workspace/i);
    }
  });
  it('当前完整封组拒绝未审exclude、动态选择器及缺字节', async () => {
    const changed=read(config).replace(/^    exclude: \[\n/m, "    exclude: [\n      'features/**',\n");
    expect(changed).not.toBe(read(config));
    await expect(collect({[config]:changed})).rejects.toThrow(/workspace/i);
    for (const source of [read(config).replace("include: [", 'include: [process.env.TESTS,'), read(config).replace('defineConfig({', 'defineConfig({...dynamic,')]) {
      await expect(collect({ [config]: source })).rejects.toThrow(/workspace/i);
    }
    await expect(collect({ [selected]: '' })).rejects.toThrow(/workspace/i);
  });
});

// 当前候选的必需步骤与历史完整组合兼容分别验证，不把旧版兼容误称为当前CI验收。
it('Commander恢复回归是当前真实CI的必需隔离步骤，改命令或禁用不能借新封组造边', async () => {
  const command='node packages/brain/scripts/smoke/commander-foundation-smoke.mjs';
  const doc=yaml.load(read(workflow)),job=doc.jobs['runtime-integration'];
  const selectedSteps=job.steps.filter(step=>step.run===command);
  expect(selectedSteps).toHaveLength(1);
  expect(selectedSteps[0]).toEqual({name:'Verify Commander decisions and activity recovery',
    env:{TEST_DB_URL:'postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch'},run:command,if:'!cancelled()'});
  expect(job.if).toBe("github.event_name != 'schedule' && github.event.action != 'closed'");
  for(const mutate of [step=>{step.run='echo no-recovery';},step=>{step.if='false';},step=>{delete step.run;},
    step=>{step.env.TEST_DB_URL='postgresql://other@127.0.0.1:5432/cecelia';}]){
    const changed=structuredClone(doc);mutate(changed.jobs['runtime-integration'].steps.find(step=>step.run===command));
    await expect(collect({[workflow]:yaml.dump(changed)})).rejects.toMatchObject({code:'WORKSPACE_INPUT_SOURCE_UNPROVEN'});
  }
});
