import {expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url)),workflow='.github/workflows/ci.yml';
const historical=['85f24b00af99063cf27919cdcf79675d6d33e6a3','f10e1da6b32c03febe0ac6080715e56615af0175'].map(readFixedExistingOpsGitFixture);
const previousBuilder=readFixedExistingOpsGitFixture('e5e8202bf0ee76d7826fdec5474dfe506a86f537');
const runtimeHelper='scripts/lib/deploy-runtime-inputs.sh',runtimeMarker='packages/brain/src/__tests__/deploy-root-guard.test.js';
const marker='scripts/ci/__tests__/basic-brain-candidate-host.test.mjs',dockerfile='packages/brain/Dockerfile';
const controls=['scripts/brain-build.sh',dockerfile,'scripts/ci/run-basic-check.mjs','scripts/ci/__tests__/basic-fixed-core.test.mjs',marker];
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8'),ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
async function collect({overrides={},missing,deep=false,fixture}={}){
 const tree=fixture?.paths??paths;
 const source=async p=>{if(p===missing||!tree.includes(p))throw Error('missing reviewed input');return overrides[p]??(fixture?fixture.read(p):read(p));};
 const relations=[],request={read:source,revision:fixture?.revision??'f'.repeat(40),relations,parse:ast,paths:tree};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source(workflow)});
 return relations;
}
it('新Runtime、旧Builder、旧BIND与旧MAIN同workflow各自完整来源有效',async()=>{
 expect(read('scripts/brain-build.sh')).toContain('buildx');
 for(const deep of [false,true])for(const fixture of [undefined,previousBuilder,...historical]){
  const relations=await collect({deep,fixture});expect(relations).not.toHaveLength(0);
  expect(relations.some(row=>row.kind==='preview_only_fixed_git_ui_selector')).toBe(false);
  if(!deep&&!fixture)expect(relations).toContainEqual(expect.objectContaining({consumer_path:'scripts/ci/run-basic-check.mjs',input_path:dockerfile,kind:'reviewed_image_builder_capability'}));
 }
});
it('旧MAIN和BIND不能忽略Dockerfile的未知变化',async()=>{
 for(const deep of [false,true])for(const fixture of historical)await expect(collect({deep,fixture,overrides:{[dockerfile]:fixture.read(dockerfile)+'\n# unknown builder'}})).rejects.toThrow('basic_ci_source_unproven');
});
it.each(controls)('Builder实际控制缺失或漂移不能借相同CI取得资格：%s',async target=>{
 for(const deep of [false,true]){
  await expect(collect({deep,missing:target})).rejects.toThrow();
  await expect(collect({deep,overrides:{[target]:read(target)+'\n# unknown builder control'}})).rejects.toThrow();
 }
});
it('三个完整协议的任一新旧成员混配均拒绝',async()=>{
 for(const deep of [false,true])for(const fixture of historical)for(const target of controls){
  expect(read(target)).not.toBe(fixture.read(target));
  await expect(collect({deep,overrides:{[target]:fixture.read(target)}})).rejects.toThrow();
  await expect(collect({deep,fixture,overrides:{[target]:read(target)}})).rejects.toThrow();
 }
});
it('未知或缺失的typed marker不能被猜作旧组或回退组',async()=>{
 for(const deep of [false,true]){
  await expect(collect({deep,overrides:{[marker]:'export const BUILDER_PROFILE="trust-me";'}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,missing:marker})).rejects.toThrow();
 }
});

it('Runtime幂等修复两成员必须完整，旧Builder不可混入新helper或新回归',async()=>{
 for(const deep of [false,true])for(const target of [runtimeHelper,runtimeMarker]){
  expect(read(target)).not.toBe(previousBuilder.read(target));
  await expect(collect({deep,overrides:{[target]:previousBuilder.read(target)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,fixture:previousBuilder,overrides:{[target]:read(target)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,missing:target})).rejects.toThrow();
  await expect(collect({deep,overrides:{[target]:read(target)+'\n# unknown runtime'}})).rejects.toThrow();
 }
});
it('Builder族内未知root回归不能猜测为旧Builder或新Runtime',async()=>{
 for(const deep of [false,true])await expect(collect({deep,overrides:{[runtimeMarker]:'export const RUNTIME_FIX="trust-me";'}})).rejects.toThrow('basic_ci_source_unproven');
});
