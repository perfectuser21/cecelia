import {it,expect} from 'vitest';
import {parse} from 'acorn';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {CI_BUSINESS_GUARDS_INPUTS,CI_BUSINESS_GUARDS_PROFILE_PATH} from '../existing-ops-stage-modes.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
const source=path=>readFileSync(new URL(path,'file://'+root),'utf8');
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
const observe=async(overrides={},selected=paths)=>{
 const relations=[],read=async path=>Object.hasOwn(overrides,path)?overrides[path]:source(path);
 await collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations,parse:ast,paths:selected});
 await collectDeepCiSources({read,revision:'f'.repeat(40),relations,paths:selected});
 return relations;
};
it('业务修复独立完整封组记录17项现役PG、私有回调入口与真实镜像/候选输入',async()=>{
 const relations=await observe();
 expect(relations.filter(r=>r.kind==='reviewed_pr_postgres_test_selector')).toHaveLength(17);
 for(const kind of ['reviewed_private_pg_callback_runner','reviewed_private_pg_callback_test','reviewed_native_business_image_import','reviewed_native_business_staging_probe','reviewed_candidate_docker_fixture'])expect(relations.some(r=>r.kind===kind)).toBe(true);
});
it('新业务封组任一缺失或漂移成员均不能继承入口资格',async()=>{
 for(const path of Object.keys(CI_BUSINESS_GUARDS_INPUTS)){
  await expect(observe({[path]:''})).rejects.toThrow('basic_ci_source_unproven');
  await expect(observe({[path]:source(path)+'\n// unreviewed member\n'})).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('历史封组继续独立有效，新旧混配及缺失新标记均拒绝',async()=>{
 const old=readFixedExistingOpsGitFixture('e7f68785cfd16a5f29943d0f92e62956dd950542');
 const relations=[],read=async path=>old.read(path);
 await expect(collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:old.revision,relations,parse:ast,paths:old.paths})).resolves.toEqual([]);
 await expect(observe({},paths.filter(p=>p!==CI_BUSINESS_GUARDS_PROFILE_PATH))).rejects.toThrow('basic_ci_source_unproven');
 const mixedRead=async path=>path===CI_BUSINESS_GUARDS_PROFILE_PATH?source(path):old.read(path);
 await expect(collectBasicCiSources({read:mixedRead,ci:await read('.github/workflows/ci.yml'),revision:old.revision,relations:[],parse:ast,paths:[...old.paths,CI_BUSINESS_GUARDS_PROFILE_PATH]})).rejects.toThrow('basic_ci_source_unproven');
 for(const path of ['scripts/ci/run-basic-check.mjs','scripts/ci/__tests__/basic-brain-candidate-host.test.mjs','packages/brain/src/scheduler-jobs.js'])await expect(observe({[path]:old.read(path)})).rejects.toThrow('basic_ci_source_unproven');
});
