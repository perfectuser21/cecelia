import {it,expect} from 'vitest';
import {parse} from 'acorn';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {reviewedPilotSourceControls,REVIEWED_NIGHTLY_STATUS,CI_RESIDUE_INPUTS,CI_RESIDUE_PROFILE_PATH,CI_MANUAL_BOUNDARY_PROFILE_PATH,CI_NOEXEC_PROFILE_PATH,CI_BUSINESS_GUARDS_PROFILE_PATH} from '../existing-ops-stage-modes.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
const source=p=>readFileSync(new URL(p,'file://'+root),'utf8');
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
const collect=async(read,selected)=>{
 const relations=[];await collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations,parse:ast,paths:selected});
 await collectDeepCiSources({read,revision:'f'.repeat(40),relations,paths:selected});return relations;
};
const observe=async(overrides={},selected=paths)=>collect(async p=>Object.hasOwn(overrides,p)?overrides[p]:source(p),selected);
it('残留清退新完整组保留18项PR、六叶真实import执行与当前Skill归属边界',async()=>{
 const relations=await observe();
 expect(relations.filter(r=>r.kind==='reviewed_pr_postgres_test_selector')).toHaveLength(18);
 const imported=relations.filter(r=>r.kind==='reviewed_static_test_import_execution');
 expect(new Set(imported.map(r=>r.input_path)).size).toBe(6);
 for(const relation of imported){
  expect(relation.consumer_path).toBe('packages/brain/src/__tests__/integration/workflow-common-terminal.pg.integration.test.js');
  expect(source(relation.consumer_path)).toContain("import './"+relation.input_path.split('/').at(-1)+"';");
  expect(paths).toContain(relation.input_path);
 }
 expect(relations.some(r=>r.input_path==='.github/actions/skills-source/action.yml'||r.input_path==='scripts/ci/check-skill-source-identity.py'||r.input_path==='scripts/ci/__tests__/basic-capability-map.test.mjs')).toBe(false);
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'scripts/ci/run-basic-check.mjs',input_path:'scripts/ci/__tests__/basic-integration-once.test.mjs',kind:'reviewed_residue_integration_contract'}));
});
it('任何当前控制缺失/漂移、退役成员复活、六叶丢失或缺前置组均拒绝',async()=>{
 for(const [path,digest] of Object.entries(CI_RESIDUE_INPUTS)){
  if(digest===null){await expect(observe({},[...paths,path])).rejects.toThrow('basic_ci_source_unproven');continue;}
  await expect(observe({[path]:''})).rejects.toThrow('basic_ci_source_unproven');
  await expect(observe({[path]:source(path)+'\n// unreviewed control\n'})).rejects.toThrow('basic_ci_source_unproven');
 }
 for(const marker of [CI_RESIDUE_PROFILE_PATH,CI_MANUAL_BOUNDARY_PROFILE_PATH,CI_NOEXEC_PROFILE_PATH,CI_BUSINESS_GUARDS_PROFILE_PATH,'packages/brain/src/__tests__/integration/acceptance-classification.pg.integration.test.js'])await expect(observe({},paths.filter(p=>p!==marker))).rejects.toThrow('basic_ci_source_unproven');
});
it('206与3a完整历史组均保持资格，当前与历史selector/profile不能混配',async()=>{
 for(const revision of ['206b2d17a85d1e5d0686aa193a8f94aabf35ddfa','3a057b9c1332d0f42491566bc01e2ee28a7157f2']){
  const old=readFixedExistingOpsGitFixture(revision);
  const relations=await collect(async p=>old.read(p),old.paths);
  expect(relations.some(r=>r.kind==='reviewed_residue_integration_contract')).toBe(false);
  const control='scripts/ci/deep-integration.config.mjs';
  await expect(observe({[control]:old.read(control)})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect(async p=>p===control?source(p):old.read(p),old.paths)).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect(async p=>p===CI_RESIDUE_PROFILE_PATH?source(p):old.read(p),[...old.paths,CI_RESIDUE_PROFILE_PATH])).rejects.toThrow('basic_ci_source_unproven');
 }
});

it('新profile不能在缺原生或Pilot前置路径时静默退回父组',async()=>{
 for(const marker of ['scripts/ci/pilot-foundation-bindings.mjs','packages/brain/config/native-agent.json','scripts/ci/__tests__/basic-brain-predecessor.test.mjs']){
  const selected=paths.filter(p=>p!==marker);
  await expect(reviewedPilotSourceControls(REVIEWED_NIGHTLY_STATUS,selected,async p=>source(p))).rejects.toThrow('basic_ci_source_unproven');
 }
});
