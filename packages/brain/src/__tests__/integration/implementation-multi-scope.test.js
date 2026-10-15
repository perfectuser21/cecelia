import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,chmodSync} from 'node:fs';
import yaml from 'js-yaml';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import { beforeEach,afterEach,it,expect } from 'vitest';
import { releaseEvidenceDatabase } from '../fixtures/release-evidence-db.js';
import { readImplementationImpact } from '../../lib/implementation-impact.js';
import * as multi from '../../../../../scripts/ci/implementation-multi-scope.mjs';
import * as pr from '../../../../../scripts/ci/implementation-pr-gate.mjs';
import * as caller from '../../../../../scripts/ci/implementation-multi-pr-gate.mjs';
import {collectAuxiliarySourceEvidence,applyAuxiliarySourceEvidence} from '../../../../../scripts/ci/implementation-auxiliary-evidence.mjs';
let a,b,reports,source;

it('真实两scope辅助owner联合闭包保留原始UNKNOWN，并独立覆盖共享manifest',async()=>{
 const root=mkdtempSync(join(tmpdir(),'multi-aux-owner-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('remote','add','origin','https://github.com/'+source.repo+'.git');
  mkdirSync(join(root,'src'));mkdirSync(join(root,'docs'));mkdirSync(join(root,'tests/smoke'),{recursive:true});
  writeFileSync(join(root,'tests/smoke/scope-a.sh'),'#!/bin/bash\nexit 0\n');
  writeFileSync(join(root,'tests/smoke/scope-b.sh'),'#!/bin/bash\nexit 0\n');
  const rows=[{owner_path:'src/shared-lock.js',path:'docs/alpha.md',role:'documentation'},
   {owner_path:'src/factory-deploy.js',path:'docs/beta.md',role:'documentation'},
   {owner_path:'src/factory-deploy.js',path:'tests/smoke/scope-b.sh',role:'verification'}];
  for(const file of ['src/shared-lock.js','src/factory-deploy.js'])writeFileSync(join(root,file),'export const old=true;\n');
  for(const file of ['docs/alpha.md','docs/beta.md'])writeFileSync(join(root,file),'old\n');
  const manifest={schema_version:1,repo:source.repo,relations:rows};
  writeFileSync(join(root,'.implementation-source-relations.json'),JSON.stringify(manifest));
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
  const base=commit();
  for(const file of ['src/shared-lock.js','src/factory-deploy.js'])writeFileSync(join(root,file),'export const updated=true;\n');
  for(const file of ['docs/alpha.md','docs/beta.md'])writeFileSync(join(root,file),'updated\n');
  writeFileSync(join(root,'.implementation-source-relations.json'),JSON.stringify(manifest,null,2)+'\n');
  const head=commit();
  await a.close();await b.close();
  a=await releaseEvidenceDatabase({scope:'cecelia-kr',baseRevision:base,headRevision:head,assertionRef:'manual:bash tests/smoke/scope-a.sh'});
  b=await releaseEvidenceDatabase({scope:'fixture-second-source',baseRevision:base,headRevision:head,assertionRef:'manual:bash tests/smoke/scope-b.sh'});
  await b.db.query("UPDATE graph_edge_snapshots SET dst_path='src/factory-deploy.js' WHERE dst_path='src/shared-lock.js'");
  const full={repo:source.repo,base_revision:base,head_revision:head,changed_files:git('diff','--no-renames','--name-only',base,head).split('\n').map(path=>({path}))};
  const auxiliary=collectAuxiliarySourceEvidence(root,full),raw=[];
  for(const [db,scope] of [[a.db,'cecelia-kr'],[b.db,'fixture-second-source']]){
   const report=await readImplementationImpact(db,{scope,repo:full.repo,base_revision:base,head_revision:head,changed_files:full.changed_files});
   const owners={};for(const side of ['base','head'])owners[side]=[...new Set(rows.map(row=>row.owner_path))].map(path=>report[side].file_coverage.find(f=>f.path===path)).map(({path,matched_paths,truncated})=>({path,matched_paths,truncated}));
   applyAuxiliarySourceEvidence(report,auxiliary,owners);raw.push(report);
  }
  expect(raw.every(r=>r.gaps.some(g=>g.code==='auxiliary_owner_unclaimed'))).toBe(true);
  const proof=multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','fixture-second-source'],reports:raw});
  expect(proof.source_reports).toEqual(raw);
  expect(proof.evidence.auxiliary_scope_context.owner_claims.length).toBe(4);
  const joint=proof.evidence.file_coverage.find(f=>f.path==='.implementation-source-relations.json');
  expect(joint.claims.every(c=>c.coverage_kind==='scoped_auxiliary_source')).toBe(true);
  expect(proof.evidence.scope_reports.every(r=>r.affected_usages.every(u=>raw.find(x=>x.scope_key===r.scope_key).affected_usages.some(v=>v.reference_id===u.reference_id)))).toBe(true);
  expect(()=>multi.verifyScopedImplementationGitSource(root,proof.evidence)).not.toThrow();
  const forgedParts=structuredClone(proof.evidence.scope_reports);
  forgedParts[0].head.graph_snapshot.digest='e'.repeat(64);
  expect(()=>multi.aggregateScopedImplementationEvidence({source:full,expectedScopes:['cecelia-kr','fixture-second-source'],reports:forgedParts,auxiliary_scope_context:proof.evidence.auxiliary_scope_context})).toThrow('IMPACT_MULTISCOPE_AUXILIARY_CONTEXT_MISMATCH');
  const success=await multi.runScopedImplementationGate({repoRoot:root,evidence:proof.evidence});
  expect(success.verdict).toBe('PASS');expect(success.auxiliary_scope_receipt.verdict).toBe('PASS');
  expect(success.scope_receipts).toHaveLength(2);
  for(const change of [r=>r[0].gaps.push({code:'regression_missing'}),r=>r[1].auxiliary_source_evidence.head.relations[0].owner_sha256='f'.repeat(64),r=>r[1].source.repo='foreign/repo',r=>r[1].auxiliary_source_evidence.owner_coverage.head.find(o=>o.path==='src/factory-deploy.js').matched_paths=[],r=>r[1].required_assertions=[]]){
   const altered=structuredClone(raw);change(altered);
   expect(()=>multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','fixture-second-source'],reports:altered})).toThrow();
  }
  await b.db.query("DELETE FROM graph_edge_snapshots WHERE dst_path='src/factory-deploy.js'");
  const missing=await readImplementationImpact(b.db,{scope:'fixture-second-source',repo:full.repo,base_revision:base,head_revision:head,changed_files:full.changed_files});
  const noOwners={};for(const side of ['base','head'])noOwners[side]=[...new Set(rows.map(row=>row.owner_path))].map(path=>missing[side].file_coverage.find(f=>f.path===path)).map(({path,matched_paths,truncated})=>({path,matched_paths,truncated}));
  applyAuxiliarySourceEvidence(missing,auxiliary,noOwners);
  expect(()=>multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','fixture-second-source'],reports:[raw[0],missing]})).toThrow('IMPACT_MULTISCOPE_AUXILIARY_OWNER_UNKNOWN');
  // Another real immutable Git/PG source fixes the failing child to exit 7; no environment injection.
  writeFileSync(join(root,'tests/smoke/scope-b.sh'),'#!/bin/bash\nexit 7\n');
  const failingHead=commit();await a.close();await b.close();
  a=await releaseEvidenceDatabase({scope:'cecelia-kr',baseRevision:base,headRevision:failingHead,assertionRef:'manual:bash tests/smoke/scope-a.sh'});
  b=await releaseEvidenceDatabase({scope:'fixture-second-source',baseRevision:base,headRevision:failingHead,assertionRef:'manual:bash tests/smoke/scope-b.sh'});
  await b.db.query("UPDATE graph_edge_snapshots SET dst_path='src/factory-deploy.js' WHERE dst_path='src/shared-lock.js'");
  const failedSource={repo:source.repo,base_revision:base,head_revision:failingHead,changed_files:git('diff','--no-renames','--name-only',base,failingHead).split('\n').map(path=>({path}))};
  const failedAux=collectAuxiliarySourceEvidence(root,failedSource),failedRaw=[];
  for(const [db,scope] of [[a.db,'cecelia-kr'],[b.db,'fixture-second-source']]){
    const r=await readImplementationImpact(db,{scope,repo:failedSource.repo,base_revision:base,head_revision:failingHead,changed_files:failedSource.changed_files});
    const owners={};for(const side of ['base','head'])owners[side]=[...new Set(rows.map(row=>row.owner_path))].map(path=>r[side].file_coverage.find(f=>f.path===path)).map(({path,matched_paths,truncated})=>({path,matched_paths,truncated}));
    applyAuxiliarySourceEvidence(r,failedAux,owners);failedRaw.push(r);
  }
  const failedProof=multi.resolveScopedImplementationReports({source:failedSource,expectedScopes:['cecelia-kr','fixture-second-source'],reports:failedRaw});
  const failure=await multi.runScopedImplementationGate({repoRoot:root,evidence:failedProof.evidence});
  expect(failure.verdict).toBe('FAIL');expect(failure.scope_receipts[1].assertions.some(a=>a.exit_code===7)).toBe(true);

 }finally{rmSync(root,{recursive:true,force:true});}
});
beforeEach(async()=>{
 a=await releaseEvidenceDatabase({scope:'cecelia-kr'});b=await releaseEvidenceDatabase({scope:'fixture-second-source'});
 const r=a.releaseInput.ci_evidence[0].report;
 source={...r.source,changed_files:[{path:'src/shared-lock.js'},{path:'src/controller.js'}]};
 reports=[r,await readImplementationImpact(b.db,{scope:'fixture-second-source',repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision,changed_files:[{path:'src/controller.js'}]})];
});
afterEach(async()=>{await a?.close();await b?.close();});
it('正式报告collector在进入scratch前拒绝无效固定来源，不将收集报告称为验收',async()=>{
 const outputDir=mkdtempSync(join(tmpdir(),'multi-collect-invalid-'));
 try{
  expect(pr.collectImplementationPrEvidence).toBeTypeOf('function');
  await expect(pr.collectImplementationPrEvidence({repoRoot:outputDir,scope:'fixture-second-source',base:'a'.repeat(40),head:'b'.repeat(40),mode:'invalid',outputDir})).rejects.toThrow('INPUT_INVALID');
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
 const proof=multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','fixture-second-source'],reports});
 expect(proof.source.changed_files).toEqual(source.changed_files);expect(proof.scope_reports).toHaveLength(2);
 expect(proof.scope_reports.map(r=>r.head.projection.projection_run_id)).toEqual(reports.map(r=>r.head.projection.projection_run_id));
 expect(proof.file_coverage.map(f=>f.path)).toEqual(source.changed_files.map(f=>f.path));
 expect(proof.business_runtime_status).toBe('not_evaluated');expect(proof).not.toHaveProperty('head.projection');
});
it('缺整个scope或漏一个Git文件都拒绝，不以另一scope通过标签代替',()=>{
 expect(()=>multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','fixture-second-source'],reports:[reports[0]]})).toThrow();
 expect(()=>multi.aggregateScopedImplementationEvidence({source:{...source,changed_files:[...source.changed_files,{path:'migrations/unknown.sql'}]},expectedScopes:['cecelia-kr','fixture-second-source'],reports})).toThrow();
});
it('真实UNKNOWN、缺断言、截断图、错误repo/SHA必须保留并拒绝',()=>{
 for(const change of [r=>r.gaps.push({code:'regression_missing'}),r=>r.required_assertions=[],r=>r.head.traversal.truncated=true,r=>r.source.repo='other/repo',r=>r.source.head_revision='c'.repeat(40)]){
  const altered=structuredClone(reports);change(altered[1]);expect(()=>multi.aggregateScopedImplementationEvidence({source,expectedScopes:['cecelia-kr','fixture-second-source'],reports:altered})).toThrow();
 }
});

it('真实PG全差异报告仅用另一scope真实原生调用闭包消解foreign unclaimed，保留所有其它UNKNOWN',async()=>{
 await b.db.query("UPDATE graph_edge_snapshots SET dst_path='src/factory-deploy.js' WHERE dst_path='src/shared-lock.js'");
 const full={...source,changed_files:[{path:'src/shared-lock.js'},{path:'src/factory-deploy.js'}]};
 const raw=[];
 for(const [db,scope] of [[a.db,'cecelia-kr'],[b.db,'fixture-second-source']])raw.push(await readImplementationImpact(db,{scope,repo:full.repo,base_revision:full.base_revision,head_revision:full.head_revision,changed_files:full.changed_files}));
 expect(raw.every(r=>r.mapping_status==='unknown')).toBe(true);
 expect(multi.resolveScopedImplementationReports).toBeTypeOf('function');
 const proof=multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','fixture-second-source'],reports:raw});
 expect(proof.evidence.file_coverage.map(f=>f.claims.map(c=>c.scope_key))).toEqual([['cecelia-kr'],['fixture-second-source']]);
 expect(proof.resolved_foreign_paths).toHaveLength(2);
 for(const gap of [{code:'regression_missing'},{code:'auxiliary_owner_unclaimed',path:'src/factory-deploy.js'}]){
  const altered=structuredClone(raw);altered[0].gaps.push(gap);
  expect(()=>multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','fixture-second-source'],reports:altered})).toThrow();
 }
 for(const change of [r=>r.gaps=[],r=>r.head.mapping_status='unknown']){
  const altered=structuredClone(raw);change(altered[0]);
  expect(()=>multi.resolveScopedImplementationReports({source:full,expectedScopes:['cecelia-kr','fixture-second-source'],reports:altered})).toThrow();
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
  const proof=multi.aggregateScopedImplementationEvidence({source:src,expectedScopes:['cecelia-kr','fixture-second-source'],reports:parts});
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
  const evidence=multi.aggregateScopedImplementationEvidence({source:src,expectedScopes:['cecelia-kr','fixture-second-source'],reports:parts});
  expect(multi.runScopedImplementationGate).toBeTypeOf('function');
  const receipt=await multi.runScopedImplementationGate({repoRoot:root,evidence});
  expect(receipt.verdict).toBe('FAIL');expect(receipt.scope_receipts.map(r=>r.scope_key)).toEqual(['cecelia-kr','fixture-second-source']);
  expect(receipt.scope_receipts[0].assertions.every(a=>a.exit_code===0)).toBe(true);
  expect(receipt.scope_receipts[1].assertions.every(a=>a.exit_code===7)).toBe(true);
  expect(receipt.business_runtime_status).toBe('not_evaluated');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it.each([0,7])('main联合证据保留真实用途并执行每scope回归，PR输出不变 %i',async failureExit=>{
 const root=mkdtempSync(join(tmpdir(),'multi-main-gate-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');mkdirSync(join(root,'src'));mkdirSync(join(root,'tests/smoke'),{recursive:true});
  for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'old\n');
  for(const name of ['a','b'])writeFileSync(join(root,`tests/smoke/scope-${name}.sh`),`#!/bin/bash\nprintf '${name}' > '${root}/actual-${name}'\nexit ${name==='b'?failureExit:0}\n`);
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
  const base=commit();for(const name of ['controller.js','shared-lock.js'])writeFileSync(join(root,'src',name),'changed\n');const head=commit();
  // 联合引擎的结构夹具使用支持的身份封套；不声称它是官方Factory导出。
  // 完整CLI的来源真实性另由固定官方bundle与真实Git验收。
  const src={...source,repo:'perfectuser21/cecelia',base_revision:base,head_revision:head};
  const parts=JSON.parse(JSON.stringify(reports).replaceAll(source.repo,src.repo).replaceAll('fixture-second-source','cecelia-factory'));
  for(const [i,part] of parts.entries()){
   part.source.base_revision=base;part.source.head_revision=head;part.ci_context={purpose:'release'};
   for(const side of ['base','head']){part[side].revision=src[`${side}_revision`];part[side].graph_snapshot.source_revision=src[`${side}_revision`];}
   for(const assertion of part.required_assertions){assertion.assertion_ref=`tests/smoke/scope-${i?'b':'a'}.sh`;assertion.source_repo=src.repo;}
  }
  const options={source:src,expectedScopes:['cecelia-kr','cecelia-factory'],reports:parts};
  const legacy=multi.aggregateScopedImplementationEvidence(options);
  const evidence=multi.aggregateScopedImplementationEvidence({...options,purpose:'main_verification'});
  expect(legacy.purpose).toBe('admission_only');expect(evidence.purpose).toBe('main_verification');expect(evidence.evidence_kind).toBe('scoped_implementation_main');
  const receipt=await multi.runScopedImplementationGate({repoRoot:root,evidence});
  expect(receipt.verdict).toBe(failureExit?'FAIL':'PASS');expect(receipt.purpose).toBe('main_verification');expect(receipt.scope_receipts.every(r=>r.purpose==='main_verification')).toBe(true);
  expect(receipt.scope_receipts[1].assertions.every(a=>a.exit_code===failureExit)).toBe(true);
  expect(receipt.business_runtime_status).toBe('not_evaluated');for(const name of ['a','b'])expect(readFileSync(join(root,`actual-${name}`),'utf8')).toBe(name);
  expect(multi.aggregateScopedImplementationEvidence(options)).toEqual(legacy);
  for(const purpose of ['release','pr','unknown'])expect(()=>multi.aggregateScopedImplementationEvidence({...options,purpose})).toThrow();
  for(const changed of [{source:{...src,repo:'other/repo'}},{expectedScopes:['cecelia-kr']},{expectedScopes:['cecelia-kr','other']},{expectedScopes:['cecelia-factory','cecelia-kr']}])expect(()=>multi.aggregateScopedImplementationEvidence({...options,...changed,purpose:'main_verification'})).toThrow('IMPACT_MULTISCOPE_MAIN_SOURCE_INVALID');
  parts[1].ci_context.purpose='admission_only';expect(()=>multi.aggregateScopedImplementationEvidence({...options,purpose:'main_verification'})).toThrow();
  expect(()=>multi.verifyScopedImplementationGitSource(root,{...evidence,purpose:'admission_only'})).toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('真实Factory scope拒绝泛用执行workflow fixture，不借别scope覆盖缺消费者定义', async () => {
 await expect(releaseEvidenceDatabase({ scope: 'cecelia-factory' })).rejects.toMatchObject({
  code:'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED',status:422
 });
});

it('真实workflow shell仅显式PR scopes调用联合入口，main仍单scope真实release路径',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const script=workflow.jobs.gate.steps.find(s=>s.name==='实际变更影响与固定回归').run;
 const root=mkdtempSync(join(tmpdir(),'multi-workflow-entry-'));
 try{
  const capture=join(root,'args'),node=join(root,'node');writeFileSync(node,'#!/bin/bash\nprintf "%s\\n" "$@" > "$CALL_CAPTURE"\n');chmodSync(node,0o700);
  mkdirSync(join(root,'implementation-input/base'),{recursive:true});mkdirSync(join(root,'implementation-input/head'),{recursive:true});mkdirSync(join(root,'implementation-output'));
  const env={...process.env,PATH:root+':'+process.env.PATH,CALL_CAPTURE:capture,RUNNER_TEMP:root,GITHUB_WORKSPACE:root,BASE:'a'.repeat(40),HEAD:'b'.repeat(40),MAP_SCOPE:'cecelia-kr',ADMISSION_SCOPES:'{"schema_version":1,"scopes":["cecelia-kr","cecelia-factory"]}',MODE:'pr'};
  execFileSync('/bin/bash',['-c',script],{env});expect(readFileSync(capture,'utf8')).toContain('implementation-multi-pr-gate.mjs');
  const scopes=JSON.parse(readFileSync(join(root,'implementation-input/scopes.json'),'utf8'));expect(scopes.map(s=>s.scope)).toEqual(['cecelia-kr','cecelia-factory']);
  for(const value of [JSON.stringify({schema_version:99,scopes:['cecelia-kr']}),JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-kr']}),JSON.stringify({schema_version:1,scopes:['cecelia-kr'],execute:true})]){
   expect(()=>execFileSync('/bin/bash',['-c',script],{env:{...env,ADMISSION_SCOPES:value},stdio:'pipe'})).toThrow();
  }
  execFileSync('/bin/bash',['-c',script],{env:{...env,ADMISSION_SCOPES:''}});expect(readFileSync(capture,'utf8')).toContain('implementation-pr-gate.mjs');
  execFileSync('/bin/bash',['-c',script],{env:{...env,MODE:'main'}});expect(readFileSync(capture,'utf8')).toContain('implementation-pr-gate.mjs');expect(readFileSync(capture,'utf8')).not.toContain('implementation-multi-pr-gate.mjs');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('真实workflow shell仅显式PR scopes调用联合入口，main仍单scope真实release路径',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const script=workflow.jobs.gate.steps.find(s=>s.name==='实际变更影响与固定回归').run;
 const root=mkdtempSync(join(tmpdir(),'multi-workflow-entry-'));
 try{
  const capture=join(root,'args'),node=join(root,'node');writeFileSync(node,'#!/bin/bash\nprintf "%s\\n" "$@" > "$CALL_CAPTURE"\n');chmodSync(node,0o700);
  mkdirSync(join(root,'implementation-input/base'),{recursive:true});mkdirSync(join(root,'implementation-input/head'),{recursive:true});mkdirSync(join(root,'implementation-output'));
  const env={...process.env,PATH:root+':'+process.env.PATH,CALL_CAPTURE:capture,RUNNER_TEMP:root,GITHUB_WORKSPACE:root,BASE:'a'.repeat(40),HEAD:'b'.repeat(40),MAP_SCOPE:'cecelia-kr',ADMISSION_SCOPES:'{"schema_version":1,"scopes":["cecelia-kr","cecelia-factory"]}',MODE:'pr'};
  execFileSync('/bin/bash',['-c',script],{env});expect(readFileSync(capture,'utf8')).toContain('implementation-multi-pr-gate.mjs');
  const scopes=JSON.parse(readFileSync(join(root,'implementation-input/scopes.json'),'utf8'));expect(scopes.map(s=>s.scope)).toEqual(['cecelia-kr','cecelia-factory']);
  for(const value of [JSON.stringify({schema_version:99,scopes:['cecelia-kr']}),JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-kr']}),JSON.stringify({schema_version:1,scopes:['cecelia-kr'],execute:true})]){
   expect(()=>execFileSync('/bin/bash',['-c',script],{env:{...env,ADMISSION_SCOPES:value},stdio:'pipe'})).toThrow();
  }
  execFileSync('/bin/bash',['-c',script],{env:{...env,ADMISSION_SCOPES:''}});expect(readFileSync(capture,'utf8')).toContain('implementation-pr-gate.mjs');
  execFileSync('/bin/bash',['-c',script],{env:{...env,MODE:'main'}});expect(readFileSync(capture,'utf8')).toContain('implementation-pr-gate.mjs');expect(readFileSync(capture,'utf8')).not.toContain('implementation-multi-pr-gate.mjs');
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Real PG/Git fixture, with the supported self/pair envelope applied explicitly.
// This does not claim the synthetic consumer definitions came from the central Factory API.
async function noOwnedFixture({purpose='admission_only',exit=0,emptyIndex=0,orphan=false}={}){
 const root=mkdtempSync(join(tmpdir(),'multi-no-owned-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/cecelia.git');
 for(const dir of ['src','docs','tests/smoke'])mkdirSync(join(root,dir),{recursive:true});
 for(const file of ['src/shared-lock.js','src/factory-deploy.js'])writeFileSync(join(root,file),'old\n');
 for(const file of ['docs/alpha.md','docs/beta.md'])writeFileSync(join(root,file),'documentation\n');
 for(const name of ['a','a2','b'])writeFileSync(join(root,`tests/smoke/scope-${name}.sh`),`#!/bin/bash\nprintf '${name}' > '${root}/actual-${name}'\nexit ${name===(emptyIndex?'b':'a')?exit:0}\n`);
 const relations=[{owner_path:'src/shared-lock.js',path:'docs/alpha.md',role:'documentation'},
  {owner_path:'src/factory-deploy.js',path:'docs/beta.md',role:'documentation'}];
 writeFileSync(join(root,'.implementation-source-relations.json'),JSON.stringify({schema_version:1,repo:'perfectuser21/cecelia',relations}));
 const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
 const base=commit();writeFileSync(join(root,emptyIndex?'docs/alpha.md':'docs/beta.md'),'updated\n');
 if(orphan)writeFileSync(join(root,'docs/orphan.md'),'unclaimed\n');
 const head=commit();await a.close();await b.close();
 a=await releaseEvidenceDatabase({scope:'cecelia-kr',baseRevision:base,headRevision:head,assertionRef:'manual:bash tests/smoke/scope-a.sh'});
 b=await releaseEvidenceDatabase({scope:'fixture-second-source',baseRevision:base,headRevision:head,assertionRef:'manual:bash tests/smoke/scope-b.sh'});
 await b.db.query("UPDATE graph_edge_snapshots SET dst_path='src/factory-deploy.js' WHERE dst_path='src/shared-lock.js'");
 const full={repo:'perfectuser21/cecelia',base_revision:base,head_revision:head,changed_files:git('diff','--no-renames','--name-only',base,head).split('\n').map(path=>({path}))};
 const auxiliary=collectAuxiliarySourceEvidence(root,full),raw=[];
 const owners=relations.map(row=>row.owner_path),query=[...full.changed_files,...owners.map(path=>({path}))];
 for(const [db,scope] of [[a.db,'cecelia-kr'],[b.db,'fixture-second-source']]){
  const original=await readImplementationImpact(db,{scope,repo:source.repo,base_revision:base,head_revision:head,changed_files:query});
  const report=JSON.parse(JSON.stringify(original).replaceAll(source.repo,full.repo).replaceAll('fixture-second-source','cecelia-factory'));
  const ownerCoverage={};for(const side of ['base','head']){
   ownerCoverage[side]=owners.map(path=>report[side].file_coverage.find(f=>f.path===path)).map(({path,matched_paths,truncated})=>({path,matched_paths,truncated}));
   report[side].file_coverage=report[side].file_coverage.slice(0,full.changed_files.length);
  }
  report.source.changed_files=full.changed_files;report.unclaimed_paths=report.unclaimed_paths.filter(f=>full.changed_files.some(c=>c.path===f.path));
  for(const gap of report.gaps)if(gap.code==='changed_file_unclaimed'&&owners.includes(gap.path))gap.code='auxiliary_owner_unclaimed';
  applyAuxiliarySourceEvidence(report,auxiliary,ownerCoverage);
  report.ci_context={purpose:purpose==='main_verification'?'release':'admission_only',base_snapshot_sha256:'a'.repeat(64),head_snapshot_sha256:'b'.repeat(64)};
  if(scope==='cecelia-kr')report.required_assertions.push({...structuredClone(report.required_assertions[0]),assertion_ref:'manual:bash tests/smoke/scope-a2.sh'});
  raw.push(report);
 }
 return {root,full,raw,purpose,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
it.each([['admission_only',0,0],['main_verification',0,0],['admission_only',7,0],['main_verification',7,1]])(
 'no_owned_changes 保留双scope原始证据和三个真实回归 %s %i %i',async(purpose,exit,emptyIndex)=>{
 const f=await noOwnedFixture({purpose,exit,emptyIndex});
 try{
  const options={source:f.full,expectedScopes:['cecelia-kr','cecelia-factory'],reports:f.raw,purpose};
  const resolution=multi.resolveScopedImplementationReports(options),proof=resolution.evidence;
  expect(proof.scope_reports).toHaveLength(2);
  expect(proof.scope_reports[emptyIndex].source.changed_files).toEqual([]);
  expect(proof.no_owned_changes_context.source_reports).toEqual(f.raw);
  expect(proof.no_owned_changes_context.scope_keys).toEqual([emptyIndex?'cecelia-factory':'cecelia-kr']);
  expect(proof.file_coverage).toHaveLength(1);
  expect(proof.file_coverage[0].claims.map(c=>c.scope_key)).toEqual([emptyIndex?'cecelia-kr':'cecelia-factory']);
  expect(()=>multi.verifyScopedImplementationGitSource(f.root,proof)).not.toThrow();
  const receipt=await multi.runScopedImplementationGate({repoRoot:f.root,evidence:proof});
  expect(receipt.verdict).toBe(exit?'FAIL':'PASS');expect(receipt.scope_receipts).toHaveLength(2);
  expect(receipt.scope_receipts.map(r=>r.assertions.length)).toEqual([2,1]);
  expect(receipt.scope_receipts[emptyIndex].ownership_status).toBe('no_owned_changes');
  expect(receipt.scope_receipts[emptyIndex].assertions[0].exit_code).toBe(exit);
  for(const name of ['a','a2','b'])expect(readFileSync(join(f.root,`actual-${name}`),'utf8')).toBe(name);
  const {assertImplementationReport}=await import('../../lib/implementation-report.js');
  expect(()=>assertImplementationReport(proof.scope_reports[emptyIndex])).toThrow('IMPACT_FILE_COVERAGE_MISSING');
 }finally{f.cleanup();}
});
it('no_owned_changes 不消解联合孤儿文件和真实UNKNOWN',async()=>{
 const f=await noOwnedFixture({orphan:true});
 try{expect(()=>multi.resolveScopedImplementationReports({source:f.full,expectedScopes:['cecelia-kr','cecelia-factory'],reports:f.raw})).toThrow('IMPACT_MULTISCOPE_FILE_UNCLAIMED');}
 finally{f.cleanup();}
});
it('no_owned_changes 拒绝scope、snapshot、用途、原始证据与断言篡改',async()=>{
 const f=await noOwnedFixture();
 try{
  const options={source:f.full,expectedScopes:['cecelia-kr','cecelia-factory'],reports:f.raw};
  const proof=multi.resolveScopedImplementationReports(options).evidence;
  for(const change of [r=>r[0].gaps.push({code:'regression_missing'}),r=>r[0].head.mapping_status='unknown',
   r=>r[0].head.traversal.truncated=true,r=>r[0].head.graph_snapshot.digest='bad',r=>r[0].head.definition_versions.activities=[],
   r=>r[0].required_assertions=[],r=>r[0].ci_context.base_snapshot_sha256='bad',
   r=>r[0].auxiliary_source_evidence.head.relations[0].owner_sha256='f'.repeat(64)]){
   const altered=structuredClone(f.raw);change(altered);expect(()=>multi.resolveScopedImplementationReports({...options,reports:altered})).toThrow();
  }
  for(const delta of [{reports:[f.raw[1]]},{expectedScopes:['cecelia-factory','cecelia-kr']},{source:{...f.full,repo:'foreign/repo'}}])
   expect(()=>multi.resolveScopedImplementationReports({...options,...delta})).toThrow();
  for(const change of [e=>e.scope_reports[0].required_assertions.pop(),e=>e.scope_reports[0].affected_usages=[],
   e=>e.no_owned_changes_context.scope_keys=['cecelia-factory'],e=>e.no_owned_changes_context.source_reports[0].gaps=[],
   e=>e.no_owned_changes_context.context_sha256='0'.repeat(64),e=>delete e.no_owned_changes_context,
   e=>e.scope_reports.splice(0,1),e=>e.purpose='main_verification']){
   const altered=structuredClone(proof);change(altered);expect(()=>multi.verifyScopedImplementationGitSource(f.root,altered)).toThrow();
  }
 }finally{f.cleanup();}
});
