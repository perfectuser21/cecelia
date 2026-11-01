/** 真PG生成原生报告，真实Git和真实bash回归验证联合引擎；不是生产infra身份导出。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {releaseEvidenceDatabase} from '../../../packages/brain/src/__tests__/fixtures/release-evidence-db.js';
import {aggregateScopedImplementationEvidence,runScopedImplementationGate} from '../implementation-multi-scope.mjs';
for(const exit of [0,7])test(`main联合门必须执行第三infra回归，真实退出${exit}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'infra-three-joint-')),fixtures=[];
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');mkdirSync(join(root,'src'));mkdirSync(join(root,'tests/smoke'),{recursive:true});
  writeFileSync(join(root,'src/controller.js'),'export const x=1;');writeFileSync(join(root,'src/shared-lock.js'),'old');
  for(let i=0;i<3;i++)writeFileSync(join(root,`tests/smoke/scope-${i}.sh`),`#!/bin/bash\nprintf '${i}' > '${root}/actual-${i}'\nexit ${i===2?exit:0}\n`);
  let previous;
  const commit=()=>{git('add','.');const sha=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',git('write-tree'),...(previous?['-p',previous]:[]),'-m','fixture');git('update-ref','HEAD',sha);previous=sha;return sha;};
  const base=commit();writeFileSync(join(root,'src/shared-lock.js'),'new');const head=commit();
  const scopes=['cecelia-kr','cecelia-factory','cecelia-infra'],reports=[];
  for(const [i,scope] of scopes.entries()){
   const f=await releaseEvidenceDatabase({scope:`fixture-source-${i}`,baseRevision:base,headRevision:head,assertionRef:`tests/smoke/scope-${i}.sh`});fixtures.push(f);
   // This is the same explicit structural boundary used by the existing joint
   // engine regression; real infra identity is checked by snapshot validation.
   const report=JSON.parse(JSON.stringify(f.releaseInput.ci_evidence[0].report).replaceAll('perfectuser21/zenithjoy-workspace','perfectuser21/cecelia'));
   report.scope_key=scope;report.ci_context={purpose:'release'};reports.push(report);
  }
  const evidence=aggregateScopedImplementationEvidence({source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:head,changed_files:[{path:'src/shared-lock.js'}]},expectedScopes:scopes,reports,purpose:'main_verification'});
  const receipt=await runScopedImplementationGate({repoRoot:root,evidence});
  assert.equal(receipt.verdict,exit?'FAIL':'PASS');assert.equal(receipt.scope_receipts.length,3);assert.equal(receipt.purpose,'main_verification');
  for(let i=0;i<3;i++)assert.equal(readFileSync(join(root,`actual-${i}`),'utf8'),String(i));
  assert.equal(receipt.scope_receipts[2].assertions[0].exit_code,exit);assert.equal(receipt.business_runtime_status,'not_evaluated');
 }finally{for(const f of fixtures)await f.close();rmSync(root,{recursive:true,force:true});}
});
