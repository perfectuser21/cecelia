import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { readImplementationImpact } from '../../implementation-impact.js';
import * as multi from '../../../../../../scripts/ci/implementation-multi-scope.mjs';
import * as pr from '../../../../../../scripts/ci/implementation-pr-gate.mjs';
import * as caller from '../../../../../../scripts/ci/implementation-multi-pr-gate.mjs';
let a,b,reports,source;
beforeEach(async()=>{
 a=await releaseEvidenceDatabase({scope:'cecelia-kr'});b=await releaseEvidenceDatabase({scope:'cecelia-factory'});
 const r=a.releaseInput.ci_evidence[0].report;
 source={...r.source,changed_files:[{path:'src/shared-lock.js'},{path:'src/controller.js'}]};
 reports=[r,await readImplementationImpact(b.db,{scope:'cecelia-factory',repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision,changed_files:[{path:'src/controller.js'}]})];
});
afterEach(async()=>{await a?.close();await b?.close();});
it('正式报告collector在进入scratch前拒绝无效固定来源，不将收集报告称为验收',async()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'multi-collect-invalid-'));
 try{
  expect(pr.collectImplementationPrEvidence).toBeTypeOf('function');
  await expect(pr.collectImplementationPrEvidence({repoRoot:outputDir,scope:'cecelia-factory',base:'a'.repeat(40),head:'b'.repeat(40),mode:'invalid',outputDir})).rejects.toThrow('INPUT_INVALID');
 }finally{rmSync(outputDir,{recursive:true,force:true});}
});
it('正式联合PR入口拒绝重复scope与main发布模式，不把consumer来源证据作运行release',async()=>{
 expect(caller.runImplementationMultiPrGate).toBeTypeOf('function');
 const outputDir=mkdtempSync(join(tmpdir(),'multi-entry-invalid-'));
 try{
  const options={repoRoot:outputDir,base:'a'.repeat(40),head:'b'.repeat(40),mode:'pr',outputDir,scopes:[{scope:'cecelia-kr'},{scope:'cecelia-kr'}]};
  await expect(caller.runImplementationMultiPrGate(options)).rejects.toThrow('SCOPES_INVALID');
  await expect(caller.runImplementationMultiPrGate({...options,mode:'main'})).rejects.toThrow('ADMISSION_ONLY');
 }finally{rmSync(outputDir,{recursive:true,force:true});}
});
it('真实PG两scope报告按明确切片保留各投影，联合覆盖完整差异并不伪造单一投影',()=>{
 expect(multi.aggregateScopedImplementationEvidence).toBeTypeOf('function');
 const proof=multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','cecelia-factory'],reports});
 expect(proof.source.changed_files).toEqual(source.changed_files);expect(proof.scope_reports).toHaveLength(2);
 expect(proof.scope_reports.map(r=>r.head.projection.projection_run_id)).toEqual(reports.map(r=>r.head.projection.projection_run_id));
 expect(proof.file_coverage.map(f=>f.path)).toEqual(source.changed_files.map(f=>f.path));
 expect(proof.business_runtime_status).toBe('not_evaluated');expect(proof).not.toHaveProperty('head.projection');
});
it('缺整个scope或漏一个Git文件都拒绝，不以另一scope通过标签代替',()=>{
 expect(()=>multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','cecelia-factory'],reports:[reports[0]]})).toThrow();
 expect(()=>multi.aggregateScopedImplementationEvidence({source:{...source,changed_files:[...source.changed_files,{path:'migrations/unknown.sql'}]},expectedScopes:['cecelia-kr','cecelia-factory'],reports})).toThrow();
});
it('真实UNKNOWN、缺断言、截断图、错误repo/SHA必须保留并拒绝',()=>{
 for(const change of [r=>r.gaps.push({code:'regression_missing'}),r=>r.required_assertions=[],r=>r.head.traversal.truncated=true,r=>r.source.repo='other/repo',r=>r.source.head_revision='c'.repeat(40)]){
  const altered=structuredClone(reports);change(altered[1]);expect(()=>multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','cecelia-factory'],reports:altered})).toThrow();
 }
});

it('真实PG全差异报告仅用另一scope真实原生调用闭包消解foreign unclaimed，保留所有其它UNKNOWN',async()=>{
 await b.db.query("UPDATE graph_edge_snapshots SET dst_path='src/factory-deploy.js' WHERE dst_path='src/shared-lock.js'");
 const full={...source,changed_files:[{path:'src/shared-lock.js'},{path:'src/factory-deploy.js'}]};
 const raw=[];
 for(const [db,scope] of [[a.db,'cecelia-kr'],[b.db,'cecelia-factory']])raw.push(await readImplementationImpact(db,{scope,repo:full.repo,base_revision:full.base_revision,head_revision:full.head_revision,changed_files:full.changed_files}));
 expect(raw.every(r=>r.mapping_status==='unknown')).toBe(true);
 expect(multi.resolveScopedImplementationReports).toBeTypeOf('function');
 const proof=multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','cecelia-factory'],reports:raw});
 expect(proof.evidence.file_coverage.map(f=>f.claims.map(c=>c.scope_key))).toEqual([['cecelia-kr'],['cecelia-factory']]);
 expect(proof.resolved_foreign_paths).toHaveLength(2);
 for(const gap of [{code:'regression_missing'},{code:'auxiliary_owner_unclaimed',path:'src/factory-deploy.js'}]){
  const altered=structuredClone(raw);altered[0].gaps.push(gap);
  expect(()=>multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','cecelia-factory'],reports:altered})).toThrow();
 }
});

it('组合准入必须核真实Git完整差异与祖先，不能拿领域切片冒完整diff',()=>{
 const root=mkdtempSync(join(tmpdir(),'multi-scope-source-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('remote','add','origin','https://github.com/'+source.repo+'.git');
  mkdirSync(join(root,'src'));for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'export const old=true;\n');
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
  const base=commit();for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'export const changed=true;\n');const head=commit();
  const src={...source,base_revision:base,head_revision:head},parts=structuredClone(reports);
  for(const part of parts){part.source.base_revision=base;part.source.head_revision=head;for(const side of ['base','head']){part[side].revision=src[`${side}_revision`];part[side].graph_snapshot.source_revision=src[`${side}_revision`];}}
  const proof=multi.aggregateScopedImplementationEvidence({source:src,expectedScopes:['cecelia-kr','cecelia-factory'],reports:parts});
  expect(multi.verifyScopedImplementationGitSource).toBeTypeOf('function');
  expect(()=>multi.verifyScopedImplementationGitSource(root,proof)).not.toThrow();
  const incomplete=multi.aggregateScopedImplementationEvidence({source:{...src,changed_files:[src.changed_files[0]]},expectedScopes:['cecelia-kr'],reports:[parts[0]]});
  expect(()=>multi.verifyScopedImplementationGitSource(root,incomplete)).toThrow('IMPACT_MULTISCOPE_DIFF_MISMATCH');
  writeFileSync(join(root,'src/controller.js'),'dirty\n');expect(()=>multi.verifyScopedImplementationGitSource(root,proof)).toThrow('IMPACT_MULTISCOPE_SOURCE_DIRTY');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('联合准入实际执行每scope固定提交回归并保存独立收据，任一失败拒绝PASS',async()=>{
 const root=mkdtempSync(join(tmpdir(),'multi-scope-gate-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('remote','add','origin','https://github.com/'+source.repo+'.git');mkdirSync(join(root,'src'));mkdirSync(join(root,'tests/smoke'),{recursive:true});
  for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'old\n');
  writeFileSync(join(root,'tests/smoke/scope-a.sh'),'#!/bin/bash\nexit 0\n');writeFileSync(join(root,'tests/smoke/scope-b.sh'),'#!/bin/bash\nexit 7\n');
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
  const base=commit();for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'changed\n');const head=commit();
  const src={...source,base_revision:base,head_revision:head},parts=structuredClone(reports);
  for(const [i,part] of parts.entries()){
   part.source.base_revision=base;part.source.head_revision=head;
   for(const side of ['base','head']){part[side].revision=src[`${side}_revision`];part[side].graph_snapshot.source_revision=src[`${side}_revision`];}
   for(const assertion of part.required_assertions){assertion.assertion_ref=`tests/smoke/scope-${i?'b':'a'}.sh`;assertion.source_repo=src.repo;}
  }
  const evidence=multi.aggregateScopedImplementationEvidence({source:src,expectedScopes:['cecelia-kr','cecelia-factory'],reports:parts});
  expect(multi.runScopedImplementationGate).toBeTypeOf('function');
  const receipt=await multi.runScopedImplementationGate({repoRoot:root,evidence});
  expect(receipt.verdict).toBe('FAIL');expect(receipt.scope_receipts.map(r=>r.scope_key)).toEqual(['cecelia-kr','cecelia-factory']);
  expect(receipt.scope_receipts[0].assertions.every(a=>a.exit_code===0)).toBe(true);
  expect(receipt.scope_receipts[1].assertions.every(a=>a.exit_code===7)).toBe(true);
  expect(receipt.business_runtime_status).toBe('not_evaluated');
 }finally{rmSync(root,{recursive:true,force:true});}
});
