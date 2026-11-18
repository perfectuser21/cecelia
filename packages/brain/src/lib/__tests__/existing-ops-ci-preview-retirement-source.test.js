import {expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import yaml from 'js-yaml';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';

const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const workflow='.github/workflows/ci.yml',control='scripts/ci/__tests__/basic-workflow.test.mjs';
const previous=readFixedExistingOpsGitFixture('ff56a157a53bdcc6ff9a612b8d03ca6be741feef');
const retired=['.github/actions/preview-deploy/action.yml','.github/actions/preview-cleanup/action.yml','scripts/ci/preview-ui.mjs',
 'scripts/ci/__tests__/basic-preview-deploy.test.mjs','scripts/ci/__tests__/basic-preview-cleanup.test.mjs','scripts/ci/__tests__/basic-preview-ui.test.mjs',
 'scripts/request-preview-start.sh','scripts/verify-preview-identity.sh','scripts/wait-preview-active.sh',
 'scripts/__tests__/preview-start-request-retry.test.sh','scripts/__tests__/preview-wait-restart-recovery.test.sh'];
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(root+p));
const read=p=>readFileSync(root+p,'utf8');
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
async function collect({overrides={},missing,deep=false,fixture,selected}={}){
 const source=async p=>{if(p===missing)throw Error('missing reviewed input');return overrides[p]??(fixture?fixture.read(p):read(p));};
 const relations=[],request={read:source,revision:fixture?.revision??'f'.repeat(40),relations,parse:ast,paths:selected??fixture?.paths??paths};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source(workflow)});
 return relations;
}
it('Preview退出默认CI的新完整组可读，旧完整组保留自身历史消费关系',async()=>{
 const doc=yaml.load(read(workflow));
 expect(doc.jobs).not.toHaveProperty('preview-deploy');expect(doc.jobs).not.toHaveProperty('preview-cleanup');
 for(const deep of [false,true]){
  const current=await collect({deep});expect(current).not.toHaveLength(0);
  expect(current.some(row=>row.kind==='preview_only_fixed_git_ui_selector')).toBe(false);
  const old=await collect({deep,fixture:previous});expect(old).not.toHaveLength(0);
  if(!deep)expect(old).toContainEqual(expect.objectContaining({input_path:'scripts/ci/preview-ui.mjs',kind:'preview_only_fixed_git_ui_selector'}));
 }
});
it.each(retired)('已清退默认Preview输入不能重现而继承当前来源资格：%s',async target=>{
 expect(paths).not.toContain(target);
 for(const deep of [false,true])await expect(collect({deep,selected:[...paths,target],overrides:{[target]:previous.read(target)}})).rejects.toThrow('basic_ci_source_unproven');
});
it('清退前后CI与控制测试不能混配，缺失或候选自报摘要仍拒绝',async()=>{
 for(const deep of [false,true])for(const target of [workflow,control]){
  await expect(collect({deep,overrides:{[target]:previous.read(target)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,fixture:previous,overrides:{[target]:read(target)}})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect({deep,missing:target})).rejects.toThrow();
 }
 const profile='packages/brain/src/lib/existing-ops-checker-repair-profile.json';
 await expect(collect({overrides:{[profile]:JSON.stringify({...JSON.parse(read(profile)),[control]:'f'.repeat(64)})}})).rejects.toThrow('basic_ci_source_unproven');
});
