import {it,expect} from 'vitest';
import {parse} from 'acorn';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {CI_NOEXEC_INPUTS,CI_NOEXEC_PROFILE_PATH} from '../existing-ops-stage-modes.js';
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
it('noexec完整新组只认真实镜像合同、静态命令及原18项PG读边',async()=>{
 const relations=await observe();
 expect(relations.filter(r=>r.kind==='reviewed_pr_postgres_test_selector')).toHaveLength(18);
 for(const kind of ['reviewed_noexec_native_image_contract','reviewed_noexec_native_image_fixture','reviewed_noexec_native_image_static_command'])expect(relations.some(r=>r.kind===kind)).toBe(true);
});
it('noexec任一成员与独立profile缺失、漂移均拒绝',async()=>{
 for(const path of Object.keys(CI_NOEXEC_INPUTS)){
  await expect(observe({[path]:''})).rejects.toThrow('basic_ci_source_unproven');
  await expect(observe({[path]:source(path)+'\n// unreviewed input\n'})).rejects.toThrow('basic_ci_source_unproven');
 }
 await expect(observe({},paths.filter(p=>p!==CI_NOEXEC_PROFILE_PATH))).rejects.toThrow('basic_ci_source_unproven');
});
it('e98已发布business完整组独立有效，新旧runner、helper或profile混配拒绝',async()=>{
 const old=readFixedExistingOpsGitFixture('e98a0d064ea2548548c86f105202ba665b17389b');
 const relations=[],read=async path=>old.read(path);
 await collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:old.revision,relations,parse:ast,paths:old.paths});
 await collectDeepCiSources({read,revision:old.revision,relations,paths:old.paths});
 expect(relations.some(r=>r.kind==='reviewed_noexec_native_image_contract')).toBe(false);
 for(const path of ['scripts/ci/run-basic-check.mjs','packages/brain/src/__tests__/helpers/native-agent-host-fixture.js']){
  await expect(observe({[path]:old.read(path)})).rejects.toThrow('basic_ci_source_unproven');
  const mixed=async p=>p===path?source(p):old.read(p);
  await expect(collectBasicCiSources({read:mixed,ci:await read('.github/workflows/ci.yml'),revision:old.revision,relations:[],parse:ast,paths:old.paths})).rejects.toThrow('basic_ci_source_unproven');
 }
 const withProfile=async p=>p===CI_NOEXEC_PROFILE_PATH?source(p):old.read(p);
 await expect(collectBasicCiSources({read:withProfile,ci:await read('.github/workflows/ci.yml'),revision:old.revision,relations:[],parse:ast,paths:[...old.paths,CI_NOEXEC_PROFILE_PATH]})).rejects.toThrow('basic_ci_source_unproven');
});
