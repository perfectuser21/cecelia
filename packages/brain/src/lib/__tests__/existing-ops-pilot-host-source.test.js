import {it,expect} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const old=readFixedExistingOpsGitFixture('0431a8d3242783f1d94221cb5471ac40dda7fbd6');
const cli='scripts/ci/pilot-release-verification.mjs',helper='scripts/ci/pilot-foundation-bindings.mjs';
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8');
async function collect({deep=false,fixture,missing,overrides={}}={}){
 const tree=(fixture?.paths??paths).filter(p=>p!==missing),source=async p=>{
  if(!tree.includes(p))throw Error('missing fixed input');return overrides[p]??(fixture?fixture.read(p):read(p));
 };
 const relations=[],request={read:source,paths:tree,revision:fixture?.revision??'f'.repeat(40),relations,parse:s=>parse(s,{ecmaVersion:'latest',sourceType:'module'})};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source('.github/workflows/ci.yml')});
 return relations;
}
it('新Pilot固定宿主完整组与原0431组分别保持Basic/Deep来源证明',async()=>{
 for(const deep of [false,true]){
  expect(await collect({deep,fixture:old})).not.toHaveLength(0);
  const current=await collect({deep});expect(current).not.toHaveLength(0);
  expect(current).toContainEqual(expect.objectContaining({consumer_path:cli,input_path:helper,kind:'reviewed_pilot_foundation_host_source'}));
 }
});
for(const deep of [false,true])for(const target of [cli,helper])it(`拒绝${deep?'Deep':'Basic'}完整组缺失或任意变更：${target}`,async()=>{
 await expect(collect({deep,missing:target})).rejects.toThrow();
 await expect(collect({deep,overrides:{[target]:read(target)+'\n// unreviewed'}})).rejects.toThrow();
});
it('新helper与旧CLI不能混配，新CLI无helper不能借旧0431组通过',async()=>{
 for(const deep of [false,true]){
  await expect(collect({deep,overrides:{[cli]:old.read(cli)}})).rejects.toThrow();
  await expect(collect({deep,fixture:old,overrides:{[cli]:read(cli)}})).rejects.toThrow();
 }
});
