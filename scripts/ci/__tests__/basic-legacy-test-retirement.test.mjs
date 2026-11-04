import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectVerificationRetirementCandidates } from '../implementation-verification-retirements.mjs';
import { planChecks } from '../basic-scope.mjs';
const root=fileURLToPath(new URL('../../../', import.meta.url));
const baseline='fadbf32852';
const old=['tick-dispatch-scope-decomposing','tick-kr-decomp'].map(x=>`packages/brain/src/__tests__/${x}.test.js`);
const config='packages/brain/vitest.config.js';
function fixture(fn) {
  const temp=mkdtempSync(join(tmpdir(),'legacy-test-retirement-')), source=join(temp,'source'), control=join(temp,'control');
  const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1'}}).trim();
  const commit=dir=>{git(dir,'add','-A');git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','test: reviewed fixture');return git(dir,'rev-parse','HEAD');};
  try {
    execFileSync('git',['clone','--shared','--no-checkout','-q',root,source]);
    git(source,'sparse-checkout','init','--no-cone');
    git(source,'sparse-checkout','set','/packages/brain/vitest.config.js','/packages/brain/src/__tests__/*','/scripts/ci/skill-source-tests.mjs');
    git(source,'checkout','-q',baseline);git(source,'remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
    const base=git(source,'rev-parse','HEAD');
    for(const path of old)rmSync(join(source,path));
    writeFileSync(join(source,config),readFileSync(join(root,config)));
    const head=commit(source);
    mkdirSync(control);git(control,'init','-q');git(control,'remote','add','origin','https://github.com/perfectuser21/cecelia.git');
    cpSync(join(root,'config/verification-retirements'),join(control,'config/verification-retirements'),{recursive:true});
    const tooling=commit(control);
    const options=()=>({purpose:'admission_only',toolingRoot:control,toolingRevision:git(control,'rev-parse','HEAD'),source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:git(source,'rev-parse','HEAD'),changed_files:git(source,'diff','--name-only',base,'HEAD').split('\n').filter(Boolean).map(path=>({path}))}});
    fn({source,control,git,commit,options,head,tooling});
  }finally{rmSync(temp,{recursive:true,force:true});}
}
test('仅冻结过的两份复制SQL测试取得精确退役候选，替代必须为真实生产入口测试',()=>fixture(({source,options})=>{
  const proof=collectVerificationRetirementCandidates(source,options());
  assert.deepEqual(proof.rows.map(x=>x.path).sort(),old.toSorted());
  for(const row of proof.rows){assert.equal(row.retirement_authorized,false);assert.ok(row.replacement_inputs.every(x=>x.selected_candidate));assert.ok(row.audit.retired.length);}
}));
test('旧测试字节漂移与任意未列删除不能借退役合同放行',()=>fixture(({source,git,commit,options,head})=>{
  const other='packages/brain/src/__tests__/tick-suggestion-integration.test.js';
  rmSync(join(source,other));commit(source);
  const proof=collectVerificationRetirementCandidates(source,options());
  assert.equal(proof.rows.some(x=>x.path===other),false);
  git(source,'reset','--hard',head);
  const path=old[0],bytes=git(source,'show',`${options().source.base_revision}:${path}`);
  mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),bytes+'\n// drift\n');commit(source);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/DELETION|ABSENCE/);
}));
test('替代行为字节漂移必须拒绝，不能靠catalog声明替代',()=>fixture(({source,commit,options})=>{
  const path='packages/brain/src/__tests__/tick-scheduler.test.js';writeFileSync(join(source,path),readFileSync(join(source,path),'utf8')+'\n// drift\n');commit(source);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/REPLACEMENT/);
}));
test('现役整组件selector覆盖运行时读源码变更，不需要旧fs grep补选器',()=>{
  for(const path of ['packages/brain/src/tick-loop.js','packages/brain/src/tick-scheduler.js']){
    const jobs=planChecks([path]);assert.equal(jobs.filter(x=>x.component==='brain-unit').length,6);
    assert.ok(jobs.some(x=>x.component==='brain-integration'));
  }
});
