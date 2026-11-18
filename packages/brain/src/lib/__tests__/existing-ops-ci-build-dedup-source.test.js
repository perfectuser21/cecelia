import {expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import yaml from 'js-yaml';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';

const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const workflow='.github/workflows/ci.yml',test='scripts/ci/__tests__/basic-workflow.test.mjs';
const previous=readFixedExistingOpsGitFixture('a4395e4685c15a12c4abdb7679f3b96492e1839f');
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8');
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
async function collect({overrides={},missing,deep=false,fixture}={}){
 const source=async p=>{if(p===missing)throw Error('missing reviewed input');return overrides[p]??(fixture?fixture.read(p):read(p));};
 const relations=[],request={read:source,revision:fixture?.revision??'f'.repeat(40),relations,parse:ast,paths:fixture?.paths??paths};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source(workflow)});
 return relations;
}
it('优化后的完整CI控制组和历史完整控制组均保持Basic与Deep来源资格',async()=>{
 expect(yaml.load(read(workflow)).jobs.checks.steps.find(s=>s.name==='Install locked dependencies').if).toBe("matrix.component != 'image'");
 for(const deep of [false,true]){
  expect(await collect({deep})).not.toHaveLength(0);
  expect(await collect({deep,fixture:previous})).not.toHaveLength(0);
 }
});
it('新旧CI与来源控制测试不得混配，候选自报摘要不能授权',async()=>{
 for(const deep of [false,true])for(const member of [workflow,test,'scripts/ci/__tests__/basic-fixed-core.test.mjs']){
  await expect(collect({deep,overrides:{[member]:previous.read(member)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,fixture:previous,overrides:{[member]:read(member)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,missing:member})).rejects.toThrow();
  await expect(collect({deep,overrides:{[member]:read(member)+'\n// unknown control'}})).rejects.toThrow();
 }
 const profile='packages/brain/src/lib/existing-ops-checker-repair-profile.json';
 await expect(collect({overrides:{[profile]:JSON.stringify({...JSON.parse(read(profile)),[test]:'f'.repeat(64)})}})).rejects.toThrow('basic_ci_source_unproven');
});
it('优化不授予失败、取消、写权限或空跑PG步骤来源资格',async()=>{
 for(const mutate of [
  doc=>{doc.permissions.contents='write';},
  doc=>{doc.jobs.checks['continue-on-error']=true;},
  doc=>{doc.jobs['runtime-integration'].if='false';},
  doc=>{doc.jobs['runtime-integration'].steps.find(s=>s.run?.includes('workflow-foundation.pg.integration.test.js')).run='echo PASS';},
  doc=>{doc.jobs['runtime-integration'].steps.find(s=>s.run?.includes('workflow-foundation.pg.integration.test.js')).if='always()';},
  doc=>{doc.jobs['runtime-integration'].steps.find(s=>s.run?.includes('workflow-foundation.pg.integration.test.js')).env.DB_NAME='cecelia';},
 ]){
  const doc=yaml.load(read(workflow));mutate(doc);
  await expect(collect({overrides:{[workflow]:yaml.dump(doc)}})).rejects.toThrow('basic_ci_source_unproven');
 }
});
