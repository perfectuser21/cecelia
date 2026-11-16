import {it,expect} from 'vitest';
import {parse} from 'acorn';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';

const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
const profile='packages/brain/src/lib/existing-ops-checker-repair-profile.json';
const config='packages/brain/vitest.config.js',workflow='.github/workflows/ci.yml';
const controls=[profile,config,'packages/brain/scripts/smoke/commander-repair-smoke.mjs','packages/brain/src/durable/__tests__/commander-action-store.pg.integration.test.js'];
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&fs.existsSync(root+p));
const read=p=>fs.readFileSync(root+p,'utf8');
const previous=readFixedExistingOpsGitFixture('3e827180e50e5c73e999ca744a2689488f75814b');
async function collect(overrides={},missing,deep=false,selected=paths){
 const source=async p=>{if(p===missing)throw Error('missing reviewed source');return overrides[p]??read(p);};
 const relations=[],request={read:source,revision:'f'.repeat(40),relations,parse:ast,paths:selected};
 if(deep)await collectDeepCiSources(request);else await collectBasicCiSources({...request,ci:await source(workflow)});
 return relations;
}

it('Checker返工新封组同时证明当前CI、PG配置和准确的新验收入口',async()=>{
 expect(await collect()).toContainEqual(expect.objectContaining({input_path:profile,kind:'reviewed_basic_ci_source_profile'}));
 expect(await collect({},undefined,true)).toContainEqual(expect.objectContaining({input_path:profile,kind:'reviewed_deep_ci_source_profile'}));
});
it('原closeout完整封组在固定历史Git中保持Basic与Deep兼容',async()=>{
 const relations=[],request={read:async p=>previous.read(p),revision:previous.revision,relations,parse:ast,paths:previous.paths};
 await collectBasicCiSources({...request,ci:previous.read(workflow)});await collectDeepCiSources(request);
 expect(relations).not.toHaveLength(0);
});
it.each(controls)('新封组成员缺失或改动均失去来源资格：%s',async member=>{
 for(const deep of [false,true]){
  await expect(collect({},member,deep)).rejects.toThrow();
  await expect(collect({[member]:read(member)+'\n'},undefined,deep)).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('旧CI、旧配置及候选自报新摘要不能拼接为当前封组',async()=>{
 for(const overrides of [{[workflow]:previous.read(workflow)},{[config]:previous.read(config)},
  {[workflow]:previous.read(workflow),[config]:previous.read(config)},
  {[profile]:JSON.stringify({...JSON.parse(read(profile)),[config]:'f'.repeat(64)})}]){
  await expect(collect(overrides)).rejects.toThrow('basic_ci_source_unproven');
 }
 await expect(collect({[config]:previous.read(config)},undefined,true)).rejects.toThrow('basic_ci_source_unproven');
 await expect(collect({},undefined,false,paths.filter(p=>p!==profile))).rejects.toThrow('basic_ci_source_unproven');
});
it.each(['commander-repair-smoke.mjs','commander-action-store.pg.integration.test.js'])('验收入口%s禁用、换库、删掉或空跑均拒绝',async fragment=>{
 for(const mutate of [step=>{step.if='false';},step=>{step.run='echo PASS';},step=>{step.env.TEST_DB_URL='postgresql://ci@127.0.0.1:5432/cecelia';},step=>{step.run=step.run.replace(fragment,'other.mjs');}]){
  const doc=yaml.load(read(workflow));mutate(doc.jobs['runtime-integration'].steps.find(step=>step.run?.includes(fragment)));
  await expect(collect({[workflow]:yaml.dump(doc)})).rejects.toThrow('basic_ci_source_unproven');
 }
});

it('合并保留dormant主分支完整组，混入其旧CI或旧config则拒绝',async()=>{
 const main=readFixedExistingOpsGitFixture('2aa96ff033440d2e70816a05151aa135e792cb4f');
 const request={read:async p=>main.read(p),revision:main.revision,relations:[],parse:ast,paths:main.paths};
 await collectBasicCiSources({...request,ci:main.read(workflow)});await collectDeepCiSources(request);
 for(const member of [config,workflow])await expect(collect({[member]:main.read(member)})).rejects.toThrow('basic_ci_source_unproven');
 const dormant='packages/brain/src/lib/existing-ops-dormant-boundaries-profile.json';
 for(const deep of [false,true])await expect(collect({},undefined,deep,paths.filter(p=>p!==dormant))).rejects.toThrow('basic_ci_source_unproven');
});
