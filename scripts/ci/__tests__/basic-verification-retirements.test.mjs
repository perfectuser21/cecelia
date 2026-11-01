import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixedLocalGit} from '../fixed-local-git.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const BASE='68b996a5641b69e6f21705a114a4524e407fe097',HEAD='077efdd5d990a96a10838f77abfa1f3eb538e7fa';
const CATALOG='config/verification-retirements/alertness-v1.json';
const OLD=['diagnosis','escalation','healing','levels','metrics'].map(n=>`tests/alertness/${n}.test.js`);
let api,home,sourceRoot,controlRoot;
const git=(where,...args)=>fixedLocalGit(where,args,{encoding:'utf8'}).trim();
const needApi=()=>assert.equal(typeof api?.collectVerificationRetirementCandidates,'function','显式退休候选API必须存在');
function commit(where){git(where,'add','-A');git(where,'-c','user.name=retirement-fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');return git(where,'rev-parse','HEAD');}
function source(){return {repo:'perfectuser21/cecelia',base_revision:BASE,head_revision:git(sourceRoot,'rev-parse','HEAD'),changed_files:fixedLocalGit(sourceRoot,['diff','--no-renames','--name-only','-z',BASE,'HEAD','--'],{encoding:'utf8'}).split('\0').filter(Boolean).map(path=>({path}))};}
function options(extra={}){return {source:source(),toolingRoot:controlRoot,toolingRevision:git(controlRoot,'rev-parse','HEAD'),purpose:'admission_only',...extra};}
function reset(){git(sourceRoot,'reset','--hard',HEAD);git(sourceRoot,'clean','-fd');}
before(async()=>{
 try{api=await import('../implementation-verification-retirements.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 if(!api)return;
 home=mkdtempSync(join(tmpdir(),'verification-retirement-'));sourceRoot=join(home,'source');controlRoot=join(home,'control');
 fixedLocalGit(root,['clone','--shared','--no-checkout','--quiet',root,sourceRoot],{localClone:true});
 git(sourceRoot,'remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
 git(sourceRoot,'sparse-checkout','set','--no-cone','/packages/brain/vitest.config.js','/packages/brain/src/__tests__/alertness/','/tests/alertness/');
 git(sourceRoot,'checkout','--detach',HEAD);
 mkdirSync(controlRoot);git(controlRoot,'init','-q');git(controlRoot,'remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 mkdirSync(dirname(join(controlRoot,CATALOG)),{recursive:true});writeFileSync(join(controlRoot,CATALOG),readFileSync(join(root,CATALOG)));commit(controlRoot);
});
after(()=>{if(home)rmSync(home,{recursive:true,force:true});});
test('五个显式退休仅产生候选，保留11替代输入与三项审计限制',()=>{
 needApi();const proof=api.collectVerificationRetirementCandidates(sourceRoot,options());
 assert.equal(proof.kind,'explicit_verification_retirement');assert.equal(proof.purpose,'admission_only');
 assert.deepEqual(proof.rows.map(r=>r.path).sort(),[...OLD].sort());assert.equal(proof.limitations.length,3);
 for(const row of proof.rows){assert.equal(row.change,'D');assert.equal(row.head.absent,true);assert.equal(row.replacement_inputs.length,11);assert.equal(row.entry_verified,false);assert.equal(row.owner_verified,false);assert.equal(row.retirement_authorized,false);assert.ok(row.replacement_inputs.every(i=>i.selector_witness&&i.selected_candidate));}
 assert.equal(proof.execution_status,'not_evaluated');assert.equal(proof.coverage,'unknown');
 assert.deepEqual(api.verifyVerificationRetirementCandidates(sourceRoot,{...options(),proof}),proof);
});
test('用途main/release/recovery和伪造witness不能授权退休',()=>{
 needApi();for(const purpose of ['main_verification','main','release','recovery'])assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options({purpose})),/ADMISSION_ONLY/);
 const proof=api.collectVerificationRetirementCandidates(sourceRoot,options());proof.rows[0].retirement_authorized=true;
 assert.throws(()=>api.verifyVerificationRetirementCandidates(sourceRoot,{...options(),proof}),/MISMATCH/);
});
test('candidate改写审计JSON不能自授资格，control catalog改字节或漂移也拒绝',()=>{
 needApi();const catalog=join(controlRoot,CATALOG),original=readFileSync(catalog),control=git(controlRoot,'rev-parse','HEAD');
 try{writeFileSync(catalog,Buffer.concat([original,Buffer.from('\n')]));assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options()),/STATE|DIRTY/);commit(controlRoot);assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options()),/CATALOG/);assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options({toolingRevision:control})),/STATE|MISMATCH/);}finally{git(controlRoot,'reset','--hard',control);}
 const candidate=join(sourceRoot,CATALOG);mkdirSync(dirname(candidate),{recursive:true});writeFileSync(candidate,'{"approved":true}');commit(sourceRoot);
 try{const proof=api.collectVerificationRetirementCandidates(sourceRoot,options());assert.equal(proof.rows.length,5);assert.notEqual(proof.control.catalog_sha256,'approved');}finally{reset();}
});
test('非official68基线即使仍有五份旧测试也不能冒充审核过的旧字节',()=>{
 needApi();assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options({source:{...source(),base_revision:git(sourceRoot,'rev-parse',BASE+'^')}})),/BASE/);
});
test('A/M/R伪删除、旧路径仍存在与symlink均拒绝',()=>{
 needApi();const old=OLD[0],file=join(sourceRoot,old);mkdirSync(dirname(file),{recursive:true});
 for(const kind of ['regular','symlink']){
  try{if(kind==='symlink')symlinkSync('/tmp/foreign-test',file);else writeFileSync(file,'export const changed=true;');commit(sourceRoot);assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options()),/DELETION|ABSEN|REGULAR/);}finally{reset();mkdirSync(dirname(file),{recursive:true});}
 }
 const renamed='tests/alertness/renamed.test.js';writeFileSync(join(sourceRoot,renamed),fixedLocalGit(sourceRoot,['show',`${BASE}:${old}`]));commit(sourceRoot);
 try{assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options()),/DELETION|RENAME/);}finally{reset();}
});
test('改head配置或任一replacement字节都必须重新审核',()=>{
 needApi();for(const path of ['packages/brain/vitest.config.js','packages/brain/src/__tests__/alertness/diagnosis.test.js']){
  const file=join(sourceRoot,path);try{writeFileSync(file,Buffer.concat([readFileSync(file),Buffer.from('\n// drift\n')]));commit(sourceRoot);assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options()),/CONFIG|REPLACEMENT/);}finally{reset();}
 }
});
test('replacement symlink、dirty source与head漂移必须拒绝',()=>{
 needApi();const file=join(sourceRoot,'packages/brain/src/__tests__/alertness/diagnosis.test.js');
 try{rmSync(file);symlinkSync('/tmp/foreign-test',file);commit(sourceRoot);assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options()),/REGULAR|REPLACEMENT/);}finally{reset();}
 const original=readFileSync(file);writeFileSync(file,Buffer.concat([original,Buffer.from('\n')]));try{assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options()),/STATE|DIRTY/);}finally{reset();}
 assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options({source:{...source(),head_revision:BASE}})),/STATE|MISMATCH/);
});
test('未知删除与路径逃逸不进入五条合同，delta伪造被拒绝',()=>{
 needApi();const original=source();for(const path of ['../tests/alertness/diagnosis.test.js','/tests/alertness/diagnosis.test.js','tests/alertness/./diagnosis.test.js'])assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options({source:{...original,changed_files:[{path}]}})),/SOURCE|DELTA|PATH/);
 assert.throws(()=>api.collectVerificationRetirementCandidates(sourceRoot,options({source:{...original,changed_files:original.changed_files.filter(c=>c.path!==OLD[0])}})),/DELTA/);
});
