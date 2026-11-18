import {expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {regressionSelectors} from '../existing-ops-source.js';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url)),workflow='.github/workflows/ci.yml';
const previous=readFixedExistingOpsGitFixture('13d576c6a6223ff305e4734b37d46600e02fe48b');
const controls=[
 'packages/brain/src/routes/ops.js','packages/brain/src/__tests__/deploy-receipt.test.js',
 'scripts/brain-image-retention/ledger.mjs','scripts/brain-image-retention/docker.mjs','scripts/brain-image-retention/process.mjs',
 'scripts/brain-image-retention-settlement.test.mjs','scripts/__tests__/fixtures/deploy-settlement-process.mjs',
 '.github/workflows/heartbeat-sentinel.yml','scripts/ci/__tests__/basic-alert-failure-propagation.test.mjs','packages/brain/src/__tests__/nightly-regression-config.test.js',
 'packages/brain/vitest.config.js','scripts/ci/deep-integration.config.mjs','scripts/ci/brain-test-debt.json',
 'packages/brain/src/__tests__/consciousness-loop-disabled.test.js',
 'packages/brain/src/lib/implementation-ci-snapshot.js','scripts/ci/implementation-snapshot.mjs',
 'packages/brain/src/lib/company-kr-source.js','packages/brain/src/projection/company-kr-registration-notion.js','packages/brain/src/lib/__tests__/implementation-ci-snapshot.test.js',
 'packages/brain/src/guard-drill.js','packages/brain/src/__tests__/guard-drill.test.js',
 'packages/brain/scripts/smoke/shared-activities-smoke.sh','packages/brain/src/__tests__/integration/shared-activities.pg.integration.test.js',
];
const retired=[
 'scripts/ci/check-nightly-green.sh','scripts/ci/__tests__/check-nightly-green.test.sh','scripts/ci/__tests__/basic-nightly-time-evidence.test.mjs',
 'packages/brain/src/lib/company-kr-registration.js','packages/brain/src/lib/__tests__/company-kr-registration.test.js',
 'packages/brain/src/__tests__/integration/company-kr-fixed-source.pg.integration.test.js','packages/brain/src/__tests__/integration/company-kr-registration.pg.integration.test.js',
 'packages/brain/src/lib/__tests__/integration/implementation-ci-company.test.js',
 'packages/brain/src/__tests__/integration/harness-commander-phase1.integration.test.js','packages/brain/src/__tests__/integration/harness-commander-phase2.integration.test.js',
 'packages/brain/src/quota-guard.js',
];
const marker='packages/brain/src/__tests__/deploy-receipt.test.js';
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8'),ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
async function collect({overrides={},missing,deep=false,fixture}={}){
 const tree=[...(fixture?.paths??paths),...Object.keys(overrides).filter(p=>!(fixture?.paths??paths).includes(p))];
 const source=async p=>{if(p===missing||!tree.includes(p))throw Error('missing reviewed input');return overrides[p]??(fixture?fixture.read(p):read(p));};
 const relations=[],request={read:source,revision:fixture?.revision??'f'.repeat(40),relations,parse:ast,paths:tree};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source(workflow)});
 return relations;
}
it('本轮完整Nightly活性/有界status及停用选择组与13d旧Runtime各自有效',async()=>{
 expect(read(workflow)).toBe(previous.read(workflow));
 for(const deep of [false,true])for(const fixture of [undefined,previous])expect(await collect({deep,fixture})).not.toHaveLength(0);
});
it.each(controls)('新的实际控制成员缺失或漂移均失去资格：%s',async target=>{
 for(const deep of [false,true]){
  await expect(collect({deep,missing:target})).rejects.toThrow();
  await expect(collect({deep,overrides:{[target]:read(target)+'\n# unknown control'}})).rejects.toThrow();
 }
});
it.each(retired)('已核清退入口或专属回归不能复活：%s',async target=>{
 expect(paths).not.toContain(target);
 for(const deep of [false,true])await expect(collect({deep,overrides:{[target]:previous.read(target)}})).rejects.toThrow('basic_ci_source_unproven');
});
it('新旧控制组任何成员或新helper不能跨族拼接',async()=>{
 for(const deep of [false,true])for(const target of controls){
  if(previous.paths.includes(target)){
   expect(read(target)).not.toBe(previous.read(target));
   await expect(collect({deep,overrides:{[target]:previous.read(target)}})).rejects.toThrow();
  }
  await expect(collect({deep,fixture:previous,overrides:{[target]:read(target)}})).rejects.toThrow();
 }
});
it('旧Runtime也不允许新的未固定ledger/Sentinel字节蒙混，未知receipt不回退',async()=>{
 for(const deep of [false,true]){
  for(const target of ['scripts/brain-image-retention/ledger.mjs','.github/workflows/heartbeat-sentinel.yml'])await expect(collect({deep,fixture:previous,overrides:{[target]:previous.read(target)+'\n# unknown legacy control'}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,overrides:{[marker]:'export const STATUS_PROTOCOL="trust-me";'}})).rejects.toThrow('basic_ci_source_unproven');
 }
});

it('源码selector仅解析已审具名停用字面量数组，关闭态回归继续被选择',async()=>{
 const text=read('packages/brain/vitest.config.js'),selected=await regressionSelectors(text,[]);
 for(const path of ['src/__tests__/consciousness-graph.test.js','src/__tests__/consciousness-loop.test.js','src/workflows/__tests__/consciousness.graph.test.js','src/__tests__/integration/consciousness-graph.integration.test.js','src/__tests__/integration/consciousness-checkpoint.pg.integration.test.js'])expect(selected.exclude.some(pattern=>pattern.test('packages/brain/'+path))).toBe(true);
 const closed='packages/brain/src/__tests__/consciousness-loop-disabled.test.js';
 expect(selected.include.some(pattern=>pattern.test(closed))).toBe(true);expect(selected.exclude.some(pattern=>pattern.test(closed))).toBe(false);
});
it('停用选择器拒绝动态表达式、别名、可变声明、覆盖及其它spread',async()=>{
 const text=read('packages/brain/vitest.config.js'),name='INACTIVE_CONSCIOUSNESS_TESTS';
 const declaration=ast(text).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.declarations?.some(d=>d.id.name===name)).declaration.declarations.find(d=>d.id.name===name);
 const init=source=>text.slice(0,declaration.init.start)+source+text.slice(declaration.init.end);
 for(const changed of [init('["a"].concat(["b"])'),init('UNKNOWN_ARRAY'),init('[getInactive()]'),text.replace('export const '+name,'export let '+name),text.replace('export const '+name,'const '+name),text+'\n'+name+'[0]="other";',text+'\nconst alias='+name+';',text+'\n'+name+'.push("other");',text.replace('...'+name,'...UNREVIEWED_ARRAY')])await expect(regressionSelectors(changed,[])).rejects.toThrow(/selector_(?:inactive|literal)_unproven/);
});
