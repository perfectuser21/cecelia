import {expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url)),workflow='.github/workflows/ci.yml';
const previous=readFixedExistingOpsGitFixture('85f24b00af99063cf27919cdcf79675d6d33e6a3');
const compose='docker-compose.us-vps.yml',deploy='scripts/deploy-local.sh',helper='scripts/lib/deploy-runtime-inputs.sh';
const marker='scripts/ci/__tests__/basic-deploy-root-mounts.test.mjs',regression='packages/brain/src/__tests__/deploy-root-guard.test.js';
const controls=[compose,deploy,helper,marker,regression];
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8'),ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
async function collect({overrides={},missing,deep=false,fixture,selected}={}){
 const tree=selected??fixture?.paths??paths;
 const source=async p=>{if(p===missing||!tree.includes(p))throw Error('missing reviewed input');return overrides[p]??(fixture?fixture.read(p):read(p));};
 const relations=[],request={read:source,revision:fixture?.revision??'f'.repeat(40),relations,parse:ast,paths:tree};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source(workflow)});
 return relations;
}
it('同一CI下新挂载完整组与85旧MAIN完整组分别有效，旧组不冒认新helper',async()=>{
 expect(read(workflow)).toBe(previous.read(workflow));
 for(const deep of [false,true]){
  const current=await collect({deep});expect(current).not.toHaveLength(0);
  const old=await collect({deep,fixture:previous});expect(old).not.toHaveLength(0);
  if(!deep){
   expect(current).toContainEqual(expect.objectContaining({consumer_path:deploy,input_path:helper,kind:'reviewed_runtime_input_preservation_helper'}));
   expect(old.some(row=>row.input_path===helper)).toBe(false);
  }
 }
});
it.each(controls)('新挂载完整控制成员缺失或漂移不得继承同workflow资格：%s',async target=>{
 for(const deep of [false,true]){
  await expect(collect({deep,missing:target})).rejects.toThrow();
  await expect(collect({deep,overrides:{[target]:read(target)+'\n# drift'}})).rejects.toThrow();
 }
});
it('新旧compose、部署器及真实Git回归任一混配均拒绝',async()=>{
 for(const deep of [false,true])for(const target of [compose,deploy,regression]){
  expect(read(target)).not.toBe(previous.read(target));
  await expect(collect({deep,overrides:{[target]:previous.read(target)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,fixture:previous,overrides:{[target]:read(target)}})).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('marker与helper不能单独出现或被同时移除来回退旧协议',async()=>{
 for(const deep of [false,true]){
  for(const target of [marker,helper])await expect(collect({deep,fixture:previous,selected:[...previous.paths,target],overrides:{[target]:read(target)}})).rejects.toThrow();
  for(const removed of [[marker],[helper],[marker,helper]])await expect(collect({deep,selected:paths.filter(p=>!removed.includes(p))})).rejects.toThrow();
 }
});
