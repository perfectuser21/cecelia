import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectVerificationRetirementCandidates,verifyVerificationRetirementCandidates} from '../implementation-verification-retirements.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const BASE='ce20b5a29123c9ade1a0bc4aa2753e3ea3fe310d';
const names=['observer-response-retired-v1.json','systemic-unused-export-v1.json'];
const catalogs=names.map(name=>JSON.parse(readFileSync(join(root,'config/verification-retirements',name))));
const retired=catalogs.flatMap(c=>c.records.map(r=>r.path));
function fixture(fn){
 const temp=mkdtempSync(join(tmpdir(),'unused-response-retirement-')),source=join(temp,'source'),control=join(temp,'control');
 const git=(dir,...args)=>execFileSync('git',['-c','gc.auto=0','-c','maintenance.auto=false','-c','gc.autoDetach=false','-C',dir,...args],
  {encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
 const commit=dir=>{git(dir,'add','--sparse','-A');git(dir,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: fixed retirement candidate');};
 try{
  git(root,'clone','--shared','--no-checkout','-q',root,source);
  for(const key of ['gc.auto','maintenance.auto','gc.autoDetach'])git(source,'config',key,key.endsWith('Detach')?'false':'0');
  const inputs=[...new Set(catalogs.flatMap(c=>[c.base_config.path,c.replacement_config.path,c.skill_selector.path,
   ...c.replacement_inputs.map(x=>(x.blob||x).path),...c.records.flatMap(r=>(r.policy_sources||[]).map(x=>x.path)),...c.entry_support.map(x=>x.path)]))];
  git(source,'sparse-checkout','init','--no-cone');git(source,'sparse-checkout','set',...[...inputs,...retired].map(p=>'/'+p));
  git(source,'checkout','-q',BASE);git(source,'remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
  for(const path of retired)rmSync(join(source,path));
  for(const path of inputs){mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),readFileSync(join(root,path)));}
  commit(source);mkdirSync(control);git(control,'init','-q');git(control,'remote','add','origin','https://github.com/perfectuser21/cecelia.git');
  cpSync(join(root,'config/verification-retirements'),join(control,'config/verification-retirements'),{recursive:true});commit(control);
  const options=(base=BASE)=>({purpose:'admission_only',toolingRoot:control,toolingRevision:git(control,'rev-parse','HEAD'),
   source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:git(source,'rev-parse','HEAD'),
    changed_files:git(source,'diff','--no-renames','--name-only',base,'HEAD').split('\n').filter(Boolean).map(path=>({path}))}});
  fn({source,control,git,commit,options});
 }finally{rmSync(temp,{recursive:true,force:true});}
}
test('两份旧PG测试仅取得各自精确退休候选，保留合同不能伪称业务效果已验证',()=>fixture(({source,options})=>{
 const proof=collectVerificationRetirementCandidates(source,options());
 assert.deepEqual(proof.rows.map(x=>x.path).sort(),retired.toSorted());
 for(const row of proof.rows){assert.equal(row.catalog_anchor_revision,BASE);assert.equal(row.retirement_authorized,false);
  assert.equal(row.entry_verified,false);assert.equal(row.owner_verified,false);assert.ok(row.replacement_inputs.every(x=>x.selected_candidate));
  assert.ok(row.audit.retired.length);assert.ok(row.policy_sources.some(x=>x.path==='scripts/ci/debt-pg-tests.json'));}
 assert.deepEqual(verifyVerificationRetirementCandidates(source,{...options(),proof}),proof);
}));
for(const path of ['packages/brain/vitest.config.js','scripts/ci/debt-pg-tests.json',
 'packages/brain/src/__tests__/mitigation-state.test.js','packages/brain/src/alertness-actions.js','packages/brain/src/quarantine.js']){
 test('配置、实际PG入口或保留合同漂移拒绝：'+path,()=>fixture(({source,commit,options})=>{
  const file=join(source,path);writeFileSync(file,readFileSync(file,'utf8')+'\n');commit(source);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/CONFIG|POLICY|REPLACEMENT/);
 }));
}
test('候选自己重算目录不能扩展删除许可',()=>fixture(({source,control,commit,options})=>{
 const p=join(control,'config/verification-retirements',names[0]),c=JSON.parse(readFileSync(p));c.records.push({...c.records[0],path:'other.test.js'});
 writeFileSync(p,JSON.stringify(c));commit(control);assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/CATALOG_DIGEST_MISMATCH/);
}));
test('旧入口重现且改变字节不能冒充删除',()=>fixture(({source,git,commit,options})=>{
 const p=retired[0];mkdirSync(dirname(join(source,p)),{recursive:true});writeFileSync(join(source,p),git(source,'show',BASE+':'+p)+'\n// resurrected\n');commit(source);
 assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/DELETION_REQUIRED/);
}));
test('目录ce20锚必须真实位于候选基线祖先，不能只信JSON声明',()=>fixture(({source,options})=>{
 assert.throws(()=>collectVerificationRetirementCandidates(source,options('fadbf32852cdb30f71e34dda9ab81b521bda484b')),/CATALOG_BASE_ANCESTRY_MISMATCH/);
}));
