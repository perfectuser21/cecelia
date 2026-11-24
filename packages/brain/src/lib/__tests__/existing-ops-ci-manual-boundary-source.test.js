import {it,expect} from 'vitest';
import {parse} from 'acorn';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {CI_MANUAL_BOUNDARY_INPUTS,CI_MANUAL_BOUNDARY_PROFILE_PATH,CI_NOEXEC_PROFILE_PATH,CI_BUSINESS_GUARDS_PROFILE_PATH} from '../existing-ops-stage-modes.js';
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
it('手动边界完整新组保留18项PR PG并准确记录自动发现合同与显式入口',async()=>{
 const relations=await observe();
 expect(relations.filter(r=>r.kind==='reviewed_pr_postgres_test_selector')).toHaveLength(18);
 expect(new Set(relations.filter(r=>r.kind==='reviewed_manual_codex_case_registration').map(r=>r.input_path)).size).toBe(2);
 expect(new Set(relations.filter(r=>r.kind==='reviewed_opt_in_preview_entry').map(r=>r.input_path)).size).toBe(3);
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'scripts/ci/run-basic-check.mjs',input_path:'scripts/ci/__tests__/basic-manual-integration-boundary.test.mjs',kind:'reviewed_manual_integration_boundary_contract'}));
});
it('任何控制缺失/漂移、旧radius成员复活或缺前置封组均拒绝',async()=>{
 for(const [path,digest] of Object.entries(CI_MANUAL_BOUNDARY_INPUTS)){
  if(digest===null){await expect(observe({},[...paths,path])).rejects.toThrow('basic_ci_source_unproven');continue;}
  await expect(observe({[path]:''})).rejects.toThrow('basic_ci_source_unproven');
  await expect(observe({[path]:source(path)+'\n// unreviewed control\n'})).rejects.toThrow('basic_ci_source_unproven');
 }
 for(const marker of [CI_MANUAL_BOUNDARY_PROFILE_PATH,CI_NOEXEC_PROFILE_PATH,CI_BUSINESS_GUARDS_PROFILE_PATH])await expect(observe({},paths.filter(p=>p!==marker))).rejects.toThrow('basic_ci_source_unproven');
});
it('已发布56完整组保持Basic和Deep资格，新旧selector或新profile不能混配',async()=>{
 const old=readFixedExistingOpsGitFixture('56b493acdb624ea8bd251f888d3a2d16f01375ac');
 const oldRelations=await collect(async p=>old.read(p),old.paths);
 expect(oldRelations.some(r=>r.kind==='reviewed_manual_integration_boundary_contract')).toBe(false);
 for(const control of ['scripts/ci/deep-integration.config.mjs','scripts/ci/brain-test-debt.json']){
  await expect(observe({[control]:old.read(control)})).rejects.toThrow('basic_ci_source_unproven');
  await expect(collect(async p=>p===control?source(p):old.read(p),old.paths)).rejects.toThrow('basic_ci_source_unproven');
 }
 await expect(collect(async p=>p===CI_MANUAL_BOUNDARY_PROFILE_PATH?source(p):old.read(p),[...old.paths,CI_MANUAL_BOUNDARY_PROFILE_PATH])).rejects.toThrow('basic_ci_source_unproven');
});
